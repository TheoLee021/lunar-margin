import { useCallback, useEffect, useState } from 'react'
import type { AnalysisParams } from '../api/analysis'
import { ApiError } from '../api/client'
import { loadMissionAnalysis, type LiveMissionAnalysis } from './liveAnalysis'

export type MissionAnalysisState =
  | { kind: 'idle' | 'loading' }
  | { kind: 'ready'; data: LiveMissionAnalysis }
  | { kind: 'error'; message: string }
export type MissionAnalysisResult = MissionAnalysisState & { retry: () => void }

export function useMissionAnalysis(
  params: AnalysisParams | null,
): MissionAnalysisResult {
  const lat = params?.lat,
    lon = params?.lon,
    start = params?.start,
    end = params?.end,
    step = params?.step_minutes,
    height = params?.observer_height_m
  const [attempt, setAttempt] = useState(0)
  const key = JSON.stringify([lat, lon, start, end, step, height, attempt])
  const [stored, setStored] = useState<{
    key: string
    state: MissionAnalysisState
  } | null>(null)
  const retry = useCallback(() => setAttempt((n) => n + 1), [])
  useEffect(() => {
    if (
      lat === undefined ||
      lon === undefined ||
      start === undefined ||
      end === undefined ||
      step === undefined ||
      height === undefined
    )
      return
    const controller = new AbortController()
    // Debounce date scrubbing; both body requests share cancellation and publish together.
    const timer = window.setTimeout(() => {
      void loadMissionAnalysis(
        { lat, lon, start, end, step_minutes: step, observer_height_m: height },
        AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]),
      )
        .then((data) => {
          if (!controller.signal.aborted)
            setStored({ key, state: { kind: 'ready', data } })
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) return
          const message =
            error instanceof ApiError && error.status === 503
              ? 'Analysis data is unavailable (503). Check that the backend’s NASA data is ready.'
              : error instanceof ApiError && error.status === 422
                ? 'This site or period cannot be analyzed (422). Check the selected dates.'
                : 'Analysis failed. Check the API connection and response, then try again.'
          setStored({ key, state: { kind: 'error', message } })
        })
    }, 200)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [lat, lon, start, end, step, height, key, attempt])
  const state: MissionAnalysisState = !params
    ? { kind: 'idle' }
    : stored?.key === key
      ? stored.state
      : { kind: 'loading' }
  return { ...state, retry }
}
