import { useCallback, useEffect, useState } from 'react'
import { fetchSunDirection } from '../api/sunlight'
import type { Vector3 } from '../moon/sun'
import { landingStart } from './liveAnalysis'

export type SunDirectionState =
  | { kind: 'loading' }
  | { kind: 'ready'; direction: Vector3 }
  | { kind: 'error' }
export type SunDirectionResult = SunDirectionState & { retry: () => void }

/**
 * The Sun at landing, as the Moon-to-Sun direction (MOON_ME). It follows from the landing time
 * alone, so the Moon can be lit before any candidate is selected, and stays the same Sun, hence the
 * same sunlight map, when the selected candidate changes.
 */
export function useSunDirection(landing: string): SunDirectionResult {
  const [attempt, setAttempt] = useState(0)
  const key = JSON.stringify([landing, attempt])
  const [stored, setStored] = useState<{
    key: string
    state: SunDirectionState
  } | null>(null)
  const retry = useCallback(() => setAttempt((n) => n + 1), [])
  useEffect(() => {
    const controller = new AbortController()
    // Debounce date scrubbing like useMissionAnalysis.
    const timer = window.setTimeout(() => {
      void fetchSunDirection(
        landingStart(landing),
        AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]),
      )
        .then(
          (direction): SunDirectionState => ({ kind: 'ready', direction }),
          (): SunDirectionState => ({ kind: 'error' }),
        )
        .then((state) => {
          if (!controller.signal.aborted) setStored({ key, state })
        })
    }, 200)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [landing, key])
  const state: SunDirectionState =
    stored?.key === key ? stored.state : { kind: 'loading' }
  return { ...state, retry }
}
