import { utc } from './flightPlan'
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
  PARKING_COAST: 'Lunar orbit insertion → descent orbit insertion',
  DOI_COAST: 'Descent orbit insertion → powered descent',
  POWERED_DESCENT: 'Powered descent → touchdown',
} as const

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
            setError(
              reason instanceof Error ? reason.message : 'Calculation failed',
            )
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
          throw new Error('Example descent constraints unmet · ' + path.status)
        setExample(path.samples.map((sample) => descentPoint(sample, null)))
        moon.current?.flyTo(
          { lat: request.latitude, lon: request.longitude },
          450000,
        )
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted)
          setExampleError(
            reason instanceof Error
              ? reason.message
              : 'Unable to calculate the example',
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
        label: 'Landing target',
        location: { lat: data.target_latitude, lon: data.target_longitude },
      },
      {
        id: 'pdi',
        label: 'Powered descent initiation',
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
    ['latitude', 'Target latitude (°)', -90, -80],
    ['longitude', 'Target longitude (°E)', -360, 360],
    ['durationS', 'Powered descent duration (s)', 300, 1500],
    ['alignmentToleranceM', 'Alignment tolerance (m)', 1, 100000],
    ['wetMassKg', 'Initial mass (kg)', 1, undefined],
    ['dryMassKg', 'Dry mass (kg)', 1, undefined],
    ['maxThrustN', 'Maximum thrust (N)', 1, undefined],
    ['ispS', 'Specific impulse (s)', 1, undefined],
  ] as const
  return (
    <section
      aria-label="Landing analysis"
      className="grid rounded-lg border border-neutral-800 bg-neutral-950 text-neutral-100 md:grid-cols-[minmax(15rem,20rem)_1fr]"
    >
      <section className="space-y-4 p-5">
        <h2 className="text-xl font-semibold">Lunar orbit to touchdown</h2>
        <dl className="space-y-2 text-sm">
          <div>
            <dt>Lunar orbit insertion</dt>
            <dd>
              {utc(data?.orbit.loi.epoch_utc ?? request.arrival + 'T00:00:00Z')}
            </dd>
          </div>
          <div>
            <dt>Estimated touchdown</dt>
            <dd className="text-amber-300" data-testid="touchdown">
              {data?.estimated_touchdown_utc
                ? utc(data.estimated_touchdown_utc)
                : data || error
                  ? 'Unavailable'
                  : 'Calculating…'}
            </dd>
          </div>
        </dl>
        {error && <p role="alert">{error}</p>}
        {data && (
          <div role="status" className="space-y-1 text-sm">
            <p>
              {data.status === 'NO_PDI_REFERENCE'
                ? 'The approach misses the target, so powered descent could not be calculated.'
                : data.status === 'DESCENT_REFERENCE_FAILED'
                  ? 'Descent constraints unmet · ' + data.descent?.status
                  : 'The reference descent meets terrain, fuel, and thrust constraints.'}
            </p>
            <p>
              Approach alignment error{' '}
              {(data.orbit.approach_error_m / 1000).toFixed(2)} km
            </p>
            <p>
              Lunar insertion Δv (including plane change){' '}
              {(data.capture_delta_v_mps / 1000).toFixed(2)} km/s
            </p>
            <p>
              Planned braking distance{' '}
              {(data.planned_downrange_m / 1000).toFixed(0)} km
            </p>
            <p className="text-xs text-neutral-400">
              Lander fuel estimates begin at powered descent initiation.
            </p>
            <p>Powered descent begins at {utc(data.orbit.pdi.epoch_utc)}</p>
          </div>
        )}
        <p className="text-xs text-neutral-400">
          Departure {request.departure} UTC · Target {request.latitude}°,{' '}
          {request.longitude}° {isExample ? '(example coordinates)' : ''}
        </p>
        {data && data.status !== 'DESCENT_REFERENCE_PASSED' && (
          <div>
            <button
              type="button"
              className="hud-button"
              onClick={() => switchExample(!showExample)}
            >
              {showExample
                ? 'Back to capture orbit'
                : 'View standalone descent example'}
            </button>
            {showExample && (
              <p role="status" className="mt-2 text-xs">
                {exampleError ??
                  (example.length
                    ? 'This example starts at an altitude of 15 km. Time is measured from the start of descent.'
                    : 'Calculating the example descent…')}
              </p>
            )}
          </div>
        )}
        <details>
          <summary>Landing site and lander settings</summary>
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
              Recalculate
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
            Try again
          </button>
        )}
      </section>
      <section
        className="flex min-h-[60svh] min-w-0 flex-col"
        aria-label="Lunar orbit playback"
      >
        <div className="flex gap-2 p-3" role="group" aria-label="Display mode">
          <button
            className="hud-button"
            aria-pressed={!is3D}
            onClick={() => setIs3D(false)}
          >
            2D trajectory
          </button>
          <button
            className="hud-button"
            aria-pressed={is3D}
            onClick={() => setIs3D(true)}
          >
            3D terrain
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
                  Show landing target
                </button>
              )}
            </div>
            <input
              className="w-full"
              aria-label="Flight time"
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
              {playing ? 'Pause' : 'Play'}
            </button>
            {current.epochUtc
              ? utc(current.epochUtc)
              : 'Time since example descent began: ' + current.elapsedS + ' s'}
            <p>
              {current.phase === 'POWERED_DESCENT'
                ? 'Height above terrain'
                : 'Altitude above reference surface'}{' '}
              {current.altitudeM?.toFixed(0) ?? '—'} m
              {current.thrustN !== null &&
                ` · Thrust ${current.thrustN.toFixed(0)} N · Speed ${current.speedMps?.toFixed(1)} m/s · Propellant remaining ${Math.max(0, (current.massKg ?? 0) - request.dryMassKg).toFixed(1)} kg`}
            </p>
          </div>
        )}
      </section>
    </section>
  )
}
