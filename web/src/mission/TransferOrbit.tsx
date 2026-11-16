import { MoonDisc } from './MoonDisc'
import { useEffect, useId, useState } from 'react'
import {
  project,
  relativePosition,
  incomingFrame,
  fitProjection,
  pathOf,
  type TransferData,
} from './transferData'
import type { Schedule } from './types'
import { fetchTransfer } from '../api/transfer'
import { ApiError } from '../api/client'

type LoadState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; data: TransferData }

export function TransferOrbit({
  active,
  schedule,
  latitude,
  longitude,
  durationS,
}: {
  active: boolean
  schedule: Schedule
  latitude: number
  longitude: number
  durationS: number
}) {
  const [stored, setStored] = useState<{
    key: string
    state: LoadState
  } | null>(null)
  const [attempt, setAttempt] = useState(0)
  const { departure, landing: arrival } = schedule
  const key = `${departure}|${arrival}|${latitude}|${longitude}|${durationS}|${attempt}`
  const state: LoadState =
    stored?.key === key ? stored.state : { kind: 'loading' }
  useEffect(() => {
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      void fetchTransfer(
        departure,
        arrival,
        {
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(45_000),
          ]),
        },
        { latitude, longitude, durationS },
      )
        .then((data) => {
          if (!controller.signal.aborted)
            setStored({ key, state: { kind: 'ready', data } })
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) return
          const message =
            error instanceof ApiError && error.status === 422
              ? 'No trajectory is available for these dates. Choose dates between 1900 and 2100 with a flight time of 1 to 10 days.'
              : error instanceof ApiError && error.status === 503
                ? 'The SPICE data needed for this trajectory is unavailable.'
                : error instanceof ApiError && error.status === 429
                  ? 'Another trajectory is being calculated. Try again shortly.'
                  : 'Unable to calculate the trajectory. Check the API connection and try again.'
          setStored({ key, state: { kind: 'error', message } })
        })
    }, 450)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [departure, arrival, key, latitude, longitude, durationS])
  return (
    <section className="transfer-section" aria-label="Earth–Moon trajectory">
      <div className="window-toolbar">
        <div>
          <div className="section-kicker">EARTH → MOON · LUNAR CAPTURE</div>
          <h3>Earth–Moon trajectory</h3>
        </div>
        <span className="example-label">Calculated for selected dates</span>
      </div>
      {state.kind === 'loading' ? (
        <p className="orbit-status" role="status">
          Calculating the trajectory for your dates…
        </p>
      ) : state.kind === 'error' ? (
        <div className="orbit-status" role="alert">
          <p>{state.message}</p>
          <button
            type="button"
            onClick={() => {
              setAttempt((n) => n + 1)
            }}
          >
            Recalculate trajectory
          </button>
        </div>
      ) : (
        <OrbitPlayback key={key} data={state.data} active={active} />
      )}
      <p className="orbit-note">
        The model uses DE440 lunar positions at 00:00 UTC and Earth and Moon
        gravity. The spacecraft leaves a 200 km Earth parking orbit and enters
        lunar orbit at 100 km. The model selects the departure plane and adjusts
        the lunar orbit plane for the target landing site ({latitude}°,{' '}
        {longitude}°).
      </p>
    </section>
  )
}

function OrbitPlayback({
  data,
  active,
}: {
  data: TransferData
  active: boolean
}) {
  const [index, setIndex] = useState(0)
  const [playing, setPlaying] = useState(false)
  const gradient = useId()
  const samples = [...data.transfer, ...data.capture.slice(1)]
  const last = samples.length - 1
  const finished = index >= last
  useEffect(() => {
    if (!active || !playing || finished) return
    const timer = window.setInterval(
      () => setIndex((i) => Math.min(i + 6, last)),
      50,
    )
    return () => window.clearInterval(timer)
  }, [active, playing, last, finished])
  const running = playing && index < last
  const current = samples[index]!
  const captured = current.seconds >= data.capture[0]!.seconds
  const transfer = data.transfer.map((s) => project(data, s.spacecraft_km))
  const moonArrival = project(data, data.capture[0]!.moon_km)
  const extent = 450_000
  const fit = fitProjection(
    [
      [-extent, -extent],
      [extent, extent],
    ],
    600,
    560,
    64,
  )
  const earth = fit.at([0, 0])
  const moon = fit.at(project(data, current.moon_km))
  const departureMoon = fit.at(project(data, data.transfer[0]!.moon_km))
  const arrivalMoon = fit.at(moonArrival)
  const ship = fit.at(project(data, current.spacecraft_km))
  const moonMotion = data.transfer.map((s) => project(data, s.moon_km))
  const moonOrbit = data.moon_orbit_km.map((position) =>
    project(data, position),
  )
  const captureFrame = {
    plane_x: data.capture_plane_x,
    plane_y: data.capture_plane_y,
  }
  const inbound = incomingFrame(data)
  const approach = data.transfer
    .filter((s) => s.seconds >= data.capture[0]!.seconds - 2.6 * 3600)
    .map((s) => project(inbound, relativePosition(s)))
  const orbit = data.capture.map((s) =>
    project(captureFrame, relativePosition(s)),
  )
  const close = fitProjection(
    [
      [-4500, -4500],
      [4500, 4500],
    ],
    600,
    560,
    64,
  )
  const center = close.at([0, 0])
  const closeShip = close.at(
    project(captured ? captureFrame : inbound, relativePosition(current)),
  )
  const showCloseShip =
    closeShip[0] >= 84 &&
    closeShip[0] <= 516 &&
    closeShip[1] >= 64 &&
    closeShip[1] <= 496
  const insertion = close.at(orbit[0]!)
  const overviewClip = `${gradient}-overview`
  const closeClip = `${gradient}-close`
  const hours = current.seconds / 3600
  return (
    <>
      <div className="orbit-plot-grid">
        <figure className="orbit-plot">
          <figcaption>
            <strong>Earth-centered transfer</strong>
            <span>Earth parking orbit to lunar approach</span>
          </figcaption>
          <svg
            viewBox="0 0 600 560"
            role="img"
            aria-label="Lunar orbit and spacecraft transfer from Earth to the Moon"
          >
            <defs>
              <radialGradient id={gradient} cx="30%" cy="25%">
                <stop stopColor="#9bd3ed" />
                <stop offset="1" stopColor="#183c50" />
              </radialGradient>
              <clipPath id={overviewClip}>
                <rect x="84" y="64" width="432" height="432" />
              </clipPath>
            </defs>
            <PlotAxes
              at={fit.at}
              ticks={[-400000, -200000, 0, 200000, 400000]}
              divisor={1000}
              unit="10³ km"
            />
            <g clipPath={`url(#${overviewClip})`}>
              <path
                d={pathOf(moonOrbit.map(fit.at))}
                className="orbit-reference-path"
              />
              <path
                d={pathOf(moonMotion.map(fit.at))}
                className="orbit-moon-motion"
              />
              <path
                d={pathOf(transfer.map(fit.at))}
                className="orbit-transfer-path"
              />
              <circle
                cx={earth[0]}
                cy={earth[1]}
                r="10"
                fill={`url(#${gradient})`}
              />
              <circle
                cx={departureMoon[0]}
                cy={departureMoon[1]}
                r="5"
                className="orbit-event-dot"
              />
              <circle
                cx={arrivalMoon[0]}
                cy={arrivalMoon[1]}
                r="5"
                className="orbit-event-dot"
              />
              <circle
                cx={moon[0]}
                cy={moon[1]}
                r="7"
                fill="#c5d3df"
                stroke="#0e1216"
                strokeWidth="2"
              />
              <circle
                cx={ship[0]}
                cy={ship[1]}
                r="5"
                fill="#fff1cf"
                stroke="#eab563"
                strokeWidth="2"
                data-testid="transfer-spacecraft"
              />
            </g>
            <g className="orbit-annotations">
              <text x={earth[0] - 16} y={earth[1] + 27} textAnchor="end">
                Earth at departure
              </text>
              <text
                x={departureMoon[0] - 12}
                y={departureMoon[1] - 12}
                textAnchor="end"
              >
                Moon at departure
              </text>
              <text
                x={arrivalMoon[0] - 8}
                y={arrivalMoon[1] - 18}
                textAnchor="end"
              >
                Moon at insertion
              </text>
            </g>
          </svg>
          <div className="orbit-plot-legend">
            <span className="key-reference">Lunar path over 29 days</span>
            <span className="key-motion">Lunar motion during flight</span>
            <span className="key-transfer">Spacecraft trajectory</span>
          </div>
        </figure>
        <figure className="orbit-plot">
          <figcaption>
            <strong>Moon-centered approach and capture</strong>
            <span>
              Approach and capture planes aligned at lunar orbit insertion (LOI)
            </span>
          </figcaption>
          <svg
            viewBox="0 0 600 560"
            role="img"
            aria-label="Lunar approach and the first 14 hours in orbit around the Moon"
          >
            <defs>
              <clipPath id={closeClip}>
                <rect x="84" y="64" width="432" height="432" />
              </clipPath>
            </defs>
            <PlotAxes
              at={close.at}
              ticks={[-4000, -2000, 0, 2000, 4000]}
              divisor={1}
              unit="km"
            />
            <g clipPath={`url(#${closeClip})`}>
              <MoonDisc
                x={center[0]}
                y={center[1]}
                radius={data.moon_radius_km * close.scale}
                id={`${gradient}-moon`}
              />
              <path
                d={pathOf(approach.map(close.at))}
                className="orbit-transfer-path"
              />
              <path
                d={pathOf(orbit.map(close.at))}
                className="orbit-capture-path"
              />
              <circle
                cx={insertion[0]}
                cy={insertion[1]}
                r="5"
                fill="#eab563"
              />
              {showCloseShip ? (
                <circle
                  cx={closeShip[0]}
                  cy={closeShip[1]}
                  r="5"
                  fill="#fff1cf"
                  stroke="#0e1216"
                  strokeWidth="1.5"
                />
              ) : null}
            </g>
            <g className="orbit-annotations">
              <text
                x={center[0]}
                y={center[1] + data.moon_radius_km * close.scale + 30}
                textAnchor="middle"
              >
                Moon
              </text>
              <path
                d={`M${insertion[0] - 3},${insertion[1] - 8} l-18,-28 h-65`}
                fill="none"
                stroke="#a7b5c3"
              />
              <text
                x={insertion[0] - 25}
                y={insertion[1] - 44}
                textAnchor="end"
              >
                LOI · altitude 100 km
              </text>
            </g>
          </svg>
          <div className="orbit-plot-legend">
            <span className="key-surface">Lunar surface</span>
            <span className="key-transfer">Approach</span>
            <span className="key-capture">Circular orbit after insertion</span>
          </div>
        </figure>
      </div>
      <dl className="orbit-metrics">
        <div>
          <dt>Flight time</dt>
          <dd>
            {data.metrics.travel_time_days.toFixed(3)} <small>days</small>
          </dd>
        </div>
        <div>
          <dt>Insertion altitude</dt>
          <dd>
            {data.metrics.arrival_altitude_km.toFixed(0)} <small>km</small>
          </dd>
        </div>
        <div>
          <dt>Departure TLI Δv</dt>
          <dd>
            {data.metrics.tli_delta_v_km_s.toFixed(3)} <small>km/s</small>
          </dd>
        </div>
        <div>
          <dt>Insertion LOI Δv</dt>
          <dd>
            {data.metrics.loi_delta_v_km_s.toFixed(3)} <small>km/s</small>
          </dd>
        </div>
      </dl>
      <div className="orbit-controls">
        <div>
          <button
            type="button"
            onClick={() => {
              if (index === last) setIndex(0)
              setPlaying(!running)
            }}
            aria-label={
              running ? 'Pause trajectory playback' : 'Play trajectory'
            }
          >
            {running ? 'Ⅱ Pause' : '▶ Play'}
          </button>
          <button
            type="button"
            onClick={() => {
              setPlaying(false)
              setIndex(data.transfer.length - 1)
            }}
          >
            Jump to orbit insertion
          </button>
        </div>
        <output aria-live="off">
          T+{Math.floor(hours / 24)}d {Math.floor(hours % 24)}h ·{' '}
          {captured ? 'In lunar orbit' : 'En route to the Moon'}
        </output>
        <input
          type="range"
          min="0"
          max={last}
          step="1"
          value={index}
          aria-label="Trajectory playback time"
          onChange={(e) => {
            setPlaying(false)
            setIndex(Number(e.target.value))
          }}
        />
        <div className="orbit-legend">
          <span>Transfer and approach</span>
          <span>First 14 hours in lunar orbit</span>
        </div>
      </div>
    </>
  )
}

function PlotAxes({
  at,
  ticks,
  divisor,
  unit,
}: {
  at: (point: [number, number]) => [number, number]
  ticks: number[]
  divisor: number
  unit: string
}) {
  return (
    <g className="orbit-axes">
      <rect
        x="84"
        y="64"
        width="432"
        height="432"
        className="orbit-plot-frame"
      />
      {ticks.map((value) => {
        const x = at([value, 0])[0],
          y = at([0, value])[1]
        return (
          <g key={value}>
            <path d={`M${x} 64V496 M84 ${y}H516`} />
            <text x={x} y="516" textAnchor="middle">
              {value / divisor}
            </text>
            <text x="73" y={y + 4} textAnchor="end">
              {value / divisor}
            </text>
          </g>
        )
      })}
      <text x="300" y="547" textAnchor="middle">
        Projected x [{unit}]
      </text>
      <text x="26" y="280" textAnchor="middle" transform="rotate(-90 26 280)">
        Projected y [{unit}]
      </text>
    </g>
  )
}

// Surface shading is illustrative; the disc radius still uses the plot's km scale.
