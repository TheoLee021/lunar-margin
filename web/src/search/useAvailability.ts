import { useCallback, useEffect, useState } from 'react'
import { fetchAvailability, type Availability } from '../api/reservations'

export type AvailabilityState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: Availability }

export function useAvailability(runId: string) {
  const [revision, setRevision] = useState(0)
  const [state, setState] = useState<AvailabilityState>({ status: 'loading' })
  const reload = useCallback(() => {
    setState({ status: 'loading' })
    setRevision((value) => value + 1)
  }, [])
  useEffect(() => {
    const controller = new AbortController()
    void fetchAvailability(runId, { signal: controller.signal })
      .then((data) => {
        if (!controller.signal.aborted) setState({ status: 'ready', data })
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setState({
            status: 'error',
            message: error instanceof Error ? error.message : '예약 조회 실패',
          })
      })
    return () => controller.abort()
  }, [runId, revision])
  return { state, reload }
}
