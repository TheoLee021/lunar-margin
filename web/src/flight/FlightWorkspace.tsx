import { FlightPlots } from './FlightPlots'
import { useEffect, useMemo, useRef, useState } from 'react'
import MoonViewer, { type MoonViewerHandle } from '../moon/MoonViewer'
import {
  requestExample,
  requestFlightPreview,
  type FlightRequest,
} from './flightApi'
import {
  descentPoint,
  flightPoints,
  type FlightPoint,
  type FlightPreview,
} from './flightData'

const labels = {
  PARKING_COAST: '달 궤도 진입 → 하강 기동',
  DOI_COAST: '하강 기동 → 동력하강 시작점',
  POWERED_DESCENT: '동력하강 → 표면 착륙',
} as const

function utc(value: string) {
  if (!Number.isFinite(Date.parse(value))) return '유효한 날짜를 선택하세요'
  return new Date(value).toISOString().slice(0, 19).replace('T', ' ') + ' UTC'
}

export default function FlightWorkspace({
  active,
  request,
  setRequest,
  example: isExample,
}: {
  active: boolean
  request: FlightRequest
  setRequest: (request: FlightRequest) => void
  example: boolean
}) {
  const [draft, setDraft] = useState(request)
  const [data, setData] = useState<FlightPreview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [is3D, setIs3D] = useState(false)
  const [frame, setFrame] = useState(0)
  const [playing, setPlaying] = useState(false)
  const moon = useRef<MoonViewerHandle>(null)
  useEffect(() => {
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      void requestFlightPreview(request, controller.signal)
        .then((result) => {
          if (!controller.signal.aborted) setData(result)
        })
        .catch((reason: unknown) => {
          if (!controller.signal.aborted)
            setError(reason instanceof Error ? reason.message : '계산 실패')
        })
    }, 0)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [request])
  const [showExample, setShowExample] = useState(false)
  const [example, setExample] = useState<FlightPoint[]>([])
  const [exampleError, setExampleError] = useState<string | null>(null)
  useEffect(() => {
    if (!showExample) return
    const controller = new AbortController()
    requestExample(request, controller.signal)
      .then((path) => {
        if (controller.signal.aborted) return
        if (path.status !== 'REFERENCE_FEASIBLE')
          throw new Error('예시 하강 조건 미충족 · ' + path.status)
        setExample(path.samples.map((sample) => descentPoint(sample, null)))
        moon.current?.flyTo(
          { lat: request.latitude, lon: request.longitude },
          450000,
        )
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted)
          setExampleError(
            reason instanceof Error ? reason.message : '예시 계산 실패',
          )
      })
    return () => controller.abort()
  }, [showExample, request])
  function switchExample(next: boolean) {
    setPlaying(false)
    setFrame(0)
    setExample([])
    setExampleError(null)
    setShowExample(next)
  }
  const missionPoints = useMemo(() => (data ? flightPoints(data) : []), [data])
  const points = showExample ? example : missionPoints
  const markers = useMemo(() => {
    if (!data) return []
    const [x, y, z] = data.orbit.samples.at(-1)!.moon_me_xyz_m
    const sites = [
      {
        id: 'target',
        label: '착륙 목표',
        location: { lat: data.target_latitude, lon: data.target_longitude },
      },
      {
        id: 'pdi',
        label: '동력하강 시작점',
        location: {
          lat: (Math.atan2(z, Math.hypot(x, y)) * 180) / Math.PI,
          lon: (Math.atan2(y, x) * 180) / Math.PI,
        },
      },
    ]
    return showExample ? sites.slice(0, 1) : sites
  }, [data, showExample])
  useEffect(() => {
    if (!active || !playing) return
    const timeout = window.setTimeout(() => {
      if (frame + 1 >= points.length) setPlaying(false)
      else setFrame(frame + 1)
    }, 140)
    return () => window.clearTimeout(timeout)
  }, [active, frame, playing, points.length])
  const current = points[frame]
  const fields = [
    ['latitude', '목표 위도 (°)', -90, -80],
    ['longitude', '목표 경도 (°E)', -360, 360],
    ['durationS', '동력하강 기간 (초)', 300, 1500],
    ['alignmentToleranceM', '정렬 허용 거리 (m)', 1, 100000],
    ['wetMassKg', '초기 질량 (kg)', 1, undefined],
    ['dryMassKg', '건조 질량 (kg)', 1, undefined],
    ['maxThrustN', '최대 추력 (N)', 1, undefined],
    ['ispS', '비추력 (초)', 1, undefined],
  ] as const
  return (
    <section
      aria-label="착륙 분석"
      className="grid rounded-lg border border-neutral-800 bg-neutral-950 text-neutral-100 md:grid-cols-[minmax(15rem,20rem)_1fr]"
    >
      <section className="space-y-4 p-5">
        <h2 className="text-xl font-semibold">달 궤도에서 착륙까지</h2>
        <dl className="space-y-2 text-sm">
          <div>
            <dt>달 궤도 진입</dt>
            <dd>
              {utc(data?.orbit.loi.epoch_utc ?? request.arrival + 'T00:00:00Z')}
            </dd>
          </div>
          <div>
            <dt>예상 표면 착륙</dt>
            <dd className="text-amber-300" data-testid="touchdown">
              {data?.estimated_touchdown_utc
                ? utc(data.estimated_touchdown_utc)
                : data || error
                  ? '산출되지 않음'
                  : '계산 중…'}
            </dd>
          </div>
        </dl>
        {error && <p role="alert">{error}</p>}
        {data && (
          <div role="status" className="space-y-1 text-sm">
            <p>
              {data.status === 'NO_PDI_REFERENCE'
                ? '목표와 궤도가 정렬되지 않아 동력하강을 계산하지 않았습니다.'
                : data.status === 'DESCENT_REFERENCE_FAILED'
                  ? '하강 조건 미충족 · ' + data.descent?.status
                  : '기준 하강 경로가 지형·연료·추력 조건을 통과했습니다.'}
            </p>
            <p>
              접근 경로의 목표 정렬 오차{' '}
              {(data.orbit.approach_error_m / 1000).toFixed(2)} km
            </p>
            <p>
              달 진입 Δv (궤도면 변경 포함){' '}
              {(data.capture_delta_v_mps / 1000).toFixed(2)} km/s
            </p>
            <p>
              계획 감속 거리 {(data.planned_downrange_m / 1000).toFixed(0)} km
            </p>
            <p className="text-xs text-neutral-400">
              착륙선 연료 평가는 동력하강 시작부터 적용됩니다.
            </p>
            <p>동력하강 시작점 도달 {utc(data.orbit.pdi.epoch_utc)}</p>
          </div>
        )}
        <p className="text-xs text-neutral-400">
          출발 {request.departure} UTC · 목표 {request.latitude}°,{' '}
          {request.longitude}° {isExample ? '(예시 좌표)' : ''}
        </p>
        {data && data.status !== 'DESCENT_REFERENCE_PASSED' && (
          <div>
            <button
              type="button"
              className="hud-button"
              onClick={() => switchExample(!showExample)}
            >
              {showExample ? '진입 궤도로 돌아가기' : '독립 하강 예시 보기'}
            </button>
            {showExample && (
              <p role="status" className="mt-2 text-xs">
                {exampleError ??
                  (example.length
                    ? '이 예시는 별도의 15 km 시작점에서 계산합니다. 시간은 하강 시작 후 경과 시간입니다.'
                    : '예시 하강 경로를 계산하는 중…')}
              </p>
            )}
          </div>
        )}
        <details>
          <summary>착륙지와 착륙선 조건</summary>
          <form
            className="mt-3 grid grid-cols-2 gap-3"
            onSubmit={(event) => {
              event.preventDefault()
              switchExample(false)
              setData(null)
              setError(null)
              setPlaying(false)
              setFrame(0)
              setRequest({ ...draft })
            }}
          >
            {fields.map(([key, label, min, max]) => (
              <label className="text-xs" key={key}>
                {label}
                <input
                  className="mt-1 w-full rounded border border-neutral-600 bg-neutral-900 p-2"
                  type="number"
                  required
                  step="any"
                  min={min}
                  max={max}
                  value={Number.isFinite(draft[key]) ? draft[key] : ''}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      [key]: event.currentTarget.valueAsNumber,
                    })
                  }
                />
              </label>
            ))}
            <button className="hud-button col-span-2" type="submit">
              이 조건으로 다시 계산
            </button>
          </form>
        </details>
        {error && (
          <button
            className="hud-button"
            onClick={() => {
              setError(null)
              setRequest({ ...request })
            }}
          >
            다시 시도
          </button>
        )}
      </section>
      <section
        className="flex min-h-[60svh] min-w-0 flex-col"
        aria-label="달 궤도 재생"
      >
        <div className="flex gap-2 p-3" role="group" aria-label="표시 방식">
          <button
            className="hud-button"
            aria-pressed={!is3D}
            onClick={() => setIs3D(false)}
          >
            2D 궤도 · 착륙
          </button>
          <button
            className="hud-button"
            aria-pressed={is3D}
            onClick={() => setIs3D(true)}
          >
            3D 지형
          </button>
        </div>
        {is3D && active ? (
          <div className="relative min-h-[45svh] flex-1">
            <MoonViewer
              ref={moon}
              markers={markers}
              flightPoints={points}
              flightFrame={frame}
            />
          </div>
        ) : (
          <div className="flex flex-1 items-center">
            <FlightPlots points={points} frame={frame} />
          </div>
        )}
        {current && (
          <div className="hud-panel mx-4 mb-4 space-y-2 p-3 text-sm">
            <div className="flex justify-between">
              <span>{labels[current.phase]}</span>
              {is3D && (
                <button
                  className="hud-button"
                  onClick={() =>
                    moon.current?.flyTo(
                      { lat: request.latitude, lon: request.longitude },
                      450000,
                    )
                  }
                >
                  목표 위치 보기
                </button>
              )}
            </div>
            <input
              className="w-full"
              aria-label="비행 시점"
              type="range"
              min={0}
              max={points.length - 1}
              value={frame}
              onChange={(event) => {
                setPlaying(false)
                setFrame(Number(event.target.value))
              }}
            />
            <button
              className="hud-button mr-2"
              onClick={() => {
                if (frame === points.length - 1) setFrame(0)
                setPlaying(!playing)
              }}
            >
              {playing ? '일시정지' : '재생'}
            </button>
            {current.epochUtc
              ? utc(current.epochUtc)
              : '예시 하강 시작 후 ' + current.elapsedS + '초'}
            <p>
              {current.phase === 'POWERED_DESCENT' ? '지상고' : '기준면 고도'}{' '}
              {current.altitudeM?.toFixed(0) ?? '—'} m
              {current.thrustN !== null &&
                ` · 추력 ${current.thrustN.toFixed(0)} N · 속도 ${current.speedMps?.toFixed(1)} m/s · 남은 추진제 ${Math.max(0, (current.massKg ?? 0) - request.dryMassKg).toFixed(1)} kg`}
            </p>
          </div>
        )}
      </section>
    </section>
  )
}
