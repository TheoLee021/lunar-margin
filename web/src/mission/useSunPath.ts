import { useCallback, useEffect, useState } from 'react'
import { fetchSunDirections, type SunPath } from '../api/sunlight'
import { landingStart, missionEnd, MISSION_STEP_MINUTES } from './liveAnalysis'

export type SunPathState =
  { kind: 'loading' } | { kind: 'ready'; path: SunPath } | { kind: 'error' }
export type SunPathResult = SunPathState & { retry: () => void }

/**
 * The Sun over the surface mission, as Moon-to-Sun directions (MOON_ME) at the sample times of the
 * mission timeline. It follows from the schedule alone, so the Moon can be lit by the Sun at landing
 * (the first direction) before any candidate is selected, and the whole mission is there to move the
 * light through once one is.
 */
export function useSunPath(landing: string, duration: number): SunPathResult {
  const [attempt, setAttempt] = useState(0)
  const key = JSON.stringify([landing, duration, attempt])
  const [stored, setStored] = useState<{
    key: string
    state: SunPathState
  } | null>(null)
  const retry = useCallback(() => setAttempt((n) => n + 1), [])
  useEffect(() => {
    const controller = new AbortController()
    // Debounce date scrubbing like useMissionAnalysis.
    const timer = window.setTimeout(() => {
      void fetchSunDirections(
        {
          start: landingStart(landing),
          end: missionEnd(landing, duration),
          stepMinutes: MISSION_STEP_MINUTES,
        },
        AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]),
      )
        .then(
          (path): SunPathState => ({ kind: 'ready', path }),
          (): SunPathState => ({ kind: 'error' }),
        )
        .then((state) => {
          if (!controller.signal.aborted) setStored({ key, state })
        })
    }, 200)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [landing, duration, key])
  const state: SunPathState =
    stored?.key === key ? stored.state : { kind: 'loading' }
  return { ...state, retry }
}
