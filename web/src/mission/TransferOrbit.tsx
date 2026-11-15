import { useEffect, useId, useState } from 'react'
import {
  project,
  relativePosition,
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

export function TransferOrbit({ schedule }: { schedule: Schedule }) {
  const [stored, setStored] = useState<{
    key: string
    state: LoadState
  } | null>(null)
  const [attempt, setAttempt] = useState(0)
  const { departure, landing: arrival } = schedule
  const key = `${departure}|${arrival}|${attempt}`
  const state: LoadState =
    stored?.key === key ? stored.state : { kind: 'loading' }
  useEffect(() => {
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      void fetchTransfer(departure, arrival, {
        signal: AbortSignal.any([
          controller.signal,
          AbortSignal.timeout(45_000),
        ]),
      })
        .then((data) => {
          if (!controller.signal.aborted)
            setStored({ key, state: { kind: 'ready', data } })
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) return
          const message =
            error instanceof ApiError && error.status === 422
              ? '이 날짜 조합의 궤도를 계산할 수 없습니다. 1900~2100년, 비행 간격 1~10일 안에서 다른 출발·도착일로 다시 시도하세요.'
              : error instanceof ApiError && error.status === 503
                ? '궤도 계산에 필요한 SPICE 데이터가 없습니다. 백엔드의 데이터 준비 상태를 확인하세요.'
                : error instanceof ApiError && error.status === 429
                  ? '다른 궤도를 계산하고 있습니다. 잠시 후 다시 시도하세요.'
                  : '날짜별 궤도를 계산하지 못했습니다. API 연결을 확인한 뒤 다시 시도하세요.'
          setStored({ key, state: { kind: 'error', message } })
        })
    }, 450)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [departure, arrival, key])
  return (
    <section className="transfer-section" aria-label="지구–달 계산 궤도">
      <div className="window-toolbar">
        <div>
          <div className="section-kicker">EARTH → MOON · LUNAR CAPTURE</div>
          <h3>지구–달 비행 궤도</h3>
        </div>
        <span className="example-label">날짜별 계산 궤도</span>
      </div>
      {state.kind === 'loading' ? (
        <p className="orbit-status" role="status">
          선택한 출발·도착일의 궤도를 계산하는 중…
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
            궤도 다시 계산
          </button>
        </div>
      ) : (
        <OrbitPlayback key={key} data={state.data} />
      )}
      <p className="orbit-note">
        선택한 날짜의 00:00 UTC 기준 · DE440 달 위치와 지구·달 중력으로
        계산합니다. 지구 주차궤도 200 km → 달 도착 고도 100 km. 출발 궤도면은
        자동 선택하며 지상 발사·착륙은 계산하지 않습니다.
      </p>
    </section>
  )
}

function OrbitPlayback({ data }: { data: TransferData }) {
  const [index, setIndex] = useState(0)
  const [playing, setPlaying] = useState(false)
  const gradient = useId()
  const samples = [...data.transfer, ...data.capture.slice(1)]
  const last = samples.length - 1
  const finished = index >= last
  useEffect(() => {
    if (!playing || finished) return
    const timer = window.setInterval(
      () => setIndex((i) => Math.min(i + 6, last)),
      50,
    )
    return () => window.clearInterval(timer)
  }, [playing, last, finished])
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
  const approach = data.transfer
    .filter((s) => s.seconds >= data.capture[0]!.seconds - 2.6 * 3600)
    .map((s) => project(captureFrame, relativePosition(s)))
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
  const closeShip = close.at(project(captureFrame, relativePosition(current)))
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
            <strong>지구 중심 · 전체 전이</strong>
            <span>지구 주차궤도 → 달 접근</span>
          </figcaption>
          <svg
            viewBox="0 0 600 560"
            role="img"
            aria-label="달의 전체 공전 궤도와 지구에서 달까지의 계산된 전이 경로"
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
                지구 · 출발
              </text>
              <text
                x={departureMoon[0] - 12}
                y={departureMoon[1] - 12}
                textAnchor="end"
              >
                달 · 출발 시점
              </text>
              <text
                x={arrivalMoon[0] - 8}
                y={arrivalMoon[1] - 18}
                textAnchor="end"
              >
                달 · 진입 시점
              </text>
            </g>
          </svg>
          <div className="orbit-plot-legend">
            <span className="key-reference">출발 후 29일간 달 경로</span>
            <span className="key-motion">비행 중 달의 이동</span>
            <span className="key-transfer">우주선 전이</span>
          </div>
        </figure>
        <figure className="orbit-plot">
          <figcaption>
            <strong>달 중심 · 접근과 궤도 진입</strong>
            <span>접근 마지막 2.6시간 / 진입 후 14시간</span>
          </figcaption>
          <svg
            viewBox="0 0 600 560"
            role="img"
            aria-label="달 중심 좌표축에서 본 접근 경로와 궤도 진입 후 14시간의 공전 경로"
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
                달
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
                LOI · 고도 100 km
              </text>
            </g>
          </svg>
          <div className="orbit-plot-legend">
            <span className="key-surface">달 표면</span>
            <span className="key-transfer">진입 전 접근</span>
            <span className="key-capture">진입 후 원형 궤도</span>
          </div>
        </figure>
      </div>
      <dl className="orbit-metrics">
        <div>
          <dt>계산 비행 시간</dt>
          <dd>
            {data.metrics.travel_time_days.toFixed(3)} <small>일</small>
          </dd>
        </div>
        <div>
          <dt>달 진입 고도</dt>
          <dd>
            {data.metrics.arrival_altitude_km.toFixed(0)} <small>km</small>
          </dd>
        </div>
        <div>
          <dt>출발 TLI Δv</dt>
          <dd>
            {data.metrics.tli_delta_v_km_s.toFixed(3)} <small>km/s</small>
          </dd>
        </div>
        <div>
          <dt>진입 LOI Δv</dt>
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
            aria-label={running ? '궤도 재생 일시정지' : '궤도 재생'}
          >
            {running ? 'Ⅱ 일시정지' : '▶ 재생'}
          </button>
          <button
            type="button"
            onClick={() => {
              setPlaying(false)
              setIndex(data.transfer.length - 1)
            }}
          >
            달 궤도 진입 보기
          </button>
        </div>
        <output aria-live="off">
          T+{Math.floor(hours / 24)}일 {Math.floor(hours % 24)}시간 ·{' '}
          {captured ? '달 궤도 진입 후' : '달로 비행 중'}
        </output>
        <input
          type="range"
          min="0"
          max={last}
          step="1"
          value={index}
          aria-label="궤도 재생 시점"
          onChange={(e) => {
            setPlaying(false)
            setIndex(Number(e.target.value))
          }}
        />
        <div className="orbit-legend">
          <span>전이·접근</span>
          <span>달 궤도 진입 후 14시간</span>
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
        투영 x [{unit}]
      </text>
      <text x="26" y="280" textAnchor="middle" transform="rotate(-90 26 280)">
        투영 y [{unit}]
      </text>
    </g>
  )
}

// Surface shading is illustrative; the disc radius still uses the plot's km scale.
function MoonDisc({
  x,
  y,
  radius,
  id,
}: {
  x: number
  y: number
  radius: number
  id: string
}) {
  const craters = [
    { x: 67, y: 54, r: 17 },
    { x: 46, y: 102, r: 11 },
    { x: 116, y: 129, r: 14 },
    { x: 145, y: 68, r: 9 },
    { x: 88, y: 163, r: 7 },
    { x: 158, y: 121, r: 6 },
  ]
  return (
    <g
      transform={`translate(${x - radius} ${y - radius}) scale(${radius / 100})`}
      className="orbit-moon-disc"
    >
      <title>달 · 반지름 1,737.4 km. 표면 음영과 크레이터는 도식입니다.</title>
      <defs>
        <radialGradient id={`${id}-surface`} cx="30%" cy="25%" r="80%">
          <stop stopColor="#e3e2dc" />
          <stop offset="0.42" stopColor="#b5b6b4" />
          <stop offset="0.76" stopColor="#747c81" />
          <stop offset="1" stopColor="#303c46" />
        </radialGradient>
        <radialGradient id={`${id}-crater`} cx="65%" cy="75%" r="80%">
          <stop stopColor="#c8c9c5" stopOpacity="0.1" />
          <stop offset="1" stopColor="#35414a" stopOpacity="0.55" />
        </radialGradient>
        <clipPath id={`${id}-clip`}>
          <circle cx="100" cy="100" r="100" />
        </clipPath>
      </defs>
      <circle
        cx="100"
        cy="100"
        r="100"
        fill={`url(#${id}-surface)`}
        className="orbit-lunar-limb"
      />
      <g clipPath={`url(#${id}-clip)`}>
        <path
          d="M27 77Q48 52 77 77T118 82Q132 104 111 113T76 136Q59 146 43 121T27 77Z"
          fill="#4e5b64"
          opacity="0.16"
        />
        <path
          d="M109 22Q148 23 165 45T163 80Q141 85 129 64T109 22Z"
          fill="#4e5b64"
          opacity="0.13"
        />
        {craters.map((c) => (
          <g key={`${c.x}-${c.y}`}>
            <circle cx={c.x} cy={c.y} r={c.r} fill={`url(#${id}-crater)`} />
            <path
              d={`M${c.x - c.r * 0.75} ${c.y + c.r * 0.66} A${c.r} ${c.r} 0 0 0 ${c.x + c.r * 0.85} ${c.y - c.r * 0.5}`}
              fill="none"
              stroke="#e4e5df"
              strokeOpacity="0.24"
              strokeWidth="1.3"
            />
          </g>
        ))}
      </g>
    </g>
  )
}
