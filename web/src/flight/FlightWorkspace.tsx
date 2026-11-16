import { useEffect, useMemo, useRef, useState } from 'react'
import MoonViewer, { type MoonViewerHandle } from '../moon/MoonViewer'
import { requestFlightPreview, type FlightRequest } from './flightApi'
import { flightPoints, type FlightPreview } from './flightData'

const demo: FlightRequest = {
  departure: '2027-01-06',
  arrival: '2027-01-10',
  latitude: -89,
  longitude: 30,
  alignmentToleranceM: 5000,
  durationS: 720,
  wetMassKg: 1200,
  dryMassKg: 450,
  maxThrustN: 15000,
  ispS: 310,
}

function initialRequest(): FlightRequest {
  const params = new URLSearchParams(window.location.search)
  const numberParam = (key: string, fallback: number) => {
    const raw = params.get(key)
    if (raw === null || raw.trim() === '') return fallback
    const value = Number(raw)
    return Number.isFinite(value) ? value : fallback
  }
  return {
    ...demo,
    departure: params.get('departure') ?? demo.departure,
    arrival: params.get('arrival') ?? demo.arrival,
    latitude: numberParam('lat', demo.latitude),
    longitude: numberParam('lon', demo.longitude),
  }
}

const labels = {
  PARKING_COAST: 'LOI → DOI · Parking Orbit',
  DOI_COAST: 'DOI → PDI · Descent Ellipse',
  POWERED_DESCENT: 'PDI → Surface · Powered Descent',
} as const

type NumericKey =
  | 'latitude'
  | 'longitude'
  | 'wetMassKg'
  | 'dryMassKg'
  | 'maxThrustN'
  | 'ispS'
  | 'alignmentToleranceM'

export default function FlightWorkspace() {
  const [input, setInput] = useState<FlightRequest>(initialRequest)
  const [data, setData] = useState<FlightPreview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [frame, setFrame] = useState(0)
  const [playing, setPlaying] = useState(false)
  const controller = useRef<AbortController | null>(null)
  const moon = useRef<MoonViewerHandle>(null)
  const points = useMemo(() => (data ? flightPoints(data) : []), [data])
  const current = points[frame] ?? null

  useEffect(() => {
    if (!playing || points.length < 2) return
    const timer = window.setInterval(() => {
      setFrame((before) => {
        if (before >= points.length - 1) {
          setPlaying(false)
          return before
        }
        return before + 1
      })
    }, 140)
    return () => window.clearInterval(timer)
  }, [playing, points.length])

  useEffect(() => () => controller.current?.abort(), [])

  const run = async () => {
    controller.current?.abort()
    const active = new AbortController()
    controller.current = active
    setLoading(true)
    setError(null)
    setPlaying(false)
    setData(null)
    setFrame(0)
    try {
      const result = await requestFlightPreview(input, active.signal)
      if (active.signal.aborted) return
      setData(result)
      moon.current?.flyTo(
        { lat: result.target_latitude, lon: result.target_longitude },
        450000,
      )
    } catch (reason: unknown) {
      if (active.signal.aborted) return
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      if (!active.signal.aborted) setLoading(false)
    }
  }

  const numberField = (label: string, key: NumericKey, step: string) => (
    <label className="flex flex-col gap-1 text-[11px] text-neutral-300">
      {label}
      <input
        className="rounded border border-white/20 bg-black/50 px-2 py-1.5 text-neutral-100"
        type="number"
        step={step}
        value={input[key]}
        onChange={(event) =>
          setInput((current) => ({
            ...current,
            [key]: Number(event.target.value),
          }))
        }
      />
    </label>
  )

  return (
    <main className="relative h-svh overflow-hidden bg-black text-neutral-100">
      <MoonViewer ref={moon} flightPoints={points} flightFrame={frame} />
      <section className="hud-panel absolute left-4 top-4 z-20 max-h-[calc(100dvh-2rem)] w-[340px] max-w-[calc(100vw-2rem)] overflow-y-auto p-4">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-base font-semibold">
            Lunar Flight · 3D Reference
          </h1>
          <a className="hud-button" href="/">
            Mission
          </a>
        </div>
        <p className="mt-2 text-xs leading-relaxed text-amber-200">
          Engineering reference only. The plotted orbit is an idealized two-body
          DOI/PDI continuation of the dated transfer. Descent is plotted only
          after the reference PDI passes the site-alignment gate.
        </p>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1 text-[11px]">
            Departure · UTC
            <input
              type="date"
              className="rounded border border-white/20 bg-black/50 p-1.5"
              value={input.departure}
              onChange={(event) =>
                setInput((value) => ({
                  ...value,
                  departure: event.target.value,
                }))
              }
            />
          </label>
          <label className="flex flex-col gap-1 text-[11px]">
            Lunar arrival · UTC
            <input
              type="date"
              className="rounded border border-white/20 bg-black/50 p-1.5"
              value={input.arrival}
              onChange={(event) =>
                setInput((value) => ({
                  ...value,
                  arrival: event.target.value,
                }))
              }
            />
          </label>
          {numberField('Site latitude · °', 'latitude', '0.01')}
          {numberField('Site longitude · °E', 'longitude', '0.01')}
          {numberField('PDI site tolerance · m', 'alignmentToleranceM', '100')}
        </div>

        <h2 className="mt-4 text-xs font-semibold">
          Illustrative lander · at PDI
        </h2>
        <p className="mt-1 text-[10px] text-neutral-400">
          Not specifications for any CLPS provider. Customer equipment masses
          are not lander wet masses.
        </p>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {numberField('Wet mass · kg', 'wetMassKg', '10')}
          {numberField('Dry mass · kg', 'dryMassKg', '10')}
          {numberField('Max thrust · N', 'maxThrustN', '100')}
          {numberField('Isp · s', 'ispS', '1')}
        </div>
        <button
          className="hud-button mt-4 w-full justify-center"
          type="button"
          disabled={loading}
          onClick={() => void run()}
        >
          {loading ? 'Computing actual handoff…' : 'Compute Reference Flight'}
        </button>
        {error && (
          <p className="mt-3 text-xs text-red-300" role="alert">
            {error}
          </p>
        )}
        {data && (
          <div className="mt-4 space-y-2 border-t border-white/15 pt-3 text-xs">
            <h2 className="font-semibold">Flight Model Result</h2>
            <p data-testid="flight-status" className="font-mono text-amber-300">
              {data.status}
            </p>
            <p>DOI Δv: {data.orbit.doi_delta_v_mps.toFixed(2)} m/s</p>
            <p>
              PDI site offset: {(data.orbit.approach_error_m / 1000).toFixed(2)}{' '}
              km
            </p>
            <p>
              Plane offset: {(data.orbit.plane_offset_m / 1000).toFixed(2)} km
            </p>
            <p>
              Descent:{' '}
              {data.descent?.status ?? 'Not evaluated — no aligned PDI'}
            </p>
            {data.descent && (
              <p>
                Propellant estimate:{' '}
                {data.descent.propellant_kg?.toFixed(1) ?? 'Unknown'} kg
              </p>
            )}
            <p className="text-[10px] leading-relaxed text-neutral-400">
              {data.note}
            </p>
          </div>
        )}
      </section>
      {points.length > 0 && (
        <section className="hud-panel absolute bottom-5 left-1/2 z-20 w-[min(620px,calc(100vw-2rem))] -translate-x-1/2 p-3 text-xs">
          <div className="flex items-center justify-between gap-2">
            <strong>Mission Playback</strong>
            <span className="text-neutral-400">
              Sample-by-sample, not real-time
            </span>
          </div>
          <input
            className="mt-2 w-full"
            type="range"
            min={0}
            max={points.length - 1}
            step={1}
            value={frame}
            aria-label="Mission flight playback frame"
            onChange={(event) => {
              setPlaying(false)
              setFrame(Number(event.target.value))
            }}
          />
          <div className="flex items-center gap-3">
            <button
              className="hud-button"
              type="button"
              onClick={() => {
                if (frame === points.length - 1) setFrame(0)
                setPlaying((previous) => !previous)
              }}
            >
              {playing ? 'Pause' : 'Play'}
            </button>
            <div className="min-w-0">
              <p className="truncate font-medium">
                {current && labels[current.phase]}
              </p>
              <p className="font-mono text-[10px] text-neutral-400">
                {current?.epochUtc ?? '—'}
              </p>
            </div>
            <div className="ml-auto text-right font-mono text-[10px]">
              <p>Height {current?.altitudeM?.toFixed(0) ?? '—'} m</p>
              <p>Thrust {current?.thrustN?.toFixed(0) ?? '—'} N</p>
            </div>
          </div>
        </section>
      )}
    </main>
  )
}
