import type { SearchConfig } from '../api/candidates'

const limit = (value: number | null | undefined, unit: string) =>
  value == null ? 'no limit' : `${value}${unit}`

/** The conditions the saved search ran with, folded away until they are asked for. */
export function AppliedConditions({ config }: { config: SearchConfig }) {
  const { thresholds, weights } = config
  const rf = config.rf != null
  const conditions = [
    `Longest darkness ≤ ${limit(thresholds.max_sun_dark_hours, ' h')}`,
    `${rf ? 'Longest RF outage' : 'Longest Earth blackout'} ≤ ${limit(
      rf
        ? thresholds.max_rf_blackout_hours
        : thresholds.max_earth_blackout_hours,
      ' h',
    )}`,
    `Terrain slope limit ${limit(thresholds.max_terrain_slope_degrees, '°')}`,
    ...(rf
      ? [
          `Minimum RF availability ${
            thresholds.min_rf_fraction == null
              ? 'no limit'
              : `${thresholds.min_rf_fraction * 100}%`
          }`,
        ]
      : []),
    `Observer height ${config.observer_height_m} m`,
    `Sunlight : ${rf ? 'RF link' : 'Earth visibility'} weight ${weights.sun} : ${weights.earth}`,
    weights.visibility
      ? `Viewshed weight ${Math.round(weights.visibility * 100)}% (search height ${config.observer_height_m} m)`
      : 'Viewshed not weighted (0%)',
  ]
  return (
    <details className="text-xs">
      <summary className="cursor-pointer text-neutral-400">
        Applied search conditions · {conditions.length}
      </summary>
      <ul className="mt-2 grid gap-2 text-neutral-300">
        {conditions.map((condition) => (
          <li key={condition}>{condition}</li>
        ))}
      </ul>
    </details>
  )
}
