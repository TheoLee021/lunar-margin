import { useEffect, useState } from 'react'
import { requestFlightPreview, type FlightRequest } from '../flight/flightApi'
import { ApiError } from '../api/client'
import { utc } from '../flight/flightPlan'

export function PlannerTouchdown({ request }: { request: FlightRequest }) {
  const [message, setMessage] = useState('계산 중…')
  const [attempt, setAttempt] = useState(0)
  const [failed, setFailed] = useState(false)
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
      } catch (error) {
        if (!controller.signal.aborted) {
          setFailed(true)
          setMessage(
            error instanceof ApiError && error.status === 429
              ? '다른 궤도를 계산 중입니다. 잠시 후 다시 시도하세요.'
              : '착륙 시각을 계산할 수 없습니다.',
          )
        }
      }
    }, 300)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [request, attempt])
  return (
    <p role="status">
      예상 표면 착륙 ·{' '}
      <output data-testid="planner-touchdown">{message}</output>
      {failed && (
        <button
          type="button"
          onClick={() => {
            setFailed(false)
            setMessage('계산 중…')
            setAttempt((value) => value + 1)
          }}
        >
          착륙 시각 다시 계산
        </button>
      )}
    </p>
  )
}
