import type { Analysis } from '../api/analysis'
import { parseSkyDirection, type SkyDirection } from '../moon/lineOfSight'

/**
 * Where the Earth sits in the sky at the first sample of an analysis response,
 * with the API's own `visible` verdict. The mission instant is fixed for the demo,
 * so one sample per place is all a unit needs.
 */
export function skyFromAnalysis(analysis: Analysis): SkyDirection {
  const { series } = analysis
  return parseSkyDirection({
    azimuthDeg: series.body_azimuth_deg[0],
    elevationDeg: series.body_elevation_deg[0],
    visible: series.visible[0],
  })
}
