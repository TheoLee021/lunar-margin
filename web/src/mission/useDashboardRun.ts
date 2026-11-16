import { useEffect, useState } from 'react'
import { fetchRun, fetchRuns, type RunDetail } from '../api/candidates'
import { DAY } from './missionDates'
import type { Schedule } from './types'

type Result =
  | { kind: 'loading' | 'empty' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; run: RunDetail }

/** Read a completed run for this surface period; never start a search implicitly. */
export function useDashboardRun(schedule: Schedule) {
  const preferred =
    new URLSearchParams(window.location.search).get('run') ??
    new URLSearchParams(window.location.search).get('pricing_run')
  const landing = schedule.landing,
    duration = schedule.duration
  const maxSlope = schedule.maxSlope
  const [revision, setRevision] = useState(0)
  const key = JSON.stringify([landing, duration, preferred, revision, maxSlope])
  const [stored, setStored] = useState<{ key: string; result: Result } | null>(
    null,
  )
  useEffect(() => {
    const controller = new AbortController()
    const start = Date.parse(`${landing}T00:00:00Z`),
      end = start + duration * DAY
    async function load() {
      try {
        const { runs } = await fetchRuns({ signal: controller.signal })
        const matching = runs.filter(
          (run) =>
            !run.id.startsWith('dev-') &&
            (maxSlope === undefined ||
              (run.max_terrain_slope_degrees ?? null) === maxSlope) &&
            Date.parse(run.window.start) === start &&
            Date.parse(run.window.end) === end,
        )
        const chosen =
          matching.find((run) => run.id === preferred) ?? matching[0]
        let result: Result = { kind: 'empty' }
        if (chosen) {
          const run = await fetchRun(chosen.id, { signal: controller.signal })
          if (
            run.id !== chosen.id ||
            run.config.grid_spacing_m !== 500 ||
            Date.parse(run.config.window.start) !== start ||
            Date.parse(run.config.window.end) !== end
          )
            throw new Error(
              'The result does not match the 500 m precise search for the selected period.',
            )
          result = { kind: 'ready', run }
        }
        if (!controller.signal.aborted) setStored({ key, result })
      } catch (error: unknown) {
        if (!controller.signal.aborted)
          setStored({
            key,
            result: {
              kind: 'error',
              message: error instanceof Error ? error.message : String(error),
            },
          })
      }
    }
    void load()
    return () => controller.abort()
  }, [landing, duration, preferred, revision, key, maxSlope])
  return {
    result:
      stored?.key === key ? stored.result : ({ kind: 'loading' } as const),
    reload: () => setRevision((value) => value + 1),
  }
}
