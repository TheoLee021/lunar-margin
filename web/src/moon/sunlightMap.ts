// Sunlight map (docs/api.md, Sunlight): for one Sun direction, the fraction of the solar disc visible
// from each point of the south-polar grid, computed by the backend from the DEM. The whole map is on
// an 80 m grid; where 5 m regional DEMs exist the backend also computes windows of it on the grid of
// a detail level of the normal tiles. A wide map covers the ground beyond it, out to 60°S, on a
// coarser grid. No Cesium here.
import { decodeRgbaPng, type RgbaImage } from './overlayTiles'
import type { Vector3 } from './sun'

export interface SunlightMap {
  width: number
  height: number
  /** One byte per pixel, first row first: 0 = full shadow, 255 = the whole disc visible. */
  data: Uint8Array
}

/** A window of the map: WINDOW_TILES x WINDOW_TILES tiles of normal level `z` from this tile on. */
export interface SunlightWindowAddress {
  z: number
  tileX: number
  tileY: number
}

export function sunlightMapUrl(baseUrl: string, [x, y, z]: Vector3): string {
  return `${baseUrl}/sunlight/south-pole.png?x=${x}&y=${y}&z=${z}`
}

/** The map of the wider area (out to 60°S) on its own, coarser grid. */
export function wideSunlightMapUrl(
  baseUrl: string,
  [x, y, z]: Vector3,
): string {
  return `${baseUrl}/sunlight/south-pole-wide.png?x=${x}&y=${y}&z=${z}`
}

export function sunlightWindowUrl(
  baseUrl: string,
  [x, y, z]: Vector3,
  window: SunlightWindowAddress,
): string {
  return `${baseUrl}/sunlight/south-pole/${window.z}/${window.tileX}/${window.tileY}.png?x=${x}&y=${y}&z=${z}`
}

/** The map is grey (R = G = B); the shader needs one channel. */
export function greyChannel(image: RgbaImage): Uint8Array {
  const grey = new Uint8Array(image.width * image.height)
  for (let i = 0; i < grey.length; i++) grey[i] = image.data[i * 4]!
  return grey
}

// The backend computes one map at a time and answers 429 when too many are already waiting.
const BUSY_RETRIES = 5
const BUSY_WAIT_MS = 5000

function abortableWait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer)
      reject(signal.reason as Error)
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * Fetches the map for one Sun direction, one `window` of it, or the `wide` map. While the backend is
 * busy (429) it waits as long as the response asks and tries again, a few times; any other failure
 * is thrown at once.
 */
export async function loadSunlightMap(
  sun: Vector3,
  baseUrl: string,
  signal: AbortSignal,
  {
    window,
    wide = false,
    fetchFn = fetch,
    wait = (ms: number) => abortableWait(ms, signal),
  }: {
    window?: SunlightWindowAddress
    wide?: boolean
    fetchFn?: typeof fetch
    wait?: (ms: number) => Promise<void>
  } = {},
): Promise<SunlightMap> {
  const url = window
    ? sunlightWindowUrl(baseUrl, sun, window)
    : wide
      ? wideSunlightMapUrl(baseUrl, sun)
      : sunlightMapUrl(baseUrl, sun)
  let response = await fetchFn(url, { signal })
  for (
    let retry = 0;
    response.status === 429 && retry < BUSY_RETRIES;
    retry++
  ) {
    const seconds = Number(response.headers.get('Retry-After'))
    await wait(seconds > 0 ? seconds * 1000 : BUSY_WAIT_MS)
    response = await fetchFn(url, { signal })
  }
  if (!response.ok) throw new Error(`GET ${url} failed with ${response.status}`)
  const image = await decodeRgbaPng(
    new Uint8Array(await response.arrayBuffer()),
  )
  return { width: image.width, height: image.height, data: greyChannel(image) }
}
