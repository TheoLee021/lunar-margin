import { useEffect, useRef, useState } from 'react'
import type { Vector3 } from '../moon/sun'
import { MissionTimeline } from './MissionTimeline'
import { advance, PLAYBACK_SPEEDS, sunAt } from './sunPlayback'
import type { Timeline } from './types'
import type { SunPathResult } from './useSunPath'

// How long the review time has to rest after a drag before the Moon is asked for its precise
// shadows: the backend computes one sunlight map at a time, each taking seconds.
const SETTLE_MS = 400
// A frame that comes late (a tab that was hidden) moves the time by no more than this.
const MAX_FRAME_MS = 100
const DEFAULT_SPEED = 1

/** The timeline sample a time (days after landing) falls on: the last one at or before it. */
const sampleAt = (tl: Timeline, days: number) =>
  Math.max(
    0,
    tl.t.findLastIndex((t) => t <= days + 1e-9),
  )

/**
 * The mission timeline with the Moon following its review time: dragging or playing the time moves
 * the sunlight on the Moon. While the time moves, each frame's Sun goes straight to the Moon
 * (`onPreview`); once it rests, the time is reported (`onReview`) and the Moon is lit from it with
 * precise shadows. Every run of `onPreview` calls ends with one `onReview`.
 */
export function ReviewTimeline({
  timeline: tl,
  duration,
  observerHeightM,
  sun,
  photo,
  reviewDays,
  onReview,
  onPreview,
  onLight,
}: {
  timeline: Timeline
  duration: number
  observerHeightM: number
  sun: SunPathResult
  /** The Moon shows the photo, not the sunlight. */
  photo: boolean
  /** The review time the Moon is lit from, in days after landing: where this timeline starts. */
  reviewDays: number
  /** The review time came to rest. */
  onReview: (days: number) => void
  /** The Sun of a review time that is still moving. */
  onPreview: (direction: Vector3) => void
  /** The time was moved while the Moon showed the photo: sunlight is wanted. */
  onLight: () => void
}) {
  const last = tl.t.length - 1
  const [index, setIndex] = useState(() => sampleAt(tl, reviewDays))
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(DEFAULT_SPEED)
  // The time being shown, in days after landing. It runs ahead of `index` between two samples.
  const position = useRef(tl.t[index] ?? 0)
  const speedRef = useRef(speed)
  const settleTimer = useRef<number | undefined>(undefined)
  const path = sun.kind === 'ready' ? sun.path : null
  // Going back to the photo stops the playback, so the sunlight does not run on unseen.
  if (playing && photo) setPlaying(false)
  const running = playing && !photo && path !== null && index < last

  const cancelSettle = () => {
    window.clearTimeout(settleTimer.current)
    settleTimer.current = undefined
  }
  const settle = (days: number) => {
    cancelSettle()
    onReview(days)
  }

  useEffect(() => {
    if (!running || !path) return
    const end = tl.t.at(-1)!
    let frame = 0
    let before = performance.now()
    const tick = (now: number) => {
      position.current = advance(
        position.current,
        Math.min(now - before, MAX_FRAME_MS),
        PLAYBACK_SPEEDS[speedRef.current]!.daysPerSecond,
        end,
      )
      before = now
      onPreview(sunAt(path, position.current))
      setIndex(sampleAt(tl, position.current))
      if (position.current < end) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(frame)
      // A drag that stopped the playback reports its own time once it rests.
      if (settleTimer.current !== undefined) return
      // The playback rests on the sample the timeline shows, not between two.
      position.current = tl.t[sampleAt(tl, position.current)]!
      onReview(position.current)
    }
  }, [running, path, tl, onPreview, onReview])

  // Leaving (another candidate, hidden panels) with a drag not yet at rest keeps its time.
  useEffect(
    () => () => {
      if (settleTimer.current === undefined) return
      window.clearTimeout(settleTimer.current)
      onReview(position.current)
    },
    [onReview],
  )

  const review = (next: number) => {
    const days = tl.t[next]
    if (days === undefined) return
    setPlaying(false)
    setIndex(next)
    position.current = days
    if (!path) {
      settle(days)
      return
    }
    if (photo) onLight()
    onPreview(sunAt(path, days))
    cancelSettle()
    settleTimer.current = window.setTimeout(() => settle(days), SETTLE_MS)
  }

  return (
    <MissionTimeline
      timeline={tl}
      duration={duration}
      reviewed={index}
      onReview={review}
      observerHeightM={observerHeightM}
    >
      <div className="timeline-playback">
        <button
          type="button"
          className="hud-button"
          disabled={!path}
          aria-label={running ? 'Pause sunlight playback' : 'Play sunlight'}
          onClick={() => {
            if (running) {
              setPlaying(false)
              return
            }
            if (!path) return
            if (photo) onLight()
            if (index === last) {
              setIndex(0)
              position.current = tl.t[0]!
            }
            // The playback reports the time it stops at; a drag still waiting to rest is dropped.
            cancelSettle()
            // Moving from now on, so the Moon does not ask for the shadows of the time it leaves.
            onPreview(sunAt(path, position.current))
            setPlaying(true)
          }}
        >
          {running ? 'Ⅱ Pause' : '▶ Play'}
        </button>
        <label>
          Speed{' '}
          <select
            aria-label="Sunlight playback speed"
            className="bg-neutral-800"
            value={speed}
            onChange={(event) => {
              const next = Number(event.target.value)
              speedRef.current = next
              setSpeed(next)
            }}
          >
            {PLAYBACK_SPEEDS.map(({ label }, i) => (
              <option key={label} value={i}>
                {label}
              </option>
            ))}
          </select>
        </label>
        {sun.kind === 'loading' ? (
          <span role="status">Loading Sun positions…</span>
        ) : null}
        {sun.kind === 'error' ? (
          <span role="alert">
            Could not load Sun positions.{' '}
            <button type="button" className="underline" onClick={sun.retry}>
              Retry
            </button>
          </span>
        ) : null}
      </div>
      <p className="hint timeline-playback-hint">
        The sunlight on the 3D Moon follows the review time. While it moves the
        shadows are coarse; once it rests, precise shadows for that time are
        fetched.
      </p>
    </MissionTimeline>
  )
}
