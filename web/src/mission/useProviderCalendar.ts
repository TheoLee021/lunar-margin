import { useEffect, useState } from 'react'
import { startCalendar } from '../api/pricing'
import type { RunStatus } from '../api/candidates'
import {
  fetchProviderCalendar,
  type ProviderCalendar,
  type ProviderCalendarInput,
} from '../api/providerPricing'

type State = {
  key: string
  data: ProviderCalendar | null
  error: string
  loading: boolean
}
function pause(signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer)
      reject(new DOMException('Aborted', 'AbortError'))
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort)
      resolve()
    }, 250)
    if (signal.aborted) abort()
    else signal.addEventListener('abort', abort, { once: true })
  })
}
export function useProviderCalendar(input: ProviderCalendarInput | null) {
  const key = JSON.stringify(input)
  const [state, setState] = useState<State>({
    key: '',
    data: null,
    error: '',
    loading: false,
  })
  const [revision, setRevision] = useState(0)
  const [active, setActive] = useState<string | null>(null)
  const [waiting, setWaiting] = useState<{
    key: string
    status: RunStatus
  } | null>(null)
  useEffect(() => {
    const request: ProviderCalendarInput | null = JSON.parse(key)
    if (!request) return
    const controller = new AbortController()
    const { signal } = controller
    async function load(request: ProviderCalendarInput) {
      try {
        let data = await fetchProviderCalendar(request, { signal })
        signal.throwIfAborted()
        setState({ key, data, error: '', loading: false })
        if (data.dates.every((date) => date.state === 'completed')) return
        setActive(key)
        const missing = data.dates.filter(
          (date) => date.state !== 'completed' && date.state !== 'running',
        )
        if (missing.length) {
          const started = await startCalendar(
            {
              ...request,
              landing_dates: missing.map((date) => date.landing_date),
            },
            {
              signal,
              onBusy: (status) => {
                if (!signal.aborted) setWaiting(status ? { key, status } : null)
              },
            },
          )
          if (started.run_ids.some((id, i) => id !== missing[i]?.run_id))
            throw new Error(
              'The search results do not match the requested dates.',
            )
        }
        while (!signal.aborted) {
          await pause(signal)
          data = await fetchProviderCalendar(request, { signal })
          signal.throwIfAborted()
          setState({ key, data, error: '', loading: false })
          const failed = data.dates.find(
            (d) => d.state === 'failed' || d.state === 'unavailable',
          )
          if (failed)
            throw new Error(
              failed.message ?? 'Unable to calculate prices for these dates.',
            )
          if (data.dates.every((d) => d.state === 'completed')) break
        }
      } catch (error) {
        if (!signal.aborted)
          setState((previous) => ({
            key,
            data: previous.key === key ? previous.data : null,
            error: error instanceof Error ? error.message : String(error),
            loading: false,
          }))
      } finally {
        if (!signal.aborted) setActive(null)
      }
    }
    const timer = setTimeout(() => {
      setWaiting(null)
      setActive(null)
      void load(request)
    }, 250)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [key, revision])
  return {
    ...(state.key === key
      ? state
      : { key, data: null, error: '', loading: input !== null }),
    calculating: active === key,
    waiting: active === key && waiting?.key === key ? waiting.status : null,
    reload: () => setRevision((v) => v + 1),
  }
}
