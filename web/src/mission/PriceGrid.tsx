import { useEffect, useState } from 'react'
import {
  fetchRun,
  fetchRuns,
  type MissionRequest,
  type RunSummary,
} from '../api/candidates'
import { formatPrice, isTransitPossible, type Delivery } from '../api/pricing'
import type { departureAvailability } from '../api/launchSchedule'
import type { ProviderCalendarInput } from '../api/providerPricing'
import { dayOf, iso, short } from './missionDates'
import type { Schedule } from './types'
import { useProviderCalendar } from './useProviderCalendar'

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
  quoted: '계산 완료',
  estimated: '모델 예상 비용',
  no_published_quote: '공개 견적 없음',
  no_launch: '발사 일정 없음',
  search_required: '미계산',
  partial_coverage: '견적 일부',
  invalid_transit: '전이 불가',
  no_eligible: '적합 격자 없음',
  not_computed: '미계산',
  running: '탐색 중',
  failed: '탐색 실패',
  unavailable: '판단 불가',
}
export type DepartureStatus = {
  departure: string
  launchId: string | null
  unavailable: boolean
}

export function PriceGrid({
  departures,
  landings,
  draft,
  availability,
  isNonLunarLaunch = false,
  onSelect,
  onDepartureStatus,
}: {
  departures: number[]
  landings: number[]
  draft: Schedule
  isNonLunarLaunch?: boolean
  availability: (departure: string) => ReturnType<typeof departureAvailability>
  onSelect: (departure: string, landing: string) => void
  onDepartureStatus: (status: DepartureStatus) => void
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
  const scheduledDepartures = departures.filter(
    (day) => availability(iso(day)) === 'scheduled',
  )
  const input: ProviderCalendarInput | null =
    valid && sourceReady && scheduledDepartures.length > 0
      ? {
          estimate: true,
          selected_launch_id: draft.launchId ?? null,
          mass_kg: massNumber,
          delivery,
          landing_dates: landings.map(iso),
          departure_dates: scheduledDepartures.map(iso),
          source_run_id: source || null,
          mission: {
            ...mission,
            landing_date: iso(landings[0]!),
            mission_duration_days: draft.duration,
            max_continuous_darkness_hours: dark,
            max_communication_blackout_hours: black,
          },
        }
      : null
  const calendar = useProviderCalendar(input)
  const data = calendar.data
  useEffect(() => {
    if (!data) return
    const departureCells = data.cells.filter(
      (cell) => cell.departure_date === draft.departure,
    )
    if (!departureCells.length) return
    onDepartureStatus({
      departure: draft.departure,
      launchId: draft.launchId ?? null,
      unavailable: departureCells.some((cell) => cell.status === 'no_launch'),
    })
  }, [data, draft.departure, draft.launchId, onDepartureStatus])
  const prices =
    data?.cells.flatMap((cell) =>
      cell.mean_min_usd === null ? [] : [cell.mean_min_usd],
    ) ?? []
  const minimum = Math.min(...prices)
  const hasMissing =
    data?.dates.some((row) => row.state !== 'completed') ?? true
  function candidateHref(
    departure: number,
    landing: number,
    runId: string,
    launchId = draft.launchId,
  ) {
    const url = new URL(window.location.href)
    url.pathname = '/'
    url.searchParams.set('view', 'search')
    url.searchParams.delete('planner')
    url.searchParams.set('departure', iso(departure))
    url.searchParams.set('arrival', iso(landing))
    url.searchParams.set('duration', String(draft.duration))
    url.searchParams.set('run', runId)
    url.searchParams.set('mass_kg', String(massNumber))
    url.searchParams.set('delivery', delivery)
    if (launchId) url.searchParams.set('launch_id', launchId)
    else url.searchParams.delete('launch_id')
    return `${url.pathname}${url.search}`
  }
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
              ? calendar.waiting
                ? '다른 탐색 완료 대기 중…'
                : '날짜별 탐색 중…'
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
      {calendar.waiting ? (
        <p role="status">
          다른 탐색이 진행 중입니다 · {calendar.waiting.run_id}
          {calendar.waiting.total > 0
            ? ` · ${calendar.waiting.done.toLocaleString()}/${calendar.waiting.total.toLocaleString()}`
            : ''}
          {' · '}완료 후 선택한 날짜 계산을 자동으로 시작합니다.
        </p>
      ) : calendar.calculating ? (
        <p role="status">날짜별 가격 계산 중…</p>
      ) : null}
      {data?.selection && isNonLunarLaunch ? (
        <p role="note" className="hint text-amber-200">
          일반 발사일을 사용한 달 배송 시뮬레이션입니다. 실제 달 배송편이
          아닙니다.
        </p>
      ) : null}
      {data?.selection ? (
        <section
          aria-label="선택한 발사사의 가격 모델"
          className="mb-3 text-sm"
        >
          <p className="text-amber-300">
            {data.selection.company_name} 모델 예상 비용 ·{' '}
            {data.selection.tariff_basis === 'public_tariff'
              ? '공개 단가'
              : '공통 참조 단가'}{' '}
            ${data.selection.tariff_usd_per_kg.toLocaleString('en-US')}/kg
            {' · '}고정비 ${data.selection.fixed_usd.toLocaleString('en-US')}
          </p>
          <p className="hint">
            {data.selection.launch_name} · 같은 적합 500m 격자 전체의 산술평균 ·
            실제 견적 아님
          </p>
          <details>
            <summary>적용 근거와 가정</summary>
            <p className="hint">{data.selection.assumptions.join(' · ')}</p>
            <a
              href={data.selection.tariff_source.url}
              target="_blank"
              rel="noreferrer"
            >
              {data.selection.tariff_source.title} ↗
            </a>
          </details>
        </section>
      ) : !draft.launchId ? (
        <p className="mb-3 text-xs text-neutral-400">
          발사일 기준 달 배송 비용 시뮬레이션 · 각 500m 적합 격자의 최저 예상
          비용 평균 · 실제 달 배송편·운임 아님
        </p>
      ) : null}
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
              const rowOffer = data?.cells.find(
                (c) =>
                  c.landing_date === iso(l) &&
                  c.departure_date === draft.departure,
              )
              return (
                <tr key={l}>
                  <th scope="row">
                    {row?.state === 'completed' &&
                    rowOffer?.status !== 'no_launch' &&
                    availability(draft.departure) === 'scheduled' &&
                    isTransitPossible(draft.departure, iso(l)) ? (
                      <a
                        href={candidateHref(
                          dayOf(draft.departure),
                          l,
                          row.run_id,
                          rowOffer?.lowest_launch_id ?? draft.launchId,
                        )}
                        aria-label={`${short(l)} · 착륙 ${iso(l)} 후보지 탐색 열기`}
                      >
                        {short(l)}
                      </a>
                    ) : (
                      short(l)
                    )}
                  </th>
                  {departures.map((d) => {
                    const possible = isTransitPossible(iso(d), iso(l))
                    const offer = data?.cells.find(
                      (cell) =>
                        cell.landing_date === iso(l) &&
                        cell.departure_date === iso(d),
                    )
                    const departureState =
                      offer?.status === 'no_launch'
                        ? 'no_launch'
                        : availability(iso(d))
                    const companyNames = offer?.lowest_company_names.length
                      ? offer.lowest_company_names
                      : data?.selection
                        ? [data.selection.company_name]
                        : []
                    const mean = offer?.mean_min_usd ?? null
                    const label = offer
                      ? STATE_LABELS[offer.status]
                      : calendar.loading
                        ? '불러오는 중'
                        : '미계산'
                    const selected =
                      dayOf(draft.departure) === d && dayOf(draft.landing) === l
                    const className =
                      mean !== null && mean <= minimum * 1.05
                        ? 'low-cost'
                        : undefined
                    const accessibleLabel = `출발 ${iso(d)}, 착륙 ${iso(l)}, ${mean !== null ? `${draft.launchId ? '회사 모델 평균' : '최저가 평균'} ${formatPrice(mean)}` : label}${mean !== null && companyNames.length ? `, ${companyNames.join(' · ')}` : ''}`
                    const completed = row?.state === 'completed'
                    const content = (
                      <>
                        <span>{mean !== null ? formatPrice(mean) : label}</span>
                        {mean !== null ? (
                          companyNames.length > 0 ? (
                            <small>{companyNames.join(' · ')}</small>
                          ) : null
                        ) : (
                          <small>
                            {offer?.status === 'partial_coverage'
                              ? `견적 ${offer.quoted_grid_count}/${offer.eligible_grid_count}개 격자`
                              : (row?.message ?? `${l - d}일 비행`)}
                          </small>
                        )}
                      </>
                    )
                    return (
                      <td key={d}>
                        {departureState !== 'scheduled' ? (
                          <div
                            className="invalid-cell"
                            aria-label={`출발 ${iso(d)}: ${departureState === 'no_launch' ? '발사 일정 없음' : departureState === 'loading' ? '일정 확인 중' : '일정 미확인'}`}
                          >
                            <span>
                              {departureState === 'no_launch'
                                ? '발사 일정 없음'
                                : departureState === 'loading'
                                  ? '일정 확인 중'
                                  : '일정 미확인'}
                            </span>
                          </div>
                        ) : !possible ? (
                          <div
                            className="invalid-cell"
                            title="전이는 3~150일이어야 합니다"
                          >
                            —<small>전이 3~150일</small>
                          </div>
                        ) : completed ? (
                          <a
                            href={candidateHref(
                              d,
                              l,
                              row.run_id,
                              offer?.lowest_launch_id ?? draft.launchId,
                            )}
                            aria-label={`${accessibleLabel}, 후보지 탐색 열기`}
                            aria-current={selected ? 'date' : undefined}
                            className={className}
                            title="이 날짜의 저장된 후보지 탐색 결과 열기"
                          >
                            {content}
                          </a>
                        ) : (
                          <button
                            type="button"
                            aria-pressed={selected}
                            aria-label={accessibleLabel}
                            className={className}
                            onClick={() => onSelect(iso(d), iso(l))}
                          >
                            {content}
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
          낮은 평균 예상 비용
        </span>
        <span>
          <i />
          선택한 조합
        </span>
        <span>
          공개 발사 예정일만 표시 · 전이 3~150일 · 열: 출발일 · 행: 착륙일 / UTC
        </span>
      </div>
    </>
  )
}
