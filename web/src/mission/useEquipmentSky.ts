import { useEffect, useState } from 'react'
import { fetchAnalysis } from '../api/analysis'
import { offsetLocation } from '../moon/location'
import {
  sampledPlaces,
  type Company,
  type EquipmentSky,
  type PlaceSky,
  type SurfaceOffset,
} from './demoEquipment'
import { skyFromAnalysis } from './equipmentSky'
import type { CandidateSite } from './types'

export type EquipmentSkyState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready'; sky: EquipmentSky; missing: number }
  | { kind: 'error'; sky: EquipmentSky }

export const EMPTY_SKY: EquipmentSky = { statics: {}, waypoints: [] }

/** One sample is enough: the mission instant is fixed and only the place changes. */
const STEP_MINUTES = 30

/** Samples both bodies at each fixed unit and route waypoint for the settled review time. */
export function useEquipmentSky(
  site: CandidateSite | undefined,
  start: string,
  company: Company,
  attempt: number,
): EquipmentSkyState {
  const lat = site?.latitude
  const lon = site?.longitude
  // Keyed like useSiteAssessments: a result belongs to the inputs that asked for it,
  // so "loading" is derived during render instead of set from inside the effect.
  const key = JSON.stringify([lat, lon, start, company.id, attempt])
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
    const end = new Date(Date.parse(start) + STEP_MINUTES * 60_000)
      .toISOString()
      .replace('.000Z', 'Z')
    const centre = { lat, lon }
    /**
     * Both bodies at one place: the Earth decides whether the unit can talk, the Sun
     * whether it can run. Same point, same instant, same observer height, so the two
     * answers are comparable and a unit can be clear on one and blocked on the other.
     */
    const sample = async (
      offset: SurfaceOffset,
      observerHeightM: number,
    ): Promise<PlaceSky> => {
      const place = offsetLocation(centre, offset.eastM, offset.northM)
      const params = {
        lat: place.lat,
        lon: place.lon,
        start,
        end,
        step_minutes: STEP_MINUTES,
        observer_height_m: observerHeightM,
      }
      const [earth, sun] = await Promise.all([
        fetchAnalysis('earth-visibility', params, signal)
          .then(skyFromAnalysis)
          .catch(() => null),
        fetchAnalysis('illumination', params, signal)
          .then(skyFromAnalysis)
          .catch(() => null),
      ])
      return { earth, sun }
    }

    const load = async () => {
      const statics: Record<string, PlaceSky> = {}
      const waypoints: PlaceSky[] = []
      const places = sampledPlaces(company)
      let next = 0
      let missing = 0
      let received = false
      // Two positions at a time bound concurrent DEM work while keeping both bodies parallel.
      const worker = async () => {
        while (next < places.length && !controller.signal.aborted) {
          const place = places[next++]!
          const result = await sample(place.offset, place.observerHeightM)
          if (!result.earth || !result.sun) missing++
          if (result.earth || result.sun) received = true
          if ('unitId' in place) statics[place.unitId] = result
          else waypoints[place.waypoint] = result
        }
      }
      await Promise.all([worker(), worker()])
      if (!controller.signal.aborted)
        setStored({
          key,
          state: received
            ? { kind: 'ready', missing, sky: { statics, waypoints } }
            : { kind: 'error', sky: { statics, waypoints } },
        })
    }

    const timer = window.setTimeout(() => {
      void load().catch(() => {
        if (!controller.signal.aborted)
          setStored({ key, state: { kind: 'error', sky: EMPTY_SKY } })
      })
    }, 200)

    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [lat, lon, start, company, key])

  if (lat === undefined || lon === undefined) return { kind: 'idle' }
  return stored?.key === key ? stored.state : { kind: 'loading' }
}
