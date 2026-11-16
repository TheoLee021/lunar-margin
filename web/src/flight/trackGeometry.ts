import type { FlightPoint } from './flightData'

type XYZ = FlightPoint['moonMe']
export const dot = (a: XYZ, b: XYZ) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
export function unit(a: XYZ): XYZ {
  const length = Math.hypot(...a)
  return [a[0] / length, a[1] / length, a[2] / length]
}

// Interpolate orbital arcs for display at <=1 degree spacing. Preserve every
// propagated sample, including its radius. Powered descent uses the measured samples.
export function trackVertices(points: readonly FlightPoint[]): XYZ[] {
  const out: XYZ[] = []
  points.forEach((p, i) => {
    const prev = points[i - 1]
    if (prev && p.phase !== 'POWERED_DESCENT' && p.phase === prev.phase) {
      const a = unit(prev.moonMe),
        b = unit(p.moonMe)
      const angle = Math.acos(Math.max(-1, Math.min(1, dot(a, b))))
      const steps = Math.ceil((angle * 180) / Math.PI)
      const r0 = Math.hypot(...prev.moonMe),
        r1 = Math.hypot(...p.moonMe)
      for (let j = 1; j < steps; j++) {
        const t = j / steps,
          r = r0 + (r1 - r0) * t
        const u = (r * Math.sin((1 - t) * angle)) / Math.sin(angle),
          v = (r * Math.sin(t * angle)) / Math.sin(angle)
        out.push([
          u * a[0] + v * b[0],
          u * a[1] + v * b[1],
          u * a[2] + v * b[2],
        ])
      }
    }
    out.push(p.moonMe)
  })
  return out
}
