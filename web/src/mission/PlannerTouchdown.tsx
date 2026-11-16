import { useEffect, useState } from 'react'
import { requestFlightPreview, type FlightRequest } from '../flight/flightApi'
import { ApiError } from '../api/client'
import { utc } from '../flight/flightPlan'

export function PlannerTouchdown({ request }: { request: FlightRequest }) {
  const [message, setMessage] = useState('Calculating…')
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
              : 'Unavailable',
          )
      } catch (error) {
        if (!controller.signal.aborted) {
          setFailed(true)
          setMessage(
            error instanceof ApiError && error.status === 429
              ? 'Another trajectory is being calculated. Try again shortly.'
              : 'Unable to calculate touchdown time.',
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
      Estimated touchdown ·{' '}
      <output data-testid="planner-touchdown">{message}</output>
      {failed && (
        <button
          type="button"
          onClick={() => {
            setFailed(false)
            setMessage('Calculating…')
            setAttempt((value) => value + 1)
          }}
        >
          Recalculate touchdown time
        </button>
      )}
    </p>
  )
}
