import type { SunPath } from '../api/sunlight'
import type { Vector3 } from '../moon/sun'

/** How fast the review time runs while it plays: mission days per second of watching. */
export const PLAYBACK_SPEEDS = [
  { label: '6시간/초', daysPerSecond: 0.25 },
  { label: '1일/초', daysPerSecond: 1 },
  { label: '3일/초', daysPerSecond: 3 },
] as const

/**
 * The Moon-to-Sun direction `days` after the start of the path. Between two samples it is the
 * direction in between, so the light moves smoothly while the samples are half an hour apart (the
 * Sun turns a quarter of a degree in that time, far too little for a straight blend to show).
 */
export function sunAt(path: SunPath, days: number): Vector3 {
  const last = path.directions.length - 1
  const position = Math.min(last, Math.max(0, (days * 1440) / path.stepMinutes))
  const index = Math.min(last - 1, Math.floor(position))
  const from = path.directions[Math.max(0, index)]!
  const share = position - index
  if (last === 0 || share === 0) return from
  const to = path.directions[index + 1]!
  if (share === 1) return to
  const x = from[0] + (to[0] - from[0]) * share
  const y = from[1] + (to[1] - from[1]) * share
  const z = from[2] + (to[2] - from[2]) * share
  const length = Math.hypot(x, y, z)
  return [x / length, y / length, z / length]
}

/** Where a playback that was at `days` is `elapsedMs` later. It stops at `endDays`. */
export function advance(
  days: number,
  elapsedMs: number,
  daysPerSecond: number,
  endDays: number,
): number {
  return Math.min(endDays, days + (elapsedMs / 1000) * daysPerSecond)
}
