import { MoonDisc } from '../mission/MoonDisc'
import { useMemo, useId } from 'react'
import { pathOf, type Point } from '../mission/transferData'
import { dot, trackVertices, unit } from './trackGeometry'
import type { FlightPoint } from './flightData'

const radius = 1737400
const phases = ['PARKING_COAST', 'DOI_COAST', 'POWERED_DESCENT'] as const
const colors = ['#56b4e9', '#63d3ba', '#ffad42']
export function FlightPlots({
  points,
  frame,
}: {
  points: readonly FlightPoint[]
  frame: number
}) {
  const moonId = useId()
  const plot = useMemo(() => {
    if (!points.length) return null
    const x = unit(points[0]!.moonMe)
    // Choose a well-separated sample to define the plane, including polar arcs.
    const other = points.reduce((best, p) =>
      Math.abs(dot(x, unit(p.moonMe))) < Math.abs(dot(x, unit(best.moonMe)))
        ? p
        : best,
    )
    const v = unit(other.moonMe),
      k = dot(x, v)
    const y = unit([v[0] - k * x[0], v[1] - k * x[1], v[2] - k * x[2]])
    const project = (p: FlightPoint['moonMe']): Point => [
      230 + (dot(x, p) * 106) / radius,
      130 - (dot(y, p) * 106) / radius,
    ]
    const paths = phases.map((phase) =>
      pathOf(
        trackVertices(points.filter((p) => p.phase === phase)).map(project),
      ),
    )
    const descent = points.filter((p) => p.phase === 'POWERED_DESCENT')
    const duration = descent.at(-1)?.elapsedS ?? 1
    const height = Math.max(1, ...descent.map((p) => (p.altitudeM ?? 0) / 1000))
    const top = Math.ceil(height / 5) * 5
    const profile = (p: FlightPoint): Point => [
      44 + (365 * (p.elapsedS ?? 0)) / duration,
      125 - (94 * (p.altitudeM ?? 0)) / (top * 1000),
    ]
    return { project, paths, descent, duration, top, profile }
  }, [points])
  const current = points[frame]
  if (!plot || !current) return null
  const [cx, cy] = plot.project(current.moonMe)
  const end = points.at(-1)!
  return (
    <div className="mx-auto grid w-full max-w-3xl gap-3 px-4 py-2 text-xs">
      {points[0]?.phase !== 'POWERED_DESCENT' && (
        <figure className="rounded-lg border border-neutral-700 bg-neutral-950 p-3">
          <figcaption>Lunar orbit in the orbital plane</figcaption>
          <svg
            viewBox="0 0 460 260"
            className="mx-auto block max-h-[31vh] w-full"
            role="img"
            aria-label="Orbital plane projection from lunar orbit insertion to descent"
          >
            <MoonDisc x={230} y={130} radius={106} id={moonId} />
            <text
              x={plot.project(points[0]!.moonMe)[0] + 8}
              y="134"
              fill="#b7c0c7"
            >
              Lunar orbit insertion
            </text>
            {plot.paths.map((d, i) => (
              <path
                key={phases[i]}
                d={d}
                fill="none"
                stroke={colors[i]}
                strokeWidth="2.3"
              />
            ))}
            <circle cx={cx} cy={cy} r="4.5" fill="white" stroke="#111" />
          </svg>
          <div className="flex justify-center gap-4">
            {['Capture orbit', 'Descent orbit', 'Powered descent'].map(
              (label, i) => (
                <span key={label} style={{ color: colors[i] }}>
                  {label}
                </span>
              ),
            )}
          </div>
        </figure>
      )}
      {plot.descent.length > 0 && (
        <figure className="rounded-lg border border-neutral-700 bg-neutral-950 p-3">
          <figcaption>Powered descent above the terrain</figcaption>
          <svg
            viewBox="0 0 460 158"
            className="block max-h-[23vh] w-full"
            role="img"
            aria-label="Height above terrain from powered descent to touchdown"
          >
            {[0, 0.5, 1].map((f) => (
              <g key={f}>
                <path d={`M44,${125 - 94 * f}h365`} stroke="#414951" />
                <text x="39" y={129 - 94 * f} fill="#b7c0c7" textAnchor="end">
                  {plot.top * f}
                </text>
              </g>
            ))}
            <text x="9" y="16" fill="#b7c0c7">
              km
            </text>
            <path
              d={pathOf(plot.descent.map(plot.profile))}
              stroke={colors[2]}
              strokeWidth="2.5"
              fill="none"
            />
            <text x="44" y="149" fill="#d4d8dc">
              Descent begins · 0 min
            </text>
            <text x="409" y="149" textAnchor="end" fill="#d4d8dc">
              Touchdown · {(plot.duration / 60).toFixed(1)} min
            </text>
            <circle
              cx={plot.profile(end)[0]}
              cy={plot.profile(end)[1]}
              r="3"
              fill={colors[2]}
            />
            {current.phase === 'POWERED_DESCENT' && (
              <circle
                cx={plot.profile(current)[0]}
                cy={plot.profile(current)[1]}
                r="4"
                fill="white"
                stroke="#111"
              />
            )}
          </svg>
        </figure>
      )}
    </div>
  )
}
