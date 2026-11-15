import { useEffect, useRef, useState } from 'react'
import { startCalendar } from '../api/pricing'
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
  const job = useRef<AbortController | null>(null)
  useEffect(() => {
    job.current?.abort()
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    const request: ProviderCalendarInput | null = JSON.parse(key)
    const load = async () => {
      if (request === null) return
      try {
        const data = await fetchProviderCalendar(request, {
          signal: controller.signal,
        })
        if (!controller.signal.aborted) {
          setState({ key, data, error: '', loading: false })
          if (data.dates.some((d) => d.state === 'running'))
            timer = setTimeout(() => {
              void load()
            }, 250)
        }
      } catch (error: unknown) {
        if (!controller.signal.aborted)
          setState({
            key,
            data: null,
            error: error instanceof Error ? error.message : String(error),
            loading: false,
          })
      }
    }
    timer = setTimeout(() => {
      void load()
    }, 250)
    return () => {
      controller.abort()
      clearTimeout(timer)
      job.current?.abort()
    }
  }, [key, revision])
  const current =
    state.key === key
      ? state
      : { key, data: null, error: '', loading: input !== null }
  async function calculate() {
    if (input === null) return
    job.current?.abort()
    const controller = new AbortController()
    job.current = controller
    setActive(key)
    try {
      let data = await fetchProviderCalendar(input, {
        signal: controller.signal,
      })
      if (data.dates.every((d) => d.state === 'completed')) return
      const missing = data.dates.filter(
        (d) => d.state !== 'completed' && d.state !== 'running',
      )
      if (missing.length) {
        const started = await startCalendar(
          { ...input, landing_dates: missing.map((d) => d.landing_date) },
          { signal: controller.signal },
        )
        if (started.run_ids.some((id, i) => id !== missing[i]?.run_id))
          throw new Error('탐색 실행이 요청한 일정과 일치하지 않습니다.')
      }
      while (!controller.signal.aborted) {
        data = await fetchProviderCalendar(input, { signal: controller.signal })
        if (controller.signal.aborted) return
        setState({ key, data, error: '', loading: false })
        const failed = data.dates.find(
          (d) => d.state === 'failed' || d.state === 'unavailable',
        )
        if (failed)
          throw new Error(failed.message ?? '날짜별 탐색에 실패했습니다.')
        if (data.dates.every((d) => d.state === 'completed')) return
        await pause(controller.signal)
      }
    } catch (error: unknown) {
      if (!controller.signal.aborted)
        setState((previous) => ({
          ...previous,
          key,
          error: error instanceof Error ? error.message : String(error),
          loading: false,
        }))
    } finally {
      if (job.current === controller) setActive(null)
    }
  }
  return {
    ...current,
    calculating: active === key,
    calculate,
    reload: () => setRevision((v) => v + 1),
    stop: () => {
      job.current?.abort()
      setActive(null)
      setRevision((v) => v + 1)
    },
  }
}
