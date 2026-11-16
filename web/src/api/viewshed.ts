import { z } from 'zod'
import { getJson } from './client'

const position = z.tuple([z.number(), z.number(), z.number()])
const schema = z.object({
  lat: z.number(),
  lon: z.number(),
  center_x_m: z.number(),
  center_y_m: z.number(),
  observer_height_m: z.number(),
  eye_height_m: z.number(),
  targets: z.array(z.tuple([position, position.nullable()])),
  rays: z.array(z.tuple([z.number().min(0).max(5000), z.boolean()])).length(24),
  cells: z
    .string()
    .length(125 * 125)
    .regex(/^[012]+$/),
})
export type Viewshed = z.infer<typeof schema>

export function visibleGridCount(map: Viewshed) {
  return map.targets.filter(([, hit]) => hit === null).length
}

export async function fetchViewshed(
  lat: number,
  lon: number,
  height: number,
  signal: AbortSignal,
  center?: { x_m: number; y_m: number },
  demName = '80s_80m',
) {
  const grid = center
    ? `&center_x_m=${center.x_m}&center_y_m=${center.y_m}`
    : ''
  const result = await getJson(
    `/analysis/viewshed?lat=${lat}&lon=${lon}&observer_height_m=${height}${grid}&dem_name=${encodeURIComponent(demName)}`,
    schema,
    { signal },
  )
  if (
    result.lat !== lat ||
    result.lon !== lon ||
    result.observer_height_m !== height
  )
    throw new Error('가시권 좌표 불일치')
  return result
}
