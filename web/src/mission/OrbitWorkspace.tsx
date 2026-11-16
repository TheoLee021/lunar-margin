import { approachFromUrl } from '../flight/approach'
import { useDashboardRun } from './useDashboardRun'
import { useState } from 'react'
import { TransferOrbit } from './TransferOrbit'
import { ScheduleSchema } from './scheduleSchema'
import type { Schedule } from './types'
import './date-planner.css'
import './orbit-workspace.css'

type Props = {
  siteId: string | null
  schedule: Schedule
  onScheduleChange: (schedule: Schedule) => void
  onBack: () => void
}
export default function OrbitWorkspace({
  schedule,
  siteId,
  onScheduleChange,
  onBack,
}: Props) {
  const [draft, setDraft] = useState(schedule)
  const parsed = ScheduleSchema.safeParse(draft)
  const { result } = useDashboardRun(schedule)
  const candidate =
    result.kind === 'ready'
      ? result.run.candidates.find((c) => c.id === siteId)
      : null
  const flight = new URLSearchParams(window.location.search)
  flight.set('departure', schedule.departure)
  flight.set('arrival', schedule.landing)
  if (candidate) {
    flight.set('lat', String(candidate.lat_deg))
    flight.set('lon', String(candidate.lon_deg))
  }
  function change(field: 'departure' | 'landing', value: string) {
    const next = { ...draft, [field]: value }
    setDraft(next)
    const result = ScheduleSchema.safeParse(next)
    if (result.success) onScheduleChange(result.data)
  }
  return (
    <main className="orbit-workspace">
      <div className="orbit-page-content">
        <header className="orbit-page-header">
          <div>
            <p>Lunar Margin</p>
            <h1>비행 궤도</h1>
            <span>선택한 일정의 지구–달 전이와 달 궤도 진입을 검토하세요.</span>
          </div>
          <button type="button" className="hud-button" onClick={onBack}>
            ← 날짜 계획으로 돌아가기
          </button>
        </header>
        <section className="orbit-date-form" aria-label="궤도 계산 일정">
          <label>
            지구 출발일 · UTC
            <input
              type="date"
              value={draft.departure}
              onChange={(e) => change('departure', e.target.value)}
            />
          </label>
          <span aria-hidden="true">→</span>
          <label>
            달 궤도 진입일 · UTC
            <input
              type="date"
              value={draft.landing}
              onChange={(e) => change('landing', e.target.value)}
            />
          </label>
          <p>
            날짜를 바꾸면 자동으로 다시 계산합니다.
            <br />
            돌아가도 선택한 일정과 표면 임무 {schedule.duration}일은 유지됩니다.
          </p>
        </section>
        {parsed.success ? (
          <>
            {siteId && !candidate ? (
              <p role="status">
                {result.kind === 'loading'
                  ? '착륙 후보 좌표를 불러오는 중…'
                  : '선택한 착륙지 좌표를 불러올 수 없습니다. 날짜 계획에서 후보를 다시 선택하세요.'}
              </p>
            ) : (
              <a className="hud-button" href={`/flight?${flight}`}>
                착륙까지 보기 ↗
              </a>
            )}
            {(!siteId || candidate) && (
              <TransferOrbit
                schedule={parsed.data}
                {...approachFromUrl(flight)}
              />
            )}
          </>
        ) : (
          <p role="alert" className="orbit-date-error">
            유효한 출발일과 그 이후의 도착일을 선택하세요. 돌아가면 마지막
            유효한 일정이 유지됩니다.
          </p>
        )}
      </div>
    </main>
  )
}
