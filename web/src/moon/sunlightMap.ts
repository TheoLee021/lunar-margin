// Sunlight map (docs/api.md, Sunlight): for one Sun direction, the fraction of the solar disc visible
// from each point of the south-polar grid, computed by the backend from the DEM. No Cesium here.
import { decodeRgbaPng, type RgbaImage } from './overlayTiles'
import type { Vector3 } from './sun'

export interface SunlightMap {
  width: number
  height: number
  /** One byte per pixel, first row first: 0 = full shadow, 255 = the whole disc visible. */
  data: Uint8Array
}

export function sunlightMapUrl(baseUrl: string, [x, y, z]: Vector3): string {
  return `${baseUrl}/sunlight/south-pole.png?x=${x}&y=${y}&z=${z}`
}

/** The map is grey (R = G = B); the shader needs one channel. */
export function greyChannel(image: RgbaImage): Uint8Array {
  const grey = new Uint8Array(image.width * image.height)
  for (let i = 0; i < grey.length; i++) grey[i] = image.data[i * 4]!
  return grey
}

export async function loadSunlightMap(
  sun: Vector3,
  baseUrl: string,
  signal: AbortSignal,
): Promise<SunlightMap> {
  const url = sunlightMapUrl(baseUrl, sun)
  const response = await fetch(url, { signal })
  if (!response.ok) throw new Error(`GET ${url} failed with ${response.status}`)
  const image = await decodeRgbaPng(
    new Uint8Array(await response.arrayBuffer()),
  )
  return { width: image.width, height: image.height, data: greyChannel(image) }
}
