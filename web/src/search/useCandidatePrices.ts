import { useCallback, useEffect, useState } from 'react'
import { ApiError } from '../api/client'
import { fetchGridPrices, type RunPrices } from '../api/pricing'

export type CandidatePrices =
  | { status: 'loading' }
  | {
      status: 'ok'
      data: ReadonlyMap<string, RunPrices['cells'][number]>
      slopePolicy?: RunPrices['slope_policy']
    }
  | { status: 'unavailable' }
  | { status: 'error' }

// The keyed RunScreen remounts for each run, just as it does for useRun.
export function useCandidatePrices(runId: string) {
  const [state, setState] = useState<CandidatePrices>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    fetchGridPrices(runId, 24, 'surface', { signal: controller.signal })
      .then((data) => {
        if (!controller.signal.aborted)
          setState({
            status: 'ok',
            slopePolicy: data.slope_policy,
            data: new Map(data.cells.map((cell) => [cell.id, cell])),
          })
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setState(
          error instanceof ApiError && error.status === 409
            ? { status: 'unavailable' }
            : {
                status: 'error',
              },
        )
      })
    return () => controller.abort()
  }, [runId, attempt])

  const reload = useCallback(() => {
    setState({ status: 'loading' })
    setAttempt((n) => n + 1)
  }, [])
  return { state, reload }
}
