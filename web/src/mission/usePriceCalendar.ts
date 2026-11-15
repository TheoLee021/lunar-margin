import { useEffect, useRef, useState } from 'react'
import {
  fetchCalendar,
  startCalendar,
  type Calendar,
  type CalendarInput,
} from '../api/pricing'

function pause(signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
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

/** One batch keeps each date's original grids; polling no longer waits between dates. */
export async function calculateDates(
  input: CalendarInput,
  signal: AbortSignal,
  onUpdate: (data: Calendar) => void,
): Promise<void> {
  let data = await fetchCalendar(input, { signal })
  onUpdate(data)
  if (
    data.dates.every(
      (row) => row.state === 'ready' || row.state === 'no_eligible',
    )
  )
    return
  async function start() {
    const job = await startCalendar(input, { signal })
    if (job.run_ids.some((id, index) => id !== data.dates[index]?.run_id))
      throw new Error(
        '일괄 계산의 실행 ID가 요청한 임무 조건과 일치하지 않습니다.',
      )
  }
  await start()
  while (!signal.aborted) {
    data = await fetchCalendar(input, { signal })
    onUpdate(data)
    const failed = data.dates.find(
      (row) => row.state === 'failed' || row.state === 'unavailable',
    )
    if (failed)
      throw new Error(failed.message ?? '날짜별 일괄 계산에 실패했습니다.')
    if (
      data.dates.every(
        (row) => row.state === 'ready' || row.state === 'no_eligible',
      )
    )
      return
    if (!data.dates.some((row) => row.state === 'running')) await start()
    await pause(signal)
  }
}

type State = {
  key: string
  data: Calendar | null
  error: string
  loading: boolean
}
export function usePriceCalendar(input: CalendarInput | null) {
  const key = JSON.stringify(input)
  const [state, setState] = useState<State>({
    key: '',
    data: null,
    error: '',
    loading: false,
  })
  const [active, setActive] = useState<string | null>(null)
  const [revision, setRevision] = useState(0)
  const calculation = useRef<AbortController | null>(null)
  useEffect(() => {
    calculation.current?.abort()
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    const request: CalendarInput | null = JSON.parse(key)
    async function load() {
      if (request === null) return
      try {
        const data = await fetchCalendar(request, { signal: controller.signal })
        if (!controller.signal.aborted) {
          setState({ key, data, error: '', loading: false })
          if (data.dates.some((row) => row.state === 'running'))
            timer = setTimeout(() => {
              void load()
            }, 250)
        }
      } catch (error) {
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
      calculation.current?.abort()
    }
  }, [key, revision])
  const current =
    state.key === key
      ? state
      : { key, data: null, error: '', loading: input !== null }
  async function calculate() {
    if (input === null) return
    calculation.current?.abort()
    const controller = new AbortController()
    calculation.current = controller
    setActive(key)
    try {
      await calculateDates(input, controller.signal, (data) => {
        if (!controller.signal.aborted)
          setState({ key, data, error: '', loading: false })
      })
    } catch (error) {
      if (!controller.signal.aborted)
        setState((previous) => ({
          ...previous,
          key,
          error: error instanceof Error ? error.message : String(error),
          loading: false,
        }))
    } finally {
      if (calculation.current === controller) setActive(null)
    }
  }
  return {
    ...current,
    calculating: active === key,
    calculate,
    reload: () => setRevision((v) => v + 1),
    stop: () => {
      calculation.current?.abort()
      setActive(null)
      setRevision((v) => v + 1)
    },
  }
}
