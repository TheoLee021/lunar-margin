import { useCallback, useEffect, useState } from 'react'
import {
  fetchSiteAssessment,
  type AnalysisParams,
  type SiteAssessment,
} from '../api/analysis'

export type DiagnosticState =
  | { status: 'loading' }
  | { status: 'unavailable' }
  | { status: 'error'; message: string }
  | { status: 'ok'; data: SiteAssessment }

export function useCandidateDiagnostics(
  params: AnalysisParams,
  enabled: boolean,
) {
  const { lat, lon, start, end, step_minutes, observer_height_m } = params
  const [attempt, setAttempt] = useState(0)
  const key = JSON.stringify([
    lat,
    lon,
    start,
    end,
    step_minutes,
    observer_height_m,
    attempt,
  ])
  const [stored, setStored] = useState<{
    key: string
    state: DiagnosticState
  } | null>(null)

  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController()
    const signal = AbortSignal.any([
      controller.signal,
      AbortSignal.timeout(30_000),
    ])
    fetchSiteAssessment(
      { lat, lon, start, end, step_minutes, observer_height_m },
      signal,
    )
      .then((data) => {
        if (!controller.signal.aborted)
          setStored({ key, state: { status: 'ok', data } })
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setStored({
            key,
            state: {
              status: 'error',
              message: error instanceof Error ? error.message : String(error),
            },
          })
      })
    return () => controller.abort()
  }, [enabled, lat, lon, start, end, step_minutes, observer_height_m, key])

  const retry = useCallback(() => setAttempt((n) => n + 1), [])
  const state: DiagnosticState = !enabled
    ? { status: 'unavailable' }
    : stored?.key === key
      ? stored.state
      : { status: 'loading' }
  return { state, retry }
}
