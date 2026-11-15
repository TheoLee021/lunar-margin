// Terrain overlay tiles for the shadow shader (docs/api.md, Tiles). Pure data loading; no Cesium here.
import { z } from 'zod'
import { DEFAULT_BASE_URL } from '../api/client'

const LevelSchema = z.object({
  z: z.number().int(),
  pixel_size_m: z.number().positive(),
  size_px: z.number().int().positive(),
  center_px: z.number().int().nonnegative(),
  tile_px: z.number().int().positive(),
  tiles_per_side: z.number().int().positive(),
  /**
   * Present on sparse levels: only tiles inside one of these ranges `[x0, y0, x1, y1]` (inclusive)
   * exist. Absent when every tile of the level exists.
   */
  tile_ranges: z
    .array(
      z.tuple([
        z.number().int(),
        z.number().int(),
        z.number().int(),
        z.number().int(),
      ]),
    )
    .optional(),
})

export const HorizonMetaSchema = z.object({
  version: z.literal(1),
  layer: z.literal('horizon'),
  levels: z.array(LevelSchema).min(1),
  encoding: z.object({
    azimuth_step_deg: z.number().positive(),
    azimuths: z.number().int().positive(),
    atlas_cols: z.number().int().positive(),
    atlas_rows: z.number().int().positive(),
    offset_deg: z.number(),
    step_deg: z.number().positive(),
  }),
})

export const NormalMetaSchema = z.object({
  version: z.literal(1),
  layer: z.literal('normal'),
  levels: z.array(LevelSchema).min(1),
  encoding: z.object({ bias: z.number(), scale: z.number().positive() }),
})

/**
 * The slopes out to 60°S in one image, for lighting the ground beyond the 85°S overlay. Only servers
 * that hold the DEM for that area have this layer.
 */
export const NormalWideMetaSchema = z.object({
  version: z.literal(1),
  layer: z.literal('normal-wide'),
  levels: z.array(LevelSchema).min(1),
  encoding: z.object({ bias: z.number(), scale: z.number().positive() }),
  /** Grid of the sunlight map of the same area (docs/api.md, Sunlight). */
  sunlight: z.object({
    pixel_size_m: z.number().positive(),
    size_px: z.number().int().positive(),
    center_px: z.number().int().nonnegative(),
  }),
})

/** One level of a layer: its pixel grid and how it is cut into tiles (docs/api.md, Tiles). */
export type TileLevel = z.infer<typeof LevelSchema>
export type HorizonMeta = z.infer<typeof HorizonMetaSchema>
export type NormalMeta = z.infer<typeof NormalMetaSchema>
export type NormalWideMeta = z.infer<typeof NormalWideMetaSchema>
type Layer = 'horizon' | 'normal' | 'normal-wide'

export interface RgbaImage {
  width: number
  height: number
  /** Row-major RGBA bytes, first row first. */
  data: Uint8Array
}

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

/**
 * Decodes the backend's 8-bit RGBA PNGs (filter 0, non-interlaced) byte-exactly. Browser image
 * decoding premultiplies alpha, which would destroy data packed into the alpha channel.
 */
export async function decodeRgbaPng(png: Uint8Array): Promise<RgbaImage> {
  if (png.length < 8 || SIGNATURE.some((b, i) => png[i] !== b))
    throw new Error('not a PNG')
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength)
  let width = 0
  let height = 0
  const idat: Uint8Array[] = []
  for (let pos = 8; pos + 8 <= png.length;) {
    const length = view.getUint32(pos)
    const kind = String.fromCharCode(...png.subarray(pos + 4, pos + 8))
    const body = png.subarray(pos + 8, pos + 8 + length)
    if (kind === 'IHDR') {
      width = view.getUint32(pos + 8)
      height = view.getUint32(pos + 12)
      const [depth, color, , , interlace] = body.subarray(8, 13)
      if (depth !== 8 || color !== 6 || interlace !== 0)
        throw new Error('expected an 8-bit non-interlaced RGBA PNG')
    } else if (kind === 'IDAT') idat.push(body)
    else if (kind === 'IEND') break
    pos += 12 + length
  }
  if (width === 0 || height === 0 || idat.length === 0)
    throw new Error('PNG has no image data')

  const compressed = new Blob(idat as BlobPart[])
  const raw = new Uint8Array(
    await new Response(
      compressed.stream().pipeThrough(new DecompressionStream('deflate')),
    ).arrayBuffer(),
  )
  const stride = width * 4
  if (raw.length !== height * (stride + 1))
    throw new Error('PNG data has an unexpected size')
  const data = new Uint8Array(height * stride)
  for (let row = 0; row < height; row++) {
    const start = row * (stride + 1)
    if (raw[start] !== 0) throw new Error('unsupported PNG row filter')
    data.set(raw.subarray(start + 1, start + 1 + stride), row * stride)
  }
  return { width, height, data }
}

export interface TerrainOverlays {
  horizon: { meta: HorizonMeta; image: RgbaImage }
  normal: { meta: NormalMeta; image: RgbaImage }
}

async function fetchOk(url: string, signal: AbortSignal): Promise<Response> {
  const response = await fetch(url, { signal })
  if (!response.ok) throw new Error(`GET ${url} failed with ${response.status}`)
  return response
}

/** Fetches and decodes one tile of a layer. */
export async function fetchTile(
  layer: Layer,
  tile: { z: number; x: number; y: number },
  baseUrl: string,
  signal: AbortSignal,
): Promise<RgbaImage> {
  const response = await fetchOk(
    `${baseUrl}/tiles/${layer}/${tile.z}/${tile.x}/${tile.y}.png`,
    signal,
  )
  return decodeRgbaPng(new Uint8Array(await response.arrayBuffer()))
}

async function loadLayer<T>(
  layer: Layer,
  schema: z.ZodType<T>,
  baseUrl: string,
  signal: AbortSignal,
): Promise<{ meta: T; image: RgbaImage }> {
  // The single level-0 tile is independent of the meta, so both requests start together.
  const [metaResponse, image] = await Promise.all([
    fetchOk(`${baseUrl}/tiles/${layer}/meta.json`, signal),
    fetchTile(layer, { z: 0, x: 0, y: 0 }, baseUrl, signal),
  ])
  return { meta: schema.parse(await metaResponse.json()), image }
}

/** Fetches and validates the level-0 horizon and normal tiles. */
export async function loadTerrainOverlays(
  signal: AbortSignal,
  baseUrl: string = DEFAULT_BASE_URL,
): Promise<TerrainOverlays> {
  const [horizon, normal] = await Promise.all([
    loadLayer('horizon', HorizonMetaSchema, baseUrl, signal),
    loadLayer('normal', NormalMetaSchema, baseUrl, signal),
  ])
  const { atlas_cols, atlas_rows } = horizon.meta.encoding
  const h = horizon.meta.levels[0]!
  const n = normal.meta.levels[0]!
  if (
    horizon.image.width !== atlas_cols * h.tile_px ||
    horizon.image.height !== atlas_rows * h.tile_px ||
    normal.image.width !== n.tile_px ||
    normal.image.height !== n.tile_px
  )
    throw new Error('overlay tile sizes do not match their meta')
  return { horizon, normal }
}

/**
 * Fetches and validates the meta of the wide normal layer. Its single tile is fetched with
 * fetchTile; the meta comes first so that the sunlight map of the area can be asked for meanwhile.
 */
export async function loadWideMeta(
  signal: AbortSignal,
  baseUrl: string = DEFAULT_BASE_URL,
): Promise<NormalWideMeta> {
  const response = await fetchOk(
    `${baseUrl}/tiles/normal-wide/meta.json`,
    signal,
  )
  return NormalWideMetaSchema.parse(await response.json())
}
