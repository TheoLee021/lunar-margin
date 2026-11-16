import { useEffect, useState } from 'react'
import { fetchViewshed, visibleGridCount } from '../api/viewshed'
import type { CandidateSite } from './types'

/**
 * How many grid targets a site sees: a count, `null` when the terrain data is incomplete,
 * `'error'` when the viewshed could not be computed and `undefined` while it is loading.
 */
export type VisibleCount = number | null | 'error' | undefined

/**
 * The visible grid targets of every site from one observer height. At the search's own
 * height the saved counts are used as they are; any other height asks for fresh viewsheds.
 */
export function useVisibleCounts(
  sites: readonly CandidateSite[],
  height: number,
  searchHeight: number,
  saved: (siteId: string) => number | null,
  demName?: string,
): VisibleCount[] {
  const [fetched, setFetched] = useState<{
    sites: readonly CandidateSite[]
    height: number
    counts: (number | null | 'error')[]
  } | null>(null)
  useEffect(() => {
    if (!sites.length || height === searchHeight) return
    const controller = new AbortController()
    const signal = AbortSignal.any([
      controller.signal,
      AbortSignal.timeout(30000),
    ])
    void Promise.all(
      sites.map(async (site) => {
        try {
          const map = await fetchViewshed(
            site.latitude,
            site.longitude,
            height,
            signal,
            site.grid,
            demName,
          )
          return visibleGridCount(map)
        } catch {
          return 'error' as const
        }
      }),
    ).then((counts) => {
      if (!controller.signal.aborted) setFetched({ sites, height, counts })
    })
    return () => controller.abort()
  }, [sites, height, demName, searchHeight])
  if (height === searchHeight) return sites.map((site) => saved(site.id))
  const counts =
    fetched?.sites === sites && fetched.height === height
      ? fetched.counts
      : undefined
  return sites.map((_, index) => counts?.[index])
}
