import { useCallback, useEffect, useState } from 'react'
import { fetchSiteAssessment, type SiteAssessment } from '../api/analysis'
import { missionParams } from './liveAnalysis'
import type { CandidateSite, Schedule } from './types'

export type SiteAssessmentState =
  | { kind: 'loading' }
  | { kind: 'ready'; data: SiteAssessment }
  | { kind: 'error' }

const LOADING: SiteAssessmentState = { kind: 'loading' }

/** 후보 전체를 같은 일정으로 평가한다. 후보마다 따로 요청해 끝나는 대로 보여준다. */
export function useSiteAssessments(
  sites: readonly CandidateSite[],
  schedule: Schedule,
) {
  const { departure, landing, duration } = schedule
  const [attempt, setAttempt] = useState(0)
  const key = JSON.stringify([landing, duration, attempt])
  const [stored, setStored] = useState<{
    key: string
    states: Readonly<Record<string, SiteAssessmentState>>
  } | null>(null)
  const retry = useCallback(() => setAttempt((n) => n + 1), [])

  useEffect(() => {
    const controller = new AbortController()
    const signal = AbortSignal.any([
      controller.signal,
      AbortSignal.timeout(30_000),
    ])
    // Debounce date scrubbing like useMissionAnalysis; requests run in parallel.
    const timer = window.setTimeout(() => {
      for (const site of sites) {
        void fetchSiteAssessment(
          missionParams(site, { departure, landing, duration }),
          signal,
        )
          .then(
            (data): SiteAssessmentState => ({ kind: 'ready', data }),
            (): SiteAssessmentState => ({ kind: 'error' }),
          )
          .then((state) => {
            if (controller.signal.aborted) return
            setStored((prev) => ({
              key,
              states: {
                ...(prev?.key === key ? prev.states : {}),
                [site.id]: state,
              },
            }))
          })
      }
    }, 200)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [sites, departure, landing, duration, key])

  const states = stored?.key === key ? stored.states : {}
  return {
    stateOf: (id: string): SiteAssessmentState => states[id] ?? LOADING,
    retry,
  }
}
