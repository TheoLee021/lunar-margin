import { useEffect, useState } from 'react'
import {
  fetchRun,
  fetchRuns,
  type MissionRequest,
  type RunSummary,
} from '../api/candidates'
import {
  formatPrice,
  isTransitPossible,
  type CalendarInput,
  type Delivery,
} from '../api/pricing'
import { dayOf, iso, short } from './missionDates'
import type { Schedule } from './types'
import { usePriceCalendar } from './usePriceCalendar'

const DEFAULT_MISSION: MissionRequest = {
  landing_date: '2027-01-10',
  mission_duration_days: 14,
  max_continuous_darkness_hours: 24,
  max_communication_blackout_hours: 6,
  max_terrain_slope_degrees: null,
  search_region: 'south',
  optimization_priority: 'balanced',
  observer_height_m: null,
}
const DELIVERY_LABELS: Record<Delivery, string> = {
  orbit: '달 궤도 투입',
  surface: '표면 하역',
  rover_delivery: '로버 배송',
}
const STATE_LABELS = {
  ready: '계산 완료',
  no_eligible: '적합 격자 없음',
  not_computed: '미계산',
  running: '탐색 중',
  failed: '탐색 실패',
  unavailable: '판단 불가',
}

export function PriceGrid({
  departures,
  landings,
  draft,
  onSelect,
}: {
  departures: number[]
  landings: number[]
  draft: Schedule
  onSelect: (departure: string, landing: string) => void
}) {
  const [mass, setMass] = useState('24')
  const [delivery, setDelivery] = useState<Delivery>('surface')
  const [mission, setMission] = useState(DEFAULT_MISSION)
  const [darkness, setDarkness] = useState('24')
  const [blackout, setBlackout] = useState('6')
  const [runs, setRuns] = useState<RunSummary[]>([])
  const [source, setSource] = useState(
    () => new URLSearchParams(window.location.search).get('pricing_run') ?? '',
  )
  const [sourceState, setSourceState] = useState({
    id: '',
    loading: false,
    error: '',
  })
  const [listError, setListError] = useState('')
  const [listRevision, setListRevision] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    fetchRuns({ signal: controller.signal })
      .then((result) => {
        if (!controller.signal.aborted) {
          setRuns(result.runs)
          setListError('')
        }
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setListError(error instanceof Error ? error.message : String(error))
      })
    return () => controller.abort()
  }, [listRevision])
  useEffect(() => {
    if (!source) return
    const controller = new AbortController()
    fetchRun(source, { signal: controller.signal })
      .then((run) => {
        if (controller.signal.aborted) return
        if (!run.mission)
          throw new Error('임무 조건이 저장된 탐색 실행을 선택하세요.')
        setMission(run.mission)
        setDarkness(run.mission.max_continuous_darkness_hours?.toString() ?? '')
        setBlackout(
          run.mission.max_communication_blackout_hours?.toString() ?? '',
        )
        setSourceState({ id: source, loading: false, error: '' })
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setSourceState({
            id: source,
            loading: false,
            error: error instanceof Error ? error.message : String(error),
          })
      })
    return () => controller.abort()
  }, [source])
  const optional = (value: string) =>
    value.trim() === '' ? null : Number(value)
  const massNumber = Number(mass),
    dark = optional(darkness),
    black = optional(blackout)
  const valid =
    massNumber > 0 &&
    massNumber <= 1_000_000 &&
    Number.isFinite(massNumber) &&
    (dark === null || (Number.isFinite(dark) && dark >= 0)) &&
    (black === null || (Number.isFinite(black) && black >= 0))
  const sourceReady =
    source === '' || (sourceState.id === source && !sourceState.error)
  const input: CalendarInput | null =
    valid && sourceReady
      ? {
          mass_kg: massNumber,
          delivery,
          landing_dates: landings.map(iso),
          mission: {
            ...mission,
            landing_date: iso(landings[0]!),
            mission_duration_days: draft.duration,
            max_continuous_darkness_hours: dark,
            max_communication_blackout_hours: black,
          },
        }
      : null
  const calendar = usePriceCalendar(input)
  const data = calendar.data
  const prices =
    data?.dates
      .filter(
        (row) =>
          row.state === 'ready' &&
          departures.some((d) => isTransitPossible(iso(d), row.landing_date)),
      )
      .map((row) => row.pricing!.mean!.adjusted_usd) ?? []
  const minimum = Math.min(...prices)
  const hasMissing =
    data?.dates.some((row) => !['ready', 'no_eligible'].includes(row.state)) ??
    true
  return (
    <>
      <div className="price-inputs">
        <label>
          화물 질량 · kg
          <input
            type="number"
            min="0.001"
            max="1000000"
            step="any"
            value={mass}
            onChange={(e) => setMass(e.target.value)}
          />
        </label>
        <label>
          배송 방식
          <select
            value={delivery}
            onChange={(e) => setDelivery(e.target.value as Delivery)}
          >
            {Object.entries(DELIVERY_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          추천 모델의 임무 조건
          <select
            aria-label="가격 비교에 사용할 탐색 조건"
            value={source}
            onChange={(e) => {
              setSource(e.target.value)
              setSourceState({ id: '', loading: true, error: '' })
              if (!e.target.value) {
                setMission(DEFAULT_MISSION)
                setDarkness('24')
                setBlackout('6')
              }
            }}
          >
            <option value="">새 임무 조건</option>
            {runs.map((run) => (
              <option key={run.id} value={run.id}>
                {run.id.startsWith('dev-') ? '개발용 조건' : '정밀 탐색'} ·{' '}
                {run.window.start.slice(0, 10)} · {run.id}
              </option>
            ))}
          </select>
        </label>
        <label>
          최장 연속 어둠 ≤ 시간
          <input
            type="number"
            min="0"
            step="any"
            placeholder="조건 없음"
            value={darkness}
            onChange={(e) => setDarkness(e.target.value)}
          />
        </label>
        <label>
          최장 통신 두절 ≤ 시간
          <input
            type="number"
            min="0"
            step="any"
            placeholder="조건 없음"
            value={blackout}
            onChange={(e) => setBlackout(e.target.value)}
          />
        </label>
        <div className="price-actions">
          <button
            type="button"
            disabled={!input || calendar.calculating || !hasMissing}
            onClick={() => {
              void calendar.calculate()
            }}
          >
            {calendar.calculating
              ? '날짜별 탐색 중…'
              : '미계산 날짜 탐색 · 500m'}
          </button>
          {calendar.calculating ? (
            <button type="button" onClick={calendar.stop}>
              화면 업데이트 중단
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                calendar.reload()
                setListRevision((v) => v + 1)
              }}
            >
              새로고침
            </button>
          )}
        </div>
      </div>
      {source && !sourceReady && !sourceState.error ? (
        <p role="status">탐색 조건을 불러오는 중…</p>
      ) : null}
      {sourceState.error ? (
        <p role="alert">{sourceState.error} 다른 탐색 실행을 선택하세요.</p>
      ) : null}
      {listError ? (
        <p role="alert">
          탐색 목록: {listError}{' '}
          <button type="button" onClick={() => setListRevision((v) => v + 1)}>
            목록 다시 시도
          </button>
        </p>
      ) : null}
      {!valid ? (
        <p role="alert">
          질량은 0 초과~1,000,000kg, 어둠·두절 한도는 0 이상의 숫자로
          입력하세요.
        </p>
      ) : null}
      {calendar.loading ? (
        <p role="status">날짜별 가격을 불러오는 중…</p>
      ) : null}
      {calendar.error ? (
        <p role="alert">
          {calendar.error}{' '}
          <button type="button" onClick={calendar.reload}>
            가격 다시 시도
          </button>
        </p>
      ) : null}
      {calendar.calculating ? <p role="status">날짜별 가격 계산 중…</p> : null}
      <div className="grid-scroll">
        <table className="cost-grid" aria-label="출발일과 착륙일별 평균 가격">
          <thead>
            <tr>
              <th scope="col" className="axis-cell">
                착륙 ↓<br />
                출발 →
              </th>
              {departures.map((d) => (
                <th key={d} scope="col">
                  {short(d)}
                  <small>
                    {new Intl.DateTimeFormat('en-US', {
                      weekday: 'short',
                      timeZone: 'UTC',
                    }).format(d * 86_400_000)}
                  </small>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {landings.map((l) => {
              const row = data?.dates.find((r) => r.landing_date === iso(l))
              const mean = row?.pricing?.mean
              return (
                <tr key={l}>
                  <th scope="row">{short(l)}</th>
                  {departures.map((d) => {
                    const possible = isTransitPossible(iso(d), iso(l))
                    const label = row
                      ? STATE_LABELS[row.state]
                      : calendar.loading
                        ? '불러오는 중'
                        : '미계산'
                    return (
                      <td key={d}>
                        {!possible ? (
                          <div
                            className="invalid-cell"
                            title="전이는 3~150일이어야 합니다"
                          >
                            —<small>전이 3~150일</small>
                          </div>
                        ) : (
                          <button
                            type="button"
                            aria-pressed={
                              dayOf(draft.departure) === d &&
                              dayOf(draft.landing) === l
                            }
                            aria-label={`출발 ${iso(d)}, 착륙 ${iso(l)}, ${mean ? `평균 ${formatPrice(mean.adjusted_usd)}` : label}`}
                            className={
                              mean && mean.adjusted_usd <= minimum * 1.05
                                ? 'low-cost'
                                : undefined
                            }
                            onClick={() => onSelect(iso(d), iso(l))}
                          >
                            <span>
                              {mean ? formatPrice(mean.adjusted_usd) : label}
                            </span>
                            {mean ? (
                              <>
                                <small>
                                  {formatPrice(mean.range_low_usd)}–
                                  {formatPrice(mean.range_high_usd)}
                                </small>
                                <small>
                                  {row!.pricing!.counts.priced.toLocaleString()}
                                  개 격자 평균 · {l - d}일 비행
                                </small>
                              </>
                            ) : (
                              <small>{row?.message ?? `${l - d}일 비행`}</small>
                            )}
                          </button>
                        )}
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div className="grid-key">
        <span>
          <i />
          낮은 평균 가격
        </span>
        <span>
          <i />
          선택한 조합
        </span>
        <span>전이 3~150일 · 열: 출발일 · 행: 착륙일 / UTC</span>
      </div>
    </>
  )
}
