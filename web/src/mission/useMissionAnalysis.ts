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
              ? '분석 데이터를 불러올 수 없습니다 (503). 백엔드의 NASA 데이터 준비 상태를 확인하세요.'
              : error instanceof ApiError && error.status === 422
                ? '이 지점 또는 기간을 분석할 수 없습니다 (422). 선택한 날짜를 확인하세요.'
                : '분석에 실패했습니다. API 연결과 응답을 확인한 뒤 다시 시도하세요.'
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
