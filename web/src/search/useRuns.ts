import { useCallback, useEffect, useState } from 'react'
import {
  fetchRun,
  fetchRuns,
  type RunDetail,
  type RunSummary,
} from '../api/candidates'

export type Remote<T> =
  | { status: 'loading' }
  | { status: 'ok'; data: T }
  | { status: 'error'; message: string }

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** 실행 목록. reload 로 다시 불러온다. 요청이 겹치면 이전 요청은 취소한다. */
export function useRuns() {
  const [state, setState] = useState<Remote<RunSummary[]>>({
    status: 'loading',
  })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    fetchRuns({ signal: controller.signal })
      .then((list) => setState({ status: 'ok', data: list.runs }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setState({ status: 'error', message: messageOf(error) })
      })
    return () => controller.abort()
  }, [attempt])

  const reload = useCallback(() => {
    setState({ status: 'loading' })
    setAttempt((n) => n + 1)
  }, [])
  return { state, reload }
}

/**
 * 실행 하나의 상세. runId 가 바뀌면 호출하는 쪽에서 컴포넌트를 key 로 다시 만든다
 * (그래서 처음 상태가 항상 loading 이다).
 */
export function useRun(runId: string) {
  const [state, setState] = useState<Remote<RunDetail>>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    Promise.resolve()
      .then(() => fetchRun(runId, { signal: controller.signal }))
      .then((data) => setState({ status: 'ok', data }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setState({ status: 'error', message: messageOf(error) })
      })
    return () => controller.abort()
  }, [runId, attempt])

  const reload = useCallback(() => {
    setState({ status: 'loading' })
    setAttempt((n) => n + 1)
  }, [])
  return { state, reload }
}
