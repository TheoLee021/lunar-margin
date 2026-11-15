// Sunlight windows (docs/api.md, Sunlight): cast shadows on the grid of the detail levels of the
// normal tiles (20 m, 5 m), which exist only where a 5 m regional DEM does. The whole sunlight map is
// on an 80 m grid, so next to 5 m slopes its shadow edges look blunt. A window is computed by the
// backend on request (about a second) and cannot be called off once asked for, so this module asks
// only for the one around the point the camera looks at, only once the level is close enough to be
// drawn, and only when the camera has come to rest there. No Cesium here.
import {
  tilesOfWindow,
  windowOrigin,
  WINDOW_TILES,
  type PolarXY,
  type WindowOrigin,
} from './normalWindows'
import type { TileLevel } from './overlayTiles'
import type { Vector3 } from './sun'
import type { SunlightMap, SunlightWindowAddress } from './sunlightMap'

export type { SunlightWindowAddress }

export interface LoadedSunlightWindow {
  level: TileLevel
  origin: WindowOrigin
  map: SunlightMap
}

export interface SunlightWindows {
  /**
   * Call with the point the camera looks at, the metres of ground one screen pixel covers there, and
   * the current Sun (null when unlit). Asks for the windows that should change and hands each to
   * `onWindow` when it arrives; until then the previous window of the same Sun stays in use.
   */
  update(focus: PolarXY, footprintM: number, sun: Vector3 | null): void
}

const sameSun = (a: Vector3 | null, b: Vector3 | null) =>
  a === b || (a !== null && b !== null && a.every((value, i) => value === b[i]))

/** Keeps one sunlight window per detail level around the focus. `levels[i]` is reported as slot `i`. */
export function createSunlightWindows(options: {
  /** Sparse levels (with `tile_ranges`), coarse to fine. */
  levels: readonly TileLevel[]
  /** A level is asked for once one of its texels covers at least this many screen pixels. */
  minTexelPx: number
  /** A window is asked for once the focus has wanted it for this long. */
  settleMs: number
  now?: () => number
  signal: AbortSignal
  load: (
    address: SunlightWindowAddress,
    sun: Vector3,
    signal: AbortSignal,
  ) => Promise<SunlightMap>
  /** A window to show in the slot, or null when the slot's window no longer matches the Sun. */
  onWindow: (slot: number, window: LoadedSunlightWindow | null) => void
}): SunlightWindows {
  const { levels, minTexelPx, settleMs, signal, load, onWindow } = options
  const now = options.now ?? (() => performance.now())
  let currentSun: Vector3 | null = null
  const slots: {
    // What the slot shows or is loading for the current Sun; a failed load stays here until the
    // focus asks for another window, so it is not requested again on every frame.
    origin?: WindowOrigin
    request?: AbortController
    // The window the focus wants instead, and since when.
    next?: { origin: WindowOrigin; since: number }
  }[] = levels.map(() => ({}))

  return {
    update(focus, footprintM, sun) {
      if (!sameSun(sun, currentSun)) {
        currentSun = sun
        slots.forEach((state, slot) => {
          state.request?.abort()
          if (state.origin) onWindow(slot, null)
          state.origin = undefined
          state.next = undefined
        })
      }
      if (!sun) return
      levels.forEach((level, slot) => {
        if (level.pixel_size_m / footprintM < minTexelPx) return
        const state = slots[slot]!
        const origin = windowOrigin(level, focus, state.origin)
        // Outside the level's regions the whole map is all there is; the window in use stays.
        if (
          origin === state.origin ||
          tilesOfWindow(level, origin).length === 0
        ) {
          state.next = undefined
          return
        }
        if (
          state.next?.origin.tileX !== origin.tileX ||
          state.next.origin.tileY !== origin.tileY
        ) {
          state.next = { origin, since: now() }
          return
        }
        if (now() - state.next.since < settleMs) return
        state.next = undefined
        state.request?.abort()
        state.origin = origin
        const request = new AbortController()
        state.request = request
        signal.addEventListener('abort', () => request.abort(), {
          signal: request.signal,
        })
        const side = WINDOW_TILES * level.tile_px
        load(
          { z: level.z, tileX: origin.tileX, tileY: origin.tileY },
          sun,
          request.signal,
        )
          .then((map) => {
            if (request.signal.aborted) return
            if (map.width !== side || map.height !== side)
              throw new Error('sunlight window size does not match its level')
            onWindow(slot, { level, origin, map })
          })
          // The coarser shadows underneath keep showing.
          .catch(() => undefined)
      })
    },
  }
}
