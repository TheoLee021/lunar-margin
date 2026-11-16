import { useEffect, useRef, useState } from 'react'
import { layerUrl, type Candidate, type RunDetail } from '../api/candidates'
import { formatPrice } from '../api/pricing'
import {
  degText,
  fractionText,
  funnelSteps,
  scoreText,
  xyToImage,
} from './derive'
import { ReservationPanel } from './ReservationPanel'
import { MetricDistributions } from './MetricDistributions'
import { useRun } from './useRuns'
import { useAvailability } from './useAvailability'
import { useCandidatePrices } from './useCandidatePrices'
import './candidate-overview.css'

const overviewLabels: Readonly<Record<string, string>> = {
  sampled: 'Sites sampled',
  computed: 'Sites evaluated',
  eligible: 'Sites meeting requirements',
  in_regions: 'Sites in connected regions',
  selected: 'Selected sites',
  rf_incomplete: 'Missing radio link data',
  rf_fraction_below_min: 'Radio link available too infrequently',
  rf_blackout_hours_above_max: 'Radio blackout exceeds limit',
  sun_fraction_below_min: 'Insufficient sunlight',
  sun_dark_hours_above_max: 'Continuous darkness exceeds limit',
  earth_fraction_below_min: 'Insufficient Earth visibility',
  earth_blackout_hours_above_max: 'Loss of Earth visibility exceeds limit',
  horizon_incomplete: 'Horizon extends beyond terrain coverage',
  terrain_slope_above_max: 'Local slope exceeds limit (95th percentile)',
  terrain_incomplete: 'Incomplete terrain data',
  terrain_roughness_above_max:
    'Local roughness exceeds limit (95th percentile)',
  no_metrics: 'No metrics available',
  not_refined: 'Not selected for finer sampling',
  within_min_separation: 'Too close to a higher-ranked site',
  beyond_top_k: 'Outside the shortlist',
}

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
      lang="en"
      ref={dialog}
      aria-label="Landing site selection"
      className="co co-panel"
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
    >
      <header className="co-bar">
        <strong>LUNAR MARGIN</strong>
        <span>Landing site selection</span>
        <button type="button" className="co-close hud-button" onClick={onClose}>
          Close ×
        </button>
      </header>
      {state.status === 'ok' ? (
        <Board run={state.data} />
      ) : (
        <p role="status">
          {state.status === 'loading' ? (
            'Loading saved results…'
          ) : (
            <>
              Couldn’t load the saved results.{' '}
              <button onClick={reload}>Try again</button>
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
  const reservationDialog = useRef<HTMLDialogElement>(null)
  const [reservationOpen, setReservationOpen] = useState(false)
  function reserveButton(candidateId: string) {
    return (
      <button
        type="button"
        className="co-available"
        aria-haspopup="dialog"
        onClick={() => {
          setPicked(candidateId)
          setReservationOpen(true)
          reservationDialog.current?.showModal()
        }}
      >
        Available
      </button>
    )
  }
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
    ? excluded.map(([id, value]) => ({
        id,
        label: overviewLabels[id] ?? id.replaceAll('_', ' '),
        value,
      }))
    : steps.map((step) => ({
        ...step,
        label: overviewLabels[step.id] ?? step.id,
      }))
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
      <dialog
        className="co-reservation"
        aria-label="Reserve a landing site"
        ref={reservationDialog}
        onClose={() => setReservationOpen(false)}
        onCancel={(event) => event.stopPropagation()}
      >
        {reservationOpen && (
          <>
            <header className="co-head">
              <h2>Reserve a landing site · {picked}</h2>
              <button
                type="button"
                className="hud-button"
                onClick={() => reservationDialog.current?.close()}
              >
                Close ×
              </button>
            </header>
            <ReservationPanel
              embedded
              mission={run.mission ?? null}
              selected={booking ?? null}
              onChanged={availability.reload}
            />
          </>
        )}
      </dialog>
      <div className="co-title">
        <div>
          <small>Lunar south pole</small>
          <h1>Landing site selection</h1>
        </div>
        <p>
          {run.mission && (
            <>
              Landing {run.mission.landing_date} <b> / </b>
              {run.mission.mission_duration_days}-day mission <b> / </b>
            </>
          )}
          {run.config.grid_spacing_m} m grid
        </p>
      </div>
      <div className="co-layout">
        <section className="co-card co-map">
          <div className="co-head">
            <h2>South pole map</h2>
            <div className="co-toggle">
              {(['sun', 'earth'] as const).map((m) => (
                <button
                  key={m}
                  aria-pressed={m === metric}
                  onClick={() => setMetric(m)}
                >
                  {m === 'sun' ? 'Sunlight' : 'Earth visibility'}
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
              <svg
                viewBox="0 0 100 100"
                aria-label="Candidate sites near the lunar south pole"
              >
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
                  return (
                    <circle
                      key={c.id}
                      cx={x}
                      cy={y}
                      r=".6"
                      fill="#101216"
                      stroke="white"
                      strokeWidth=".15"
                    />
                  )
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
                  aria-label={`Candidate ranked ${site.rank}`}
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
            <p role="status">This map layer could not be loaded.</p>
          )}
          <div className="co-legend">
            <span>{metric === 'sun' ? 'Sunlight' : 'Earth visibility'}</span>0%{' '}
            <i /> 100%
          </div>
          {active && (
            <div className="co-selected">
              <small>Selected site · Science rank #{active.rank}</small>
              <h3>{active.id}</h3>
              <p>
                {Math.abs(active.lat_deg).toFixed(3)}°
                {active.lat_deg < 0 ? 'S' : 'N'}, {active.lon_deg.toFixed(2)}°E
              </p>
              <div className="co-booking">
                <div>
                  <h4>Reservation details</h4>
                  <button
                    type="button"
                    onClick={availability.reload}
                    disabled={availability.state.status === 'loading'}
                  >
                    Refresh
                  </button>
                </div>
                <div role="status">
                  {availability.state.status === 'loading'
                    ? 'Checking availability…'
                    : availability.state.status === 'error'
                      ? 'Couldn’t check availability. Try refreshing.'
                      : booking?.status === 'available'
                        ? reserveButton(picked!)
                        : booking?.status === 'reserved'
                          ? 'Reserved'
                          : 'Availability unknown'}
                </div>
                {period && (
                  <p>
                    Reservation window: {period.starts_at.slice(0, 10)} →{' '}
                    {period.ends_at.slice(0, 10)} UTC · end date excluded
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
                Ranked sites <em>{sites.length}</em>
              </h2>
              <small>By science score</small>
            </div>
            <div
              className="co-table"
              role="region"
              aria-label="Ranked sites"
              tabIndex={0}
            >
              <table>
                <thead>
                  <tr>
                    {[
                      'Rank',
                      'Site ID',
                      'Sunlight',
                      'Earth visibility',
                      'Price¹',
                      'Score',
                      'Longest RF blackout',
                      'Local slope (P95)',
                      'Local roughness (P95)',
                      `Visible grid points (5 km · ${run.config.observer_height_m} m height)`,
                    ].map((h) => (
                      <th key={h}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sites.map((c) => {
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
                          {c.rf?.longest_blackout_hours == null
                            ? '—'
                            : `${c.rf.longest_blackout_hours} h`}
                        </td>
                        <td>{degText(c.terrain?.slope_p95_deg ?? null)}</td>
                        <td>
                          {c.terrain?.roughness_p95_m == null
                            ? '—'
                            : `${c.terrain.roughness_p95_m.toFixed(2)} m`}
                        </td>
                        <td>
                          {c.score.visible_grid_points == null
                            ? '—'
                            : `${c.score.visible_grid_points} / 120`}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              {!sites.length && <p>No sites meet the mission requirements.</p>}
            </div>
            <footer>
              ¹ Estimated price in USD for a 24 kg payload delivered to the
              surface.
            </footer>
          </section>
          <div className="co-stats">
            <section className="co-card">
              <div className="co-head">
                <h2>Metric distributions</h2>
              </div>
              <MetricDistributions
                english
                values={run.summary.distributions}
                includeRF={run.config.rf != null}
              />
            </section>
            <section className="co-card">
              <div className="co-head">
                <h2>Selection summary</h2>
              </div>
              <div className="co-pad">
                <div className="co-toggle">
                  {['Selection stages', 'Reasons for exclusion'].map((s, i) => (
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
                {!bars.length && <small>No counts are available.</small>}
              </div>
            </section>
          </div>
        </div>
      </div>
    </>
  )
}
