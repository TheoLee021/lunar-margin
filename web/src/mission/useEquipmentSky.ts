import { useEffect, useState } from 'react'
import { fetchAnalysis } from '../api/analysis'
import { offsetLocation } from '../moon/location'
import {
  STATIC_EQUIPMENT,
  TRAVERSE,
  TRENCHER,
  type EquipmentSky,
  type SurfaceOffset,
} from './demoEquipment'
import { skyFromAnalysis } from './equipmentSky'
import type { CandidateSite, Schedule } from './types'

export type EquipmentSkyState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready'; sky: EquipmentSky; missing: number }
  | { kind: 'error' }

export const EMPTY_SKY: EquipmentSky = { statics: {}, waypoints: [] }

/** One sample is enough: the mission instant is fixed and only the place changes. */
const STEP_MINUTES = 30

/**
 * Asks the analysis API whether the Earth is up at every place a unit stands, including
 * each trench waypoint. One request per place, never per frame: a horizon is 360 rays
 * over the DEM, so the trencher's path is sampled at its waypoints and interpolated between.
 */
export function useEquipmentSky(
  site: CandidateSite | undefined,
  schedule: Schedule,
): EquipmentSkyState {
  const { landing } = schedule
  const lat = site?.latitude
  const lon = site?.longitude
  // Keyed like useSiteAssessments: a result belongs to the inputs that asked for it,
  // so "loading" is derived during render instead of set from inside the effect.
  const key = JSON.stringify([lat, lon, landing])
  const [stored, setStored] = useState<{
    key: string
    state: EquipmentSkyState
  } | null>(null)

  useEffect(() => {
    if (lat === undefined || lon === undefined) return
    const controller = new AbortController()
    const signal = AbortSignal.any([
      controller.signal,
      AbortSignal.timeout(60_000),
    ])
    const start = `${landing}T00:00:00Z`
    const end = new Date(Date.parse(start) + STEP_MINUTES * 60_000)
      .toISOString()
      .replace('.000Z', 'Z')
    const centre = { lat, lon }
    const sample = (offset: SurfaceOffset, observerHeightM: number) => {
      const place = offsetLocation(centre, offset.eastM, offset.northM)
      return fetchAnalysis(
        'earth-visibility',
        {
          lat: place.lat,
          lon: place.lon,
          start,
          end,
          step_minutes: STEP_MINUTES,
          observer_height_m: observerHeightM,
        },
        signal,
      ).then(skyFromAnalysis, () => null)
    }

    // Debounced like the other analysis hooks so scrubbing dates does not fire a burst.
    const timer = window.setTimeout(() => {
      void Promise.all([
        Promise.all(
          STATIC_EQUIPMENT.map((spec) =>
            sample(spec.offset, spec.observerHeightM),
          ),
        ),
        Promise.all(
          TRAVERSE.map((offset) => sample(offset, TRENCHER.observerHeightM)),
        ),
      ]).then(
        ([statics, waypoints]) => {
          if (controller.signal.aborted) return
          const missing =
            statics.filter((sky) => sky === null).length +
            waypoints.filter((sky) => sky === null).length
          if (missing === statics.length + waypoints.length) {
            setStored({ key, state: { kind: 'error' } })
            return
          }
          setStored({
            key,
            state: {
              kind: 'ready',
              missing,
              sky: {
                statics: Object.fromEntries(
                  STATIC_EQUIPMENT.map((spec, index) => [
                    spec.id,
                    statics[index] ?? null,
                  ]),
                ),
                waypoints,
              },
            },
          })
        },
        () => {
          if (!controller.signal.aborted)
            setStored({ key, state: { kind: 'error' } })
        },
      )
    }, 200)

    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [lat, lon, landing, key])

  if (lat === undefined || lon === undefined) return { kind: 'idle' }
  return stored?.key === key ? stored.state : { kind: 'loading' }
}
