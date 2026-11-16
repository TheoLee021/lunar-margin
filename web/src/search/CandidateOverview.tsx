import { useEffect, useRef, useState } from 'react'
import { layerUrl, type Candidate, type RunDetail } from '../api/candidates'
import { formatPrice } from '../api/pricing'
import {
  fractionText,
  funnelSteps,
  reasonLabel,
  scoreText,
  xyToImage,
} from './derive'
import { Distribution } from './Distribution'
import { useRun } from './useRuns'
import { useAvailability } from './useAvailability'
import { useCandidatePrices } from './useCandidatePrices'
import './candidate-overview.css'

export default function CandidateOverview({
  runId,
  onClose,
}: {
  runId: string
  onClose: () => void
}) {
  const { state, reload } = useRun(runId)
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const element = dialog.current!
    element.showModal()
    return () => element.close()
  }, [])
  return (
    <dialog
      ref={dialog}
      aria-label="후보지 선정"
      className="co co-panel"
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
    >
      <header className="co-bar">
        <strong>
          LUNAR <b>MARGIN</b>
        </strong>
        <span>후보지 선정</span>
        <button type="button" className="co-close hud-button" onClick={onClose}>
          닫기 ×
        </button>
      </header>
      {state.status === 'ok' ? (
        <Board run={state.data} />
      ) : (
        <p role="status">
          {state.status === 'loading' ? (
            '저장 결과를 불러오는 중…'
          ) : (
            <>
              결과 조회 실패 · {state.message}{' '}
              <button onClick={reload}>다시 시도</button>
            </>
          )}
        </p>
      )}
    </dialog>
  )
}

function Board({ run }: { run: RunDetail }) {
  const sites = run.candidates
  const [picked, setPicked] = useState(sites[0]?.id)
  const [metric, setMetric] = useState<'sun' | 'earth'>('sun')
  const [failed, setFailed] = useState<string[]>([])
  const [reasons, setReasons] = useState(false)
  const active = sites.find((c) => c.id === picked)
  const availability = useAvailability(run.id)
  const period =
    availability.state.status === 'ready' ? availability.state.data : null
  const booking = period?.candidates.find(
    (item) => item.candidate_id === picked,
  )
  const prices = useCandidatePrices(run.id)
  const map = run.map
  const layers = (
    [metric === 'sun' ? 'coarse_sun' : 'coarse_earth', metric] as const
  ).filter((layer) => map.layers.includes(layer))
  const steps = funnelSteps(run.summary.counts, run.summary.reasons)
  const excluded = Object.entries(run.summary.reasons)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
  const bars = reasons
    ? excluded.map(([id, value]) => ({ id, label: reasonLabel(id), value }))
    : steps
  const pins = sites.filter((c) => c.rank <= 5 || c.id === picked)
  const placed: { x: number; y: number }[] = []
  function location(c: Candidate) {
    const { u, v } = xyToImage(c.x_m, c.y_m, map)
    return { x: (100 * u) / map.size_px, y: (100 * v) / map.size_px }
  }
  function badge(x: number, y: number) {
    for (let radius = 4; radius < 48; radius += 4) {
      for (let angle = 0; angle < 360; angle += 45) {
        const a = (angle * Math.PI) / 180
        const px = x + radius * Math.cos(a),
          py = y + radius * Math.sin(a)
        if (
          px > 4 &&
          px < 96 &&
          py > 5 &&
          py < 95 &&
          placed.every((p) => Math.hypot(p.x - px, p.y - py) > 7)
        ) {
          placed.push({ x: px, y: py })
          return { x: px, y: py }
        }
      }
    }
    return { x, y }
  }
  const markers = pins.map((site) => {
    const point = location(site)
    return { site, point, label: badge(point.x, point.y) }
  })
  return (
    <>
      <div className="co-title">
        <div>
          <small>남극 착륙지 분석</small>
          <h1>후보지 선정</h1>
        </div>
        <p>
          {run.mission?.landing_date} 착륙 <b> / </b>
          {run.mission?.mission_duration_days}일 임무 <b> / </b>
          {run.config.grid_spacing_m} m 격자
        </p>
      </div>
      <div className="co-layout">
        <section className="co-card co-map">
          <div className="co-head">
            <h2>남극 탐색 지도</h2>
            <div className="co-toggle">
              {(['sun', 'earth'] as const).map((m) => (
                <button
                  key={m}
                  aria-pressed={m === metric}
                  onClick={() => setMetric(m)}
                >
                  {m === 'sun' ? '일조율' : '지구 LOS'}
                </button>
              ))}
            </div>
          </div>
          <div className="co-field">
            <div className="co-disc">
              {layers.map((layer) => (
                <img
                  key={layer}
                  alt=""
                  src={layerUrl(run.id, layer)}
                  onError={() =>
                    setFailed((prev) =>
                      prev.includes(layer) ? prev : [...prev, layer],
                    )
                  }
                />
              ))}
              <svg viewBox="0 0 100 100" aria-label="남극 지도 후보 위치">
                <circle
                  cx="50"
                  cy="50"
                  r="49.5"
                  fill="none"
                  stroke="#94a5ab"
                  strokeWidth=".15"
                  strokeDasharray=".6 1"
                />
                {sites.map((c) => {
                  const { x, y } = location(c)
                  return <circle key={c.id} cx={x} cy={y} r=".6" fill="white" />
                })}
                {markers.map(({ site, point, label }) => (
                  <path
                    key={site.id}
                    d={`M ${point.x} ${point.y} L ${label.x} ${label.y}`}
                    stroke="white"
                    strokeWidth=".32"
                  />
                ))}
              </svg>
              {markers.map(({ site, label }) => (
                <button
                  key={site.id}
                  type="button"
                  className="co-marker"
                  style={{ left: `${label.x}%`, top: `${label.y}%` }}
                  aria-label={`지도 후보 ${site.rank}위`}
                  aria-pressed={picked === site.id}
                  onClick={() => setPicked(site.id)}
                >
                  {site.rank}
                </button>
              ))}
              <span className="co-n">0°</span>
              <span className="co-e">90°E</span>
              <span className="co-s">180°</span>
              <span className="co-w">270°E</span>
            </div>
          </div>
          {(!layers.length || layers.some((l) => failed.includes(l))) && (
            <p role="status">지도 레이어를 불러올 수 없습니다.</p>
          )}
          <div className="co-legend">
            <span>{metric === 'sun' ? '일조율' : '지구 가시율'}</span>0% <i />{' '}
            100%
          </div>
          {active && (
            <div className="co-selected">
              <small>선택한 후보 · 과학 순위 {active.rank}위</small>
              <h3>{active.id}</h3>
              <p>
                {active.lat_deg.toFixed(3)}° 위도　{active.lon_deg.toFixed(2)}°E
                경도
              </p>
              <div className="co-booking">
                <div>
                  <h4>예약 정보</h4>
                  <button
                    type="button"
                    onClick={availability.reload}
                    disabled={availability.state.status === 'loading'}
                  >
                    새로고침
                  </button>
                </div>
                <div role="status">
                  {availability.state.status === 'loading'
                    ? '예약 조회 중…'
                    : availability.state.status === 'error'
                      ? availability.state.message
                      : booking?.status === 'available'
                        ? '예약 가능'
                        : booking?.status === 'reserved'
                          ? '예약됨'
                          : '예약 정보 미확인'}
                </div>
                {period && (
                  <p>
                    조회 기간 {period.starts_at.slice(0, 10)} →{' '}
                    {period.ends_at.slice(0, 10)} UTC · 종료일 제외
                  </p>
                )}
                {booking?.conflicts.map((item) => (
                  <p key={item.id}>
                    <b>
                      {item.company} · {item.mission_name}
                    </b>
                    <br />
                    {item.starts_at.slice(0, 10)} → {item.ends_at.slice(0, 10)}{' '}
                    UTC
                  </p>
                ))}
              </div>
            </div>
          )}
        </section>
        <div className="co-right">
          <section className="co-card">
            <div className="co-head">
              <h2>
                선정된 후보 <em>{sites.length}곳</em>
              </h2>
              <small>과학 점수순</small>
            </div>
            <div className="co-table">
              <table>
                <thead>
                  <tr>
                    {[
                      '순위',
                      '후보 ID',
                      '일조율',
                      '지구 LOS',
                      '가격¹',
                      '점수',
                      '예약',
                    ].map((h) => (
                      <th key={h}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sites.map((c) => {
                    const status =
                      availability.state.status === 'ready'
                        ? availability.state.data.candidates.find(
                            (a) => a.candidate_id === c.id,
                          )?.status
                        : null
                    const price =
                      prices.state.status === 'ok'
                        ? prices.state.data.get(c.id)?.price
                        : null
                    return (
                      <tr
                        key={c.id}
                        data-active={picked === c.id}
                        onClick={() => setPicked(c.id)}
                      >
                        <td>{String(c.rank).padStart(2, '0')}</td>
                        <td>
                          <button
                            onClick={() => setPicked(c.id)}
                            aria-pressed={picked === c.id}
                          >
                            {c.id}
                          </button>
                        </td>
                        <td>{fractionText(c.sun.fraction)}</td>
                        <td>{fractionText(c.earth.fraction)}</td>
                        <td>{price ? formatPrice(price.adjusted_usd) : '—'}</td>
                        <td>{scoreText(c.score.total)}</td>
                        <td>
                          {status === 'available'
                            ? '가능'
                            : status === 'reserved'
                              ? '예약됨'
                              : availability.state.status === 'loading'
                                ? '조회 중'
                                : '미확인'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              {!sites.length && <p>조건을 만족하는 후보가 없습니다.</p>}
            </div>
            <footer>
              ¹ 24 kg 표면 하역 기준 · USD 추정{' '}
              {availability.state.status === 'error' &&
                '　|　예약 정보 연결 안 됨'}
            </footer>
          </section>
          <div className="co-stats">
            <section className="co-card">
              <div className="co-head">
                <h2>지표 분포</h2>
              </div>
              <div className="co-pad">
                {(
                  [
                    { key: 'sun_fraction', title: '일조율', unit: 'fraction' },
                    {
                      key: 'earth_fraction',
                      title: '지구 가시율',
                      unit: 'fraction',
                    },
                    {
                      key: 'sun_longest_dark_h',
                      title: '최장 연속 암흑',
                      unit: 'hours',
                    },
                  ] as const
                ).map((d) => (
                  <Distribution
                    key={d.key}
                    title={d.title}
                    hint=""
                    values={run.summary.distributions[d.key] ?? {}}
                    unit={d.unit}
                  />
                ))}
              </div>
            </section>
            <section className="co-card">
              <div className="co-head">
                <h2>결과 요약</h2>
              </div>
              <div className="co-pad">
                <div className="co-toggle">
                  {['선정 단계', '탈락 사유'].map((s, i) => (
                    <button
                      key={s}
                      aria-pressed={Number(reasons) === i}
                      onClick={() => setReasons(Boolean(i))}
                    >
                      {s}
                    </button>
                  ))}
                </div>
                {bars.map((b) => (
                  <div className="co-count" key={b.id}>
                    <label>
                      {b.label}
                      <b>{b.value.toLocaleString()}</b>
                    </label>
                    <div>
                      <i
                        style={{
                          width: `${(100 * b.value) / (bars[0]?.value || 1)}%`,
                          background: reasons ? '#dcae66' : undefined,
                        }}
                      />
                    </div>
                  </div>
                ))}
                {!bars.length && <small>집계된 항목이 없습니다.</small>}
              </div>
            </section>
          </div>
        </div>
      </div>
    </>
  )
}
