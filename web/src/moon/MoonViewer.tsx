import type { Viewshed } from '../api/viewshed'
import type { FlightPoint } from '../flight/flightData'
import {
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type Ref,
} from 'react'
import type { LunarLocation } from './location'
import type { MoonMarker } from './markerLayer'
import type { MoonScene } from './scene'
import { parseSunDirection, type Vector3 } from './sun'

/** Imperative API for panels. Calls made before the Moon has loaded are applied once it is ready. */
export interface MoonViewerHandle {
  flyTo(location: LunarLocation, rangeM?: number): void
  /** Back to the start view straight above the south pole. No-op until the Moon has loaded. */
  flyToOverview(): void
  /** Moon-to-Sun unit vector in MOON_ME (`[x, y, z]`), or null for photo-only shading. Throws on invalid input. */
  setSunDirection(direction: unknown): void
}

interface MoonViewerProps {
  viewshed?: Viewshed | null
  flightPoints?: readonly FlightPoint[]
  flightFrame?: number
  landerPreviewSite?: LunarLocation | null
  ref?: Ref<MoonViewerHandle>
  /** Labelled points such as candidate landing sites. */
  markers?: readonly MoonMarker[]
  selectedMarkerId?: string | null
  onMarkerSelect?: (id: string) => void
  /** Click on the surface (not on a marker). */
  onPick?: (location: LunarLocation) => void
}

const NO_MARKERS: readonly MoonMarker[] = []

type LoadState =
  { kind: 'loading' } | { kind: 'ready' } | { kind: 'error'; message: string }

// Cesium is a few MB; start fetching its chunk as soon as this module is evaluated so the
// download overlaps React's first render instead of waiting for the effect.
const sceneModule = import('./scene')

const NO_FLIGHT: readonly FlightPoint[] = []
const ionToken = import.meta.env.VITE_CESIUM_ION_TOKEN ?? ''

export default function MoonViewer({
  ref,
  viewshed = null,
  flightPoints = NO_FLIGHT,
  flightFrame = 0,
  landerPreviewSite = null,
  markers = NO_MARKERS,
  selectedMarkerId = null,
  onMarkerSelect,
  onPick,
}: MoonViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const compassRef = useRef<HTMLSpanElement>(null)
  const sceneRef = useRef<MoonScene | null>(null)
  const pending = useRef<{
    fly?: { location: LunarLocation; rangeM?: number }
    sun?: Vector3 | null
  }>({})
  const callbacks = useRef({ onPick, onMarkerSelect })
  const [state, setState] = useState<LoadState>({ kind: 'loading' })
  const [overlayError, setOverlayError] = useState<string | null>(null)
  const ready = state.kind === 'ready'

  useEffect(() => {
    callbacks.current = { onPick, onMarkerSelect }
  }, [onPick, onMarkerSelect])

  useEffect(() => {
    if (ready) sceneRef.current?.setMarkers(markers)
  }, [ready, markers])

  useEffect(() => {
    if (ready) sceneRef.current?.setSelectedMarker(selectedMarkerId)
  }, [ready, selectedMarkerId])

  useEffect(() => {
    if (ready) sceneRef.current?.setViewshed(viewshed)
  }, [ready, viewshed])

  useEffect(() => {
    if (ready) sceneRef.current?.setFlightPath(flightPoints)
  }, [ready, flightPoints])

  useEffect(() => {
    if (ready) sceneRef.current?.setFlightFrame(flightFrame)
  }, [ready, flightFrame, flightPoints])

  useEffect(() => {
    if (ready) sceneRef.current?.setLanderPreviewSite(landerPreviewSite)
  }, [ready, landerPreviewSite?.lat, landerPreviewSite?.lon, landerPreviewSite?.surfaceHeightM])

  useImperativeHandle(
    ref,
    () => ({
      flyTo(location, rangeM) {
        if (sceneRef.current) sceneRef.current.flyTo(location, rangeM)
        else pending.current.fly = { location, rangeM }
      },
      flyToOverview() {
        sceneRef.current?.flyToOverview()
      },
      setSunDirection(direction) {
        if (sceneRef.current) sceneRef.current.setSunDirection(direction)
        else
          pending.current.sun =
            direction === null ? null : parseSunDirection(direction)
      },
    }),
    [],
  )

  useEffect(() => {
    const container = containerRef.current
    if (!container || !ionToken) return
    const controller = new AbortController()
    let scene: MoonScene | undefined

    sceneModule
      .then(({ createMoonScene }) =>
        createMoonScene(container, {
          ionToken,
          signal: controller.signal,
          onPick: (location) => callbacks.current.onPick?.(location),
          onMarkerSelect: (id) => callbacks.current.onMarkerSelect?.(id),
          onOverlayError: setOverlayError,
          onHeadingChange: (heading) => {
            if (compassRef.current)
              compassRef.current.style.transform = `rotate(${-heading}rad)`
          },
        }),
      )
      .then((created) => {
        if (controller.signal.aborted) {
          created.destroy()
          return
        }
        scene = created
        sceneRef.current = created
        const { fly, sun } = pending.current
        pending.current = {}
        if (sun !== undefined) created.setSunDirection(sun)
        if (fly) created.flyTo(fly.location, fly.rangeM)
        setState({ kind: 'ready' })
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setState({ kind: 'error', message: describeError(error) })
      })

    return () => {
      controller.abort()
      scene?.destroy()
      sceneRef.current = null
    }
  }, [])

  const view: LoadState = ionToken
    ? state
    : {
        kind: 'error',
        message:
          'Cesium ion token is missing. Set VITE_CESIUM_ION_TOKEN in web/.env.local.',
      }

  return (
    <div className="absolute inset-0 bg-black">
      <div
        ref={containerRef}
        data-testid="moon-viewer"
        data-state={view.kind}
        className="absolute inset-0"
      />
      {view.kind === 'loading' ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-neutral-400">
          Loading the Moon…
        </div>
      ) : null}
      {view.kind === 'error' ? (
        <div
          role="alert"
          className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center"
        >
          <p className="text-base font-medium text-neutral-100">
            The Moon could not be loaded
          </p>
          <p className="max-w-md text-sm text-neutral-400">{view.message}</p>
        </div>
      ) : null}
      {overlayError !== null && view.kind === 'ready' ? (
        <p
          role="status"
          title={overlayError}
          className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 rounded-md bg-neutral-900/80 px-3 py-1.5 text-xs text-amber-300"
        >
          지형 그림자 데이터를 불러오지 못해 사진으로 표시합니다
        </p>
      ) : null}
      <button
        type="button"
        onClick={() => sceneRef.current?.resetNorth()}
        aria-label="Reset view to north up"
        title="North up"
        hidden={view.kind !== 'ready'}
        className="absolute right-4 bottom-4 flex size-11 items-center justify-center rounded-full border border-white/15 bg-neutral-900/70 text-neutral-100 backdrop-blur hover:bg-neutral-800/80"
      >
        <span ref={compassRef} className="flex flex-col items-center">
          <span className="text-[10px] leading-none font-semibold text-red-400">
            N
          </span>
          <svg viewBox="0 0 10 16" className="h-4 w-2.5" aria-hidden="true">
            <path d="M5 0 10 8H0z" fill="#f87171" />
            <path d="M5 16 0 8h10z" fill="#d4d4d4" />
          </svg>
        </span>
      </button>
    </div>
  )
}

function describeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (/404/.test(message))
    return 'Cesium Moon (ion asset 2684829) was not found. Add it to My Assets in your Cesium ion account.'
  if (/401|403|token/i.test(message))
    return 'Cesium ion rejected the access token. Check VITE_CESIUM_ION_TOKEN and its allowed URLs.'
  return message
}
