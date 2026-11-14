import { expect, it } from 'vitest'
import type { Analysis, AnalysisParams } from '../api/analysis'
import { loadMissionAnalysis, missionParams } from './liveAnalysis'
import { DEMO_SITES } from './demoSites'

const params: AnalysisParams = {
  lat: -89.7,
  lon: 130,
  start: '2027-01-10T00:00:00Z',
  end: '2027-01-17T00:00:00Z',
  step_minutes: 30,
  observer_height_m: 0,
}
function response(): Analysis {
  return {
    ...params,
    metrics: {
      visible_fraction: 0,
      longest_dark_hours: 168,
      windows_per_24h: 0,
      mean_elevation_deg: null,
    },
    horizon: { azimuth_deg: [0, 90, 180, 270], elevation_deg: [0, 2, 4, 2] },
    series: {
      times: [params.start, '2027-01-10T00:30:00Z'],
      body_azimuth_deg: [315, 45],
      body_elevation_deg: [-1, -0.5],
      visible: [false, false],
    },
    windows: [],
    dark_periods: [{ start: params.start, end: params.end }],
  }
}
it('maps landing plus surface duration to UTC analysis, independent of departure', () => {
  expect(
    missionParams(DEMO_SITES[0]!, {
      departure: '2027-01-06',
      landing: '2027-01-10',
      duration: 7,
    }),
  ).toMatchObject({
    start: params.start,
    end: params.end,
    step_minutes: 30,
    observer_height_m: 0,
  })
})
it('loads both bodies atomically and retains server metrics, exact windows and all samples', async () => {
  const live = await loadMissionAnalysis(params, undefined, {
    fetchFn: () => Promise.resolve(Response.json(response())),
  })
  expect(live.sun.metrics.visible_fraction).toBe(0)
  expect(live.earth.metrics.mean_elevation_deg).toBeNull()
  expect(live.timeline.t).toEqual([0, 1 / 48])
  expect(live.timeline.sunHz).toEqual([1, 1])
  expect(live.timeline.earthHz).toEqual([1, 1])
  expect(live.timeline.sunEl).toEqual([-1, -0.5])
  expect(live.timeline.sunPeriods).toEqual([{ start: 0, end: 7, on: false }])
})
it('rejects mismatched periods or sample times instead of mixing two analyses', async () => {
  for (const mismatch of ['period', 'times', 'site', 'horizon'] as const) {
    await expect(
      loadMissionAnalysis(params, undefined, {
        fetchFn: (url) => {
          const body = response()
          if (url.includes('earth-visibility')) {
            if (mismatch === 'period') body.end = '2027-01-18T00:00:00Z'
            if (mismatch === 'times')
              body.series.times[1] = '2027-01-10T01:00:00Z'
            if (mismatch === 'site') body.lat = -89.8
            if (mismatch === 'horizon')
              body.horizon = { azimuth_deg: [], elevation_deg: [] }
          }
          return Promise.resolve(Response.json(body))
        },
      }),
    ).rejects.toThrow('분석 응답')
  }
})
it('propagates one failed request without publishing a partial or example result', async () => {
  await expect(
    loadMissionAnalysis(params, undefined, {
      fetchFn: (url) =>
        Promise.resolve(
          url.includes('earth-visibility')
            ? Response.json({ detail: 'NASA data not found' }, { status: 503 })
            : Response.json(response()),
        ),
    }),
  ).rejects.toMatchObject({ status: 503 })
})
