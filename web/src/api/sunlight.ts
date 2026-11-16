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

// 응답 스키마는 docs/api.md 의 /sunlight/sun-directions 와 일치해야 한다.
const SunDirectionsSchema = z.object({
  start: z.iso.datetime({ offset: true }),
  end: z.iso.datetime({ offset: true }),
  step_minutes: z.number().int().positive(),
  directions: z
    .array(
      z
        .tuple([z.number(), z.number(), z.number()])
        .refine(([x, y, z]) => Math.hypot(x, y, z) > 0, {
          message: 'a direction must not be a zero vector',
        }),
    )
    .min(1),
})

/** Moon-to-Sun directions (MOON_ME) at `start`, `start + stepMinutes`, and so on. */
export interface SunPath {
  /** UTC ISO 8601 time of `directions[0]`. */
  start: string
  stepMinutes: number
  directions: readonly (readonly [number, number, number])[]
}

/**
 * The Sun over `[start, end)` (UTC ISO 8601), one direction every `stepMinutes`: what the viewer
 * needs to move the sunlight through a mission without asking again for every moment.
 */
export async function fetchSunDirections(
  range: { start: string; end: string; stepMinutes: number },
  signal?: AbortSignal,
  options: Omit<RequestOptions, 'signal'> = {},
): Promise<SunPath> {
  const path = `/sunlight/sun-directions?${new URLSearchParams({
    start: range.start,
    end: range.end,
    step_minutes: String(range.stepMinutes),
  }).toString()}`
  const body = await getJson(path, SunDirectionsSchema, { ...options, signal })
  const start = Date.parse(range.start)
  const end = Date.parse(range.end)
  if (
    Date.parse(body.start) !== start ||
    Date.parse(body.end) !== end ||
    body.step_minutes !== range.stepMinutes ||
    body.directions.length !==
      Math.ceil((end - start) / (range.stepMinutes * 60_000))
  )
    throw new Error(`GET ${path} returned another range than was asked for`)
  return {
    start: range.start,
    stepMinutes: range.stepMinutes,
    directions: body.directions,
  }
}
