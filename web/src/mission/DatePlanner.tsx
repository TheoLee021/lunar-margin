import { useEffect, useRef, useState } from 'react'
import { dayOf, iso, short } from './missionDates'
import { MissionCharts } from './MissionCharts'
import { demoDateScore } from './demoDateScore'
import type { Schedule } from './types'
import { DateSchema, ScheduleSchema } from './scheduleSchema'
import { PriceGrid } from './PriceGrid'
import { LaunchDeparture } from './LaunchDeparture'
import {
  fetchLaunchSchedule,
  departureAvailability,
  type LaunchSchedule,
} from '../api/launchSchedule'
import { isTransitPossible } from '../api/pricing'
import './date-planner.css'

type Props = {
  schedule: Schedule
  onViewOrbit: (schedule: Schedule) => void
  onApply: (schedule: Schedule) => void
  onClose: () => void
}
export function DatePlanner({
  schedule,
  onApply,
  onViewOrbit,
  onClose,
}: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  const [draft, setDraft] = useState(schedule)
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
  const canApply =
    availability(draft.departure) === 'scheduled' &&
    isTransitPossible(draft.departure, draft.landing)
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
  function shiftAnchors(step: number) {
    setAnchors((a) => ({
      departure: iso(dayOf(a.departure) + step),
      landing: iso(dayOf(a.landing) + step),
    }))
  }

  function selectLanding(landing: string) {
    const departure = draft.departure
    setDraft((d) => ({ ...d, departure, landing }))
    setAnchors({ departure, landing })
  }
  return (
    <dialog
      id="datePlanner"
      ref={ref}
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
            미션 날짜 <span className="tag">UTC</span>
          </h2>
          <p className="hint">출발일과 착륙일을 비교하세요.</p>
        </div>
        <button
          type="button"
          className="close-planner"
          onClick={onClose}
          aria-label="날짜 패널 닫기"
        >
          ✕
        </button>
      </header>
      <div className="planner-layout">
        <div className="planner-primary">
          <section className="window-section">
            <div className="window-toolbar">
              <div>
                <h3>출발일 × 착륙일</h3>
                <p>500m 격자 평균 예상 비용 · USD million</p>
              </div>
              <div className="week-nav">
                <button
                  type="button"
                  aria-label="기준일 하루 이전"
                  onClick={() => shiftAnchors(-1)}
                >
                  ←
                </button>
                <span>{anchors.departure.slice(0, 7)} · ±2일</span>
                <button
                  type="button"
                  aria-label="기준일 하루 이후"
                  onClick={() => shiftAnchors(1)}
                >
                  →
                </button>
              </div>
            </div>
            <LaunchDeparture
              data={launchData}
              error={launchError}
              onRetry={() => setLaunchRevision((v) => v + 1)}
              selectedId={draft.launchId ?? null}
              onClear={() => setDraft((d) => ({ ...d, launchId: null }))}
              onSelect={(launch) => {
                const departure = launch.departure_date
                if (!departure) return
                setAnchors((a) => ({ ...a, departure }))
                setDraft((d) => ({ ...d, departure, launchId: launch.id }))
              }}
            />
            <div className="date-anchors">
              <label>
                기준 출발일 · UTC
                <input
                  type="date"
                  value={anchors.departure}
                  onChange={(e) => {
                    const value = e.target.value
                    if (DateSchema.safeParse(value).success) {
                      setFormError('')
                      setAnchors((a) => ({ ...a, departure: value }))
                      setDraft((d) => ({ ...d, departure: value }))
                    } else setFormError('유효한 출발일을 입력하세요.')
                  }}
                />
              </label>
              <span>→</span>
              <label>
                기준 착륙일 · UTC
                <input
                  type="date"
                  value={anchors.landing}
                  onChange={(e) => {
                    const value = e.target.value
                    if (DateSchema.safeParse(value).success) {
                      setFormError('')
                      setAnchors((a) => ({ ...a, landing: value }))
                      setDraft((d) => ({ ...d, landing: value }))
                    } else setFormError('유효한 착륙일을 입력하세요.')
                  }}
                />
              </label>
              <label>
                착륙 후 표면 임무
                <select
                  value={draft.duration}
                  onChange={(e) => {
                    const duration = Number(e.target.value)
                    setDraft((d) => ({ ...d, duration }))
                  }}
                >
                  {[7, 14, 28].map((d) => (
                    <option key={d} value={d}>
                      {d}일
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <PriceGrid
              departures={departures}
              landings={landings}
              draft={draft}
              availability={availability}
              onSelect={(departure, landing) =>
                setDraft((s) => ({ ...s, departure, landing }))
              }
            />
            {availability(draft.departure) !== 'scheduled' ? (
              <p className="hint" role="status">
                출발일의 발사 일정을 확인해야 일정을 적용할 수 있습니다.
                날짜표는 공개된 발사 예정일만 활성화합니다.
              </p>
            ) : null}
            {formError ? (
              <p role="alert" className="hint">
                {formError}
              </p>
            ) : null}
          </section>
          {validDraft ? (
            <>
              <MissionCharts score={score} onLanding={selectLanding} />
            </>
          ) : (
            <section className="group" role="status">
              <h2>일정을 확인하세요</h2>
              <p className="hint">
                착륙일을 출발일 이후로 선택하면 일정 분석이 표시됩니다.
              </p>
            </section>
          )}
        </div>
      </div>
      <footer className="planner-footer">
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
            이 일정의 궤도 보기 ↗
          </button>
          <button
            type="button"
            id="applyWindow"
            disabled={!validDraft || !canApply}
            onClick={() => {
              const result = ScheduleSchema.safeParse(draft)
              if (result.success && canApply) {
                setFormError('')
                onApply(result.data)
              } else
                setFormError(
                  '착륙일은 출발일 이후여야 하며 임무 기간은 7·14·28일이어야 합니다.',
                )
            }}
          >
            일정 적용 <span>↗</span>
          </button>
        </div>
      </footer>
    </dialog>
  )
}
