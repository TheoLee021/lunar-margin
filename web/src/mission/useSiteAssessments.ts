import { useEffect, useState } from 'react'
import {
  fetchSiteAssessment,
  type SiteAssessment,
} from '../api/siteAssessment'
import { DAY } from './missionDates'
import type { CandidateSite, Schedule } from './types'

interface SiteAssessmentState {
  key: string
  results: Record<string, SiteAssessment>
  errors: Record<string, string>
  completed: number
}

export function useSiteAssessments(
  sites: readonly CandidateSite[],
  schedule: Schedule,
) {
  const [retry, setRetry] = useState(0)
  const [stored, setStored] = useState<SiteAssessmentState | null>(null)
  const key = JSON.stringify([schedule.landing, schedule.duration, retry])
  useEffect(() => {
    let active = true
    const controller = new AbortController()
    const start = schedule.landing + 'T00:00:00Z'
    const end = new Date(Date.parse(start) + schedule.duration * DAY)
      .toISOString()
      .replace('.000Z', 'Z')
    const results: Record<string, SiteAssessment> = {}
    const errors: Record<string, string> = {}
    let completed = 0

    const publish = () => {
      if (active) setStored({ key, results: { ...results }, errors: { ...errors }, completed })
    }
    // Limit the number of concurrent DEM horizon traversals on the API host.
    const timer = setTimeout(() => {
      publish()
      const process = async () => {
        for (let i = 0; i < sites.length && active; i += 2) {
          const batch = sites.slice(i, i + 2)
          await Promise.all(batch.map(async (site) => {
            try {
              const data = await fetchSiteAssessment(
                {
                  lat: site.latitude,
                  lon: site.longitude,
                  start,
                  end,
                  step_minutes: 30,
                },
                { signal: controller.signal },
              )
              if (!active) return
              if (data.lat !== site.latitude || data.lon !== site.longitude ||
                  Date.parse(data.start) !== Date.parse(start) ||
                  Date.parse(data.end) !== Date.parse(end)) {
                errors[site.id] = '분석 응답의 지점·기간이 요청과 일치하지 않습니다.'
              } else {
                results[site.id] = data
              }
            } catch {
              if (!active) return
              errors[site.id] = 'NASA 후보 분석을 불러오지 못했습니다.'
            }
            completed += 1
            publish()
          }))
        }
      }
      void process()
    }, 200)
    return () => {
      active = false
      clearTimeout(timer)
      controller.abort()
    }
  }, [sites, schedule.landing, schedule.duration, key])

  const current = stored?.key === key ? stored : null
  return {
    results: current?.results ?? {},
    errors: current?.errors ?? {},
    completed: current?.completed ?? 0,
    loading: !current || current.completed < sites.length,
    retry: () => setRetry((n) => n + 1),
  }
}
