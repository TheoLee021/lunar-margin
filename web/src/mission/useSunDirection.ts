import { useCallback, useEffect, useState } from 'react'
import { fetchSunDirection } from '../api/sunlight'
import type { Vector3 } from '../moon/sun'

export type SunDirectionState =
  | { kind: 'loading'; direction: Vector3 | null }
  | { kind: 'ready'; direction: Vector3 }
  | { kind: 'error' }
export type SunDirectionResult = SunDirectionState & { retry: () => void }

/**
 * Moon-to-Sun direction (MOON_ME) at a chosen UTC instant. A different inspection
 * time changes the terrain lighting but does not change candidate ranking or eligibility.
 */
export function useSunDirection(instant: string): SunDirectionResult {
  const [attempt, setAttempt] = useState(0)
  const key = JSON.stringify([instant, attempt])
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
        instant,
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
  }, [instant, key])
  const state: SunDirectionState =
    stored?.key === key
      ? stored.state
      : {
          kind: 'loading',
          direction:
            stored?.state.kind === 'ready' ? stored.state.direction : null,
        }
  return { ...state, retry }
}
