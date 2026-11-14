import { useCallback, useEffect, useRef, useState } from 'react'
import {
  fetchAnalysis,
  type Analysis,
  type AnalysisKind,
  type AnalysisParams,
} from '../api/analysis'

export type AnalysisState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ok'; kind: AnalysisKind; data: Analysis }
  | { status: 'error'; message: string }

/** 분석 요청 하나를 관리한다. 새 요청이 오면 이전 요청은 취소한다. */
export function useAnalysis() {
  const [state, setState] = useState<AnalysisState>({ status: 'idle' })
  const controllerRef = useRef<AbortController | null>(null)

  const run = useCallback((kind: AnalysisKind, params: AnalysisParams) => {
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller
    setState({ status: 'loading' })
    fetchAnalysis(kind, params, controller.signal)
      .then((data) => setState({ status: 'ok', kind, data }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setState({
          status: 'error',
          message: error instanceof Error ? error.message : String(error),
        })
      })
  }, [])

  useEffect(() => () => controllerRef.current?.abort(), [])

  return { state, run }
}
