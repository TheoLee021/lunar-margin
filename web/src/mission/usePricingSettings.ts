import { useEffect, useState } from 'react'
import { fetchRun, type MissionRequest } from '../api/candidates'
import { DeliverySchema } from '../api/pricing'
const DEFAULT_MISSION: MissionRequest = {
  landing_date: '2027-01-10',
  mission_duration_days: 14,
  max_continuous_darkness_hours: 24,
  max_communication_blackout_hours: 6,
  max_terrain_slope_degrees: null,
  search_region: 'south',
  optimization_priority: 'balanced',
  observer_height_m: null,
}
export function usePricingSettings(
  slope: string,
  onSlopeChange: (value: string) => void,
) {
  const params = new URLSearchParams(window.location.search)
  const massNumber = Number(params.get('mass_kg') ?? 24)
  const delivery =
    DeliverySchema.safeParse(params.get('delivery')).data ?? 'surface'
  const [mission, setMission] = useState(DEFAULT_MISSION)
  const [darkness, setDarkness] = useState('24')
  const [blackout, setBlackout] = useState('6')
  const [source] = useState(
    () => new URLSearchParams(window.location.search).get('pricing_run') ?? '',
  )
  const [sourceState, setSourceState] = useState({
    id: '',
    loading: false,
    error: '',
  })
  useEffect(() => {
    if (!source) return
    const controller = new AbortController()
    fetchRun(source, { signal: controller.signal })
      .then((run) => {
        if (controller.signal.aborted) return
        if (!run.mission)
          throw new Error('Select a saved search with mission parameters.')
        setMission(run.mission)
        onSlopeChange(run.mission.max_terrain_slope_degrees?.toString() ?? '')
        setDarkness(run.mission.max_continuous_darkness_hours?.toString() ?? '')
        setBlackout(
          run.mission.max_communication_blackout_hours?.toString() ?? '',
        )
        setSourceState({ id: source, loading: false, error: '' })
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setSourceState({
            id: source,
            loading: false,
            error: error instanceof Error ? error.message : String(error),
          })
      })
    return () => controller.abort()
  }, [source, onSlopeChange])
  const optional = (value: string) =>
    value.trim() === '' ? null : Number(value)
  const slopeLimit = optional(slope),
    dark = optional(darkness),
    black = optional(blackout)
  const valid =
    (slopeLimit === null || (slopeLimit > 0 && slopeLimit <= 90)) &&
    (mission.observer_height_m == null ||
      (mission.observer_height_m >= 0 && mission.observer_height_m <= 100)) &&
    (mission.max_terrain_roughness_m == null ||
      mission.max_terrain_roughness_m >= 0) &&
    (mission.min_communication_fraction == null ||
      (mission.min_communication_fraction >= 0 &&
        mission.min_communication_fraction <= 1)) &&
    massNumber > 0 &&
    massNumber <= 1_000_000 &&
    Number.isFinite(massNumber) &&
    (dark === null || (Number.isFinite(dark) && dark >= 0)) &&
    (black === null || (Number.isFinite(black) && black >= 0))
  const sourceReady =
    source === '' || (sourceState.id === source && !sourceState.error)

  return {
    delivery,
    mission,
    source,
    sourceError: sourceState.error,
    valid,
    sourceReady,
    massNumber,
    slopeLimit,
    dark,
    black,
  }
}
export type PricingSettings = ReturnType<typeof usePricingSettings>
