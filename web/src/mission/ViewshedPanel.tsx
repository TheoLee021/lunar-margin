import {
  GRID_TARGET_COUNT,
  visibleGridCount,
  type Viewshed,
} from '../api/viewshed'
import { bestValues } from './siteCompare'
import type { CandidateSite } from './types'
import type { VisibleCount } from './useVisibleCounts'

/** The viewshed of the point being looked at, once it has been asked for. */
export type ViewshedResult = { map: Viewshed | null; distanceKm?: number }

function countText(count: VisibleCount): string {
  if (typeof count === 'number') return `${count} / ${GRID_TARGET_COUNT}`
  if (count === null) return 'incomplete terrain'
  return count === 'error' ? 'unavailable' : 'computing…'
}

/**
 * Everything about the terrain viewshed in one place: the observer height, the sightlines
 * drawn on the Moon, the point being looked at and how the TOP 5 candidates compare. It
 * stays open while the Moon is used, so the two can be read together.
 */
export function ViewshedPanel({
  id,
  point,
  heights,
  height,
  onHeightChange,
  showViewshed,
  onShowViewshedChange,
  result,
  onRetry,
  sites,
  counts,
  selectedSiteId,
  onSelectSite,
}: {
  id: string
  /** The point whose viewshed the Moon shows, if one is shown in 3D. */
  point: { name: string; lat: number; lon: number } | null
  heights: readonly number[]
  height: number
  onHeightChange: (height: number) => void
  showViewshed: boolean
  onShowViewshedChange: (shown: boolean) => void
  /** `null` while the viewshed of `point` is being computed. */
  result: ViewshedResult | null
  onRetry: () => void
  sites: readonly CandidateSite[]
  /** The visible grid targets of each of `sites`, in the same order. */
  counts: readonly VisibleCount[]
  selectedSiteId: string | null
  onSelectSite: (siteId: string) => void
}) {
  const best = bestValues(
    counts.map((count) => (typeof count === 'number' ? count : null)),
    true,
  )
  return (
    <section
      id={id}
      aria-label="Viewshed"
      className="hud-panel pointer-events-auto grid w-80 max-w-full gap-2 p-3 text-xs"
    >
      <h2 className="font-semibold text-neutral-300">Viewshed · 5 km radius</h2>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <label>
          Observer height{' '}
          <select
            aria-label="Observer height"
            className="rounded bg-neutral-800 px-1"
            value={height}
            onChange={(event) => onHeightChange(Number(event.target.value))}
          >
            {heights.map((h) => (
              <option key={h} value={h}>
                {h} m
              </option>
            ))}
          </select>
        </label>
        <label className="inline-flex items-center gap-1">
          <input
            type="checkbox"
            checked={showViewshed}
            onChange={(event) => onShowViewshedChange(event.target.checked)}
          />
          Show sightlines
        </label>
      </div>
      <div role="status" className="border-t border-white/10 pt-2">
        {!point ? (
          <p className="text-neutral-400">
            View a candidate or a map point in 3D to see its viewshed.
          </p>
        ) : !result ? (
          `${point.name} · computing viewshed…`
        ) : result.map ? (
          <>
            <div>
              {point.name} · {point.lat.toFixed(4)}°, {point.lon.toFixed(4)}°
            </div>
            <strong>
              Longest sightline in the radius {result.distanceKm?.toFixed(2)} km
            </strong>
            <div>
              {result.map.targets.length === GRID_TARGET_COUNT
                ? `Visible grid points ${visibleGridCount(result.map)} / ${GRID_TARGET_COUNT}`
                : `Incomplete terrain · ${result.map.targets.length} of ${GRID_TARGET_COUNT} paths checked`}
            </div>
            <div className="flex gap-3">
              <span className="text-amber-400">⊙ Observer</span>
              <span className="text-green-400">● Visible</span>
              <span className="text-red-400">● Hidden</span>
            </div>
            <div className="text-neutral-400">
              Grid points every 800 m · orange dots mark the first obstruction ·
              red lines the hidden stretch
            </div>
          </>
        ) : (
          <button type="button" className="underline" onClick={onRetry}>
            {point.lat > -80
              ? 'Select a point south of 80°S'
              : 'Failed · retry'}
          </button>
        )}
      </div>
      {sites.length > 0 ? (
        <div className="border-t border-white/10 pt-2">
          <h3 className="text-neutral-400">
            TOP 5 candidates · grid points visible from {height} m
          </h3>
          <ol aria-label="Visible grid points per candidate" className="mt-1">
            {sites.map((site, index) => (
              <li key={site.id}>
                <button
                  type="button"
                  aria-current={selectedSiteId === site.id}
                  onClick={() => onSelectSite(site.id)}
                  className="flex w-full items-center gap-2 rounded border border-transparent px-2 py-1 text-left hover:bg-white/5 aria-[current=true]:border-white/20 aria-[current=true]:bg-white/5"
                >
                  <span className="grid size-4 shrink-0 place-items-center rounded-full bg-neutral-100 font-mono text-[10px] text-neutral-950">
                    {index + 1}
                  </span>
                  {site.name}
                  <span
                    className={`ml-auto font-mono ${best[index] ? 'font-semibold text-teal-300' : ''}`}
                  >
                    {countText(counts[index])}
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </section>
  )
}
