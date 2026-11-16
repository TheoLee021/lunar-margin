import { useEffect, useState } from 'react'
import { requestFlightPreview, type FlightRequest } from '../flight/flightApi'
import { utc } from '../flight/flightPlan'

export function PlannerTouchdown({ request }: { request: FlightRequest }) {
  const [message, setMessage] = useState('계산 중…')
  useEffect(() => {
    const controller = new AbortController()
    const timer = window.setTimeout(async () => {
      try {
        const data = await requestFlightPreview(request, controller.signal)
        if (!controller.signal.aborted)
          setMessage(
            data.estimated_touchdown_utc
              ? utc(data.estimated_touchdown_utc)
              : '산출되지 않음',
          )
      } catch {
        if (!controller.signal.aborted)
          setMessage('착륙 시각을 계산할 수 없습니다.')
      }
    }, 300)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [request])
  return (
    <p role="status">
      예상 표면 착륙 ·{' '}
      <output data-testid="planner-touchdown">{message}</output>
    </p>
  )
}
