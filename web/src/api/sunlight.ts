import { z } from 'zod'
import { getJson, type RequestOptions } from './client'

// 응답 스키마는 docs/api.md 의 /sunlight/sun-direction 과 일치해야 한다.
const SunDirectionSchema = z
  .object({
    time: z.iso.datetime({ offset: true }),
    x: z.number(),
    y: z.number(),
    z: z.number(),
  })
  .refine(({ x, y, z }) => Math.hypot(x, y, z) > 0, {
    message: 'the direction must not be a zero vector',
  })

/**
 * Moon-to-Sun direction (MOON_ME) at `time` (UTC ISO 8601). It depends on the time alone: the Sun is
 * far enough away that the direction is the same from every point of the Moon.
 */
export async function fetchSunDirection(
  time: string,
  signal?: AbortSignal,
  options: Omit<RequestOptions, 'signal'> = {},
): Promise<readonly [number, number, number]> {
  const { x, y, z } = await getJson(
    `/sunlight/sun-direction?${new URLSearchParams({ time }).toString()}`,
    SunDirectionSchema,
    { ...options, signal },
  )
  return [x, y, z]
}
