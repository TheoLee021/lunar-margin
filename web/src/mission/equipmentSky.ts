import type { Analysis } from '../api/analysis'
import { horizonAtAzimuth } from '../analysis/derive'
import { parseSkyDirection, type SkyDirection } from '../moon/lineOfSight'

/**
 * Where the body sits in the sky at the first sample of an analysis response,
 * with the API's own `visible` verdict. The mission instant is fixed for the demo,
 * so one sample per place is all a unit needs.
 */
export function skyFromAnalysis(analysis: Analysis): SkyDirection {
  const { series } = analysis
  const azimuthDeg = series.body_azimuth_deg[0]
  return parseSkyDirection({
    azimuthDeg,
    elevationDeg: series.body_elevation_deg[0],
    // The response carries the whole horizon profile; the height that matters is the
    // one at the body's own azimuth, which is also what the API judged `visible` on.
    horizonDeg:
      azimuthDeg === undefined
        ? undefined
        : horizonAtAzimuth(analysis.horizon, azimuthDeg),
    clearanceDeg: series.terrain_clearance_deg?.[0],
    visible: series.visible[0],
  })
}
