import { z } from 'zod'
import { getJson } from './client'

const schema = z.object({
  lat: z.number(),
  lon: z.number(),
  center_x_m: z.number(),
  center_y_m: z.number(),
  eye_height_m: z.number(),
  rays: z.array(z.tuple([z.number().min(0).max(5000), z.boolean()])).length(24),
  cells: z
    .string()
    .length(125 * 125)
    .regex(/^[012]+$/),
})
export type Viewshed = z.infer<typeof schema>

export async function fetchViewshed(
  lat: number,
  lon: number,
  signal: AbortSignal,
) {
  const result = await getJson(
    `/analysis/viewshed?lat=${lat}&lon=${lon}`,
    schema,
    { signal },
  )
  if (result.lat !== lat || result.lon !== lon)
    throw new Error('가시권 좌표 불일치')
  return result
}
