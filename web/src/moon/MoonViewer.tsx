import {
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type Ref,
} from 'react'
import type { LunarLocation } from './location'
import type { MoonScene } from './scene'
import { parseSunDirection, type Vector3 } from './sun'

/** Imperative API for panels. Calls made before the Moon has loaded are applied once it is ready. */
export interface MoonViewerHandle {
  flyTo(location: LunarLocation): void
  /** Moon-to-Sun unit vector in MOON_ME (`[x, y, z]`), or null for photo-only shading. Throws on invalid input. */
  setSunDirection(direction: unknown): void
}

interface MoonViewerProps {
  ref?: Ref<MoonViewerHandle>
  onPick?: (location: LunarLocation) => void
}

type LoadState =
  { kind: 'loading' } | { kind: 'ready' } | { kind: 'error'; message: string }

// Cesium is a few MB; start fetching its chunk as soon as this module is evaluated so the
// download overlaps React's first render instead of waiting for the effect.
const sceneModule = import('./scene')

const ionToken = import.meta.env.VITE_CESIUM_ION_TOKEN ?? ''

export default function MoonViewer({ ref, onPick }: MoonViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const compassRef = useRef<HTMLSpanElement>(null)
  const sceneRef = useRef<MoonScene | null>(null)
  const pending = useRef<{ fly?: LunarLocation; sun?: Vector3 | null }>({})
  const onPickRef = useRef(onPick)
  const [state, setState] = useState<LoadState>({ kind: 'loading' })

  useEffect(() => {
    onPickRef.current = onPick
  }, [onPick])

  useImperativeHandle(
    ref,
    () => ({
      flyTo(location) {
        if (sceneRef.current) sceneRef.current.flyTo(location)
        else pending.current.fly = location
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
          onPick: (location) => onPickRef.current?.(location),
          onHeadingChange: (heading) => {
            if (compassRef.current)
              compassRef.current.style.transform = `rotate(${-heading}rad)`
          },
          onIntroComplete: () => {
            container.dataset.intro = 'done'
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
        if (fly) created.flyTo(fly)
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
      <button
        type="button"
        onClick={() => sceneRef.current?.resetNorth()}
        aria-label="Reset view to north up"
        title="North up"
        hidden={view.kind !== 'ready'}
        className="absolute right-4 bottom-10 flex size-11 items-center justify-center rounded-full border border-white/15 bg-neutral-900/70 text-neutral-100 backdrop-blur hover:bg-neutral-800/80"
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
