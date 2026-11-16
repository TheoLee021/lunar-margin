import { approachFromUrl } from '../flight/approach'
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
            <span>선택한 일정의 지구–달 비행과 표면 착륙을 확인하세요.</span>
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
              <OrbitPanels
                key={JSON.stringify([
                  schedule,
                  siteId,
                  flight.get('lat'),
                  flight.get('lon'),
                ])}
                schedule={parsed.data}
                approach={approachFromUrl(flight)}
                example={!flight.has('lat')}
                mode={mode}
                onMode={setMode}
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

function OrbitPanels({
  schedule,
  approach,
  example,
  mode,
  onMode,
}: {
  schedule: Schedule
  approach: ReturnType<typeof approachFromUrl>
  example: boolean
  mode: Mode
  onMode: (mode: Mode) => void
}) {
  const [visitedBoth, setVisitedBoth] = useState(false)
  const [request, setRequest] = useState<FlightRequest>(() => ({
    departure: schedule.departure,
    arrival: schedule.landing,
    ...approach,
    alignmentToleranceM: 5000,
    wetMassKg: 1200,
    dryMassKg: 450,
    maxThrustN: 15000,
    ispS: 310,
  }))
  return (
    <>
      <div
        className="orbit-view-switch"
        role="group"
        aria-label="비행 구간 보기"
      >
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
            {value === 'transfer' ? '지구–달 비행 궤도' : '착륙'}
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
          <Suspense fallback={<p role="status">착륙 화면을 불러오는 중…</p>}>
            <FlightWorkspace
              active={mode === 'landing'}
              request={request}
              setRequest={setRequest}
              example={
                example &&
                request.latitude === approach.latitude &&
                request.longitude === approach.longitude
              }
            />
          </Suspense>
        </div>
      )}
    </>
  )
}
