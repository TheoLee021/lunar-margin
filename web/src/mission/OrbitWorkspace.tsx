import { useFlightPlan } from '../flight/flightPlan'
import { useDashboardRun } from './useDashboardRun'
import { lazy, Suspense, useState } from 'react'
import type { FlightRequest } from '../flight/flightApi'
import { TransferOrbit } from './TransferOrbit'
import { ScheduleSchema } from './scheduleSchema'
import type { Schedule } from './types'
import './date-planner.css'
import './orbit-workspace.css'

const FlightWorkspace = lazy(() => import('../flight/FlightWorkspace'))
type Mode = 'transfer' | 'landing'

type Props = {
  initialLanding: boolean
  siteId: string | null
  schedule: Schedule
  onScheduleChange: (schedule: Schedule) => void
  onBack: () => void
}
export default function OrbitWorkspace({
  schedule,
  initialLanding,
  siteId,
  onScheduleChange,
  onBack,
}: Props) {
  const [mode, setMode] = useState<Mode>(
    initialLanding ? 'landing' : 'transfer',
  )
  const [draft, setDraft] = useState(schedule)
  const parsed = ScheduleSchema.safeParse(draft)
  const { result } = useDashboardRun(schedule)
  const candidate =
    result.kind === 'ready'
      ? result.run.candidates.find((c) => c.id === siteId)
      : null
  const plan = useFlightPlan(
    schedule,
    candidate
      ? { latitude: candidate.lat_deg, longitude: candidate.lon_deg }
      : null,
  )
  const example =
    !candidate && !new URLSearchParams(window.location.search).has('lat')
  function change(field: 'departure' | 'landing', value: string) {
    const next = { ...draft, [field]: value }
    setDraft(next)
    const result = ScheduleSchema.safeParse(next)
    if (result.success) onScheduleChange(result.data)
  }
  return (
    <main className="orbit-workspace" lang="en">
      <div className="orbit-page-content">
        <header className="orbit-page-header">
          <div>
            <p>Lunar Margin</p>
            <h1>Flight trajectory</h1>
            <span>
              Explore the Earth–Moon transfer and lunar landing for your
              selected dates.
            </span>
          </div>
          <button type="button" className="hud-button" onClick={onBack}>
            ← Back to date planner
          </button>
        </header>
        <section className="orbit-date-form" aria-label="Trajectory dates">
          <label>
            Earth departure · UTC
            <input
              type="date"
              value={draft.departure}
              onChange={(e) => change('departure', e.target.value)}
            />
          </label>
          <span aria-hidden="true">→</span>
          <label>
            Lunar arrival · UTC (orbit insertion)
            <input
              type="date"
              value={draft.landing}
              onChange={(e) => change('landing', e.target.value)}
            />
          </label>
          <p>
            Changing the dates recalculates the trajectory.
            <br />
            The planner keeps your dates and {schedule.duration}-day surface
            mission.
          </p>
        </section>
        {parsed.success ? (
          <>
            {siteId && !candidate ? (
              <p role="status">
                {result.kind === 'loading'
                  ? 'Loading landing site coordinates…'
                  : 'Unable to load the landing site coordinates. Choose the site again in the date planner.'}
              </p>
            ) : (
              <OrbitPanels
                key={JSON.stringify([schedule, siteId])}
                schedule={parsed.data}
                request={plan.request}
                setRequest={plan.apply}
                example={example}
                mode={mode}
                onMode={setMode}
              />
            )}
          </>
        ) : (
          <p role="alert" className="orbit-date-error">
            Choose a departure date and a later arrival date. The planner keeps
            your last valid schedule.
          </p>
        )}
      </div>
    </main>
  )
}

function OrbitPanels({
  schedule,
  request,
  setRequest,
  example,
  mode,
  onMode,
}: {
  schedule: Schedule
  request: FlightRequest
  setRequest: (request: FlightRequest) => void
  example: boolean
  mode: Mode
  onMode: (mode: Mode) => void
}) {
  const [visitedBoth, setVisitedBoth] = useState(false)
  const [initial] = useState(request)
  return (
    <>
      <div className="orbit-view-switch" role="group" aria-label="Flight phase">
        {(['transfer', 'landing'] as const).map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={mode === value}
            onClick={() => {
              if (value !== mode) {
                setVisitedBoth(true)
                onMode(value)
              }
            }}
          >
            {value === 'transfer' ? 'Earth–Moon transfer' : 'Landing'}
          </button>
        ))}
      </div>
      {(mode === 'transfer' || visitedBoth) && (
        <div hidden={mode !== 'transfer'}>
          <TransferOrbit
            active={mode === 'transfer'}
            schedule={schedule}
            latitude={request.latitude}
            longitude={request.longitude}
            durationS={request.durationS}
          />
        </div>
      )}
      {(mode === 'landing' || visitedBoth) && (
        <div hidden={mode !== 'landing'}>
          <Suspense fallback={<p role="status">Loading landing view…</p>}>
            <FlightWorkspace
              active={mode === 'landing'}
              request={request}
              setRequest={setRequest}
              example={
                example &&
                request.latitude === initial.latitude &&
                request.longitude === initial.longitude
              }
            />
          </Suspense>
        </div>
      )}
    </>
  )
}
