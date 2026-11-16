import { usePricingSettings } from './usePricingSettings'
import { TransferOrbit } from './TransferOrbit'
import { PlannerTouchdown } from './PlannerTouchdown'
import { useFlightPlan } from '../flight/flightPlan'
import { useEffect, useRef, useState } from 'react'
import { dayOf, short } from './missionDates'
import { MissionCharts } from './MissionCharts'
import { demoDateScore } from './demoDateScore'
import type { Schedule } from './types'
import { ScheduleSchema } from './scheduleSchema'
import { PriceGrid, type DepartureStatus } from './PriceGrid'
import {
  fetchLaunchSchedule,
  departureAvailability,
  type LaunchSchedule,
} from '../api/launchSchedule'
import { isTransitPossible } from '../api/pricing'
import './date-planner.css'

type Props = {
  site?: { latitude: number; longitude: number }
  selectedSiteId: string | null
  schedule: Schedule
  onViewOrbit: (schedule: Schedule) => void
  onApply: (schedule: Schedule) => void
  onClose: () => void
}
export function DatePlanner({
  schedule,
  site,
  selectedSiteId,
  onApply,
  onViewOrbit,
  onClose,
}: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  const [draft, setDraft] = useState(schedule)
  const [slope, setSlope] = useState(schedule.maxSlope?.toString() ?? '')
  const settings = usePricingSettings(slope, setSlope)
  const maxSlope = slope === '' ? null : Number(slope)
  const samePeriod =
    draft.landing === schedule.landing && draft.duration === schedule.duration
  const plan = useFlightPlan(draft, samePeriod ? site : null)
  const [anchors, setAnchors] = useState({
    departure: schedule.departure,
    landing: schedule.landing,
  })
  const departures = Array.from(
    { length: 5 },
    (_, i) => dayOf(anchors.departure) + i - 2,
  )
  const landings = Array.from(
    { length: 5 },
    (_, i) => dayOf(anchors.landing) + i - 2,
  )
  const [launchData, setLaunchData] = useState<LaunchSchedule | null>(null)
  const [launchError, setLaunchError] = useState('')
  const [launchRevision, setLaunchRevision] = useState(0)
  const [departureStatus, setDepartureStatus] =
    useState<DepartureStatus | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    fetchLaunchSchedule({ signal: controller.signal })
      .then((data) => {
        if (!controller.signal.aborted) {
          setLaunchData(data)
          setLaunchError('')
        }
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setLaunchError(error instanceof Error ? error.message : String(error))
      })
    return () => controller.abort()
  }, [launchRevision])
  const availability = (departure: string) =>
    departureAvailability(launchData, launchError, draft.launchId, departure)
  const transitPossible = isTransitPossible(draft.departure, draft.landing)
  const departureUnavailable =
    departureStatus?.departure === draft.departure &&
    departureStatus.launchId === (draft.launchId ?? null) &&
    departureStatus.unavailable
  const canApply =
    (maxSlope === null || (maxSlope > 0 && maxSlope <= 90)) &&
    settings.valid &&
    settings.sourceReady &&
    !departureUnavailable &&
    availability(draft.departure) === 'scheduled' &&
    transitPossible

  const validDraft = ScheduleSchema.safeParse(draft).success
  const score = validDraft ? demoDateScore(draft) : null
  const [formError, setFormError] = useState('')
  useEffect(() => {
    const dialog = ref.current!,
      trigger = document.activeElement as HTMLElement | null
    dialog.showModal()
    return () => {
      dialog.close()
      trigger?.focus()
    }
  }, [])
  function selectLanding(landing: string) {
    const departure = draft.departure
    setDraft((d) => ({ ...d, departure, landing }))
    setAnchors({ departure, landing })
  }
  return (
    <dialog
      id="datePlanner"
      lang="en"
      ref={ref}
      className="date-compare"
      aria-labelledby="plannerTitle"
      onCancel={onClose}
      onClick={(e) => {
        if (e.target !== e.currentTarget) return
        const r = e.currentTarget.getBoundingClientRect()
        if (
          e.clientX < r.left ||
          e.clientX > r.right ||
          e.clientY < r.top ||
          e.clientY > r.bottom
        )
          onClose()
      }}
    >
      <header className="planner-header">
        <div>
          <h2 id="plannerTitle">
            Date grid and flight trajectory <span className="tag">UTC</span>
          </h2>
        </div>
        <button
          type="button"
          className="close-planner"
          onClick={onClose}
          aria-label="Close date planner"
        >
          ✕
        </button>
      </header>
      <div className="planner-layout date-comparison-body">
        <div className="planner-primary">
          <section className="window-section">
            <div className="window-toolbar">
              <h3>Estimated cost (USD millions)</h3>
            </div>
            <PriceGrid
              departures={departures}
              landings={landings}
              draft={draft}
              availability={availability}
              settings={settings}
              onDepartureStatus={setDepartureStatus}
              onSelect={(departure, landing) =>
                setDraft((s) => ({ ...s, departure, landing }))
              }
            />
            {settings.sourceError || !settings.valid ? (
              <p role="alert">Unable to use the supplied pricing conditions.</p>
            ) : null}
            {launchError ? (
              <p role="alert">
                Unable to load launch dates.{' '}
                <button
                  type="button"
                  onClick={() => setLaunchRevision((v) => v + 1)}
                >
                  Try again
                </button>
              </p>
            ) : departureUnavailable ? (
              <p className="hint" role="status">
                No launch is scheduled for the selected departure date.
              </p>
            ) : availability(draft.departure) !== 'scheduled' ? (
              <p className="hint" role="status">
                A published launch date is required to apply this schedule.
                Select an available departure in the grid.
              </p>
            ) : null}
            {formError ? (
              <p role="alert" className="hint">
                {formError}
              </p>
            ) : null}
          </section>
          {validDraft &&
            (samePeriod && selectedSiteId && !site ? (
              <p role="status">Loading landing site coordinates</p>
            ) : (
              <TransferOrbit
                active
                schedule={draft}
                latitude={plan.request.latitude}
                longitude={plan.request.longitude}
                durationS={plan.request.durationS}
              />
            ))}
          {validDraft ? (
            <>
              <details className="date-analysis">
                <summary>Surface mission analysis by arrival date</summary>
                <MissionCharts score={score} onLanding={selectLanding} />
              </details>
            </>
          ) : (
            <section className="group" role="status">
              <h2>Check your dates</h2>
              <p className="hint">
                Choose an arrival date after departure to see the analysis.
              </p>
            </section>
          )}
        </div>
      </div>
      <footer className="planner-footer">
        {validDraft &&
          (samePeriod && selectedSiteId && !site ? (
            <p role="status">Loading landing site coordinates</p>
          ) : (
            <PlannerTouchdown
              key={JSON.stringify(plan.request)}
              request={plan.request}
            />
          ))}
        {validDraft && !transitPossible ? (
          <p role="status">
            Transit must take 3 to 150 days. Selected duration:{' '}
            {dayOf(draft.landing) - dayOf(draft.departure)} days.
          </p>
        ) : null}
        <div>
          <span aria-live="polite">
            {short(dayOf(draft.departure))} → {short(dayOf(draft.landing))}
          </span>
          <button
            type="button"
            className="planner-orbit-link"
            disabled={!validDraft}
            onClick={() => {
              const result = ScheduleSchema.safeParse(draft)
              if (result.success) onViewOrbit(result.data)
            }}
          >
            View trajectory details ↗
          </button>
          <button
            type="button"
            id="applyWindow"
            disabled={!validDraft || !canApply}
            onClick={() => {
              const result = ScheduleSchema.safeParse(draft)
              if (result.success && canApply) {
                setFormError('')
                onApply({ ...result.data, maxSlope })
              } else
                setFormError(
                  'Choose an arrival date after departure and a surface mission of 7, 14, or 28 days.',
                )
            }}
          >
            Apply schedule <span>↗</span>
          </button>
        </div>
      </footer>
    </dialog>
  )
}
