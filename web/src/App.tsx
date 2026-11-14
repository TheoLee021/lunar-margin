import { lazy, Suspense, useEffect, useState } from 'react'
import { fetchHealth } from './api/client'
import { MissionWorkspace } from './mission/MissionWorkspace'
import { MissionSummary } from './mission/MissionSummary'
import { DEMO_SITES, INITIAL_SELECTION } from './mission/demoSites'
import { demoAnalysis } from './mission/demoAnalysis'
import type { Schedule } from './mission/types'

const DatePlanner = lazy(() =>
  import('./mission/DatePlanner').then((module) => ({
    default: module.DatePlanner,
  })),
)

type HealthState =
  { kind: 'loading' } | { kind: 'ok' } | { kind: 'error'; message: string }

export default function App() {
  const [planner, setPlanner] = useState(false)
  const [selection, setSelection] = useState(INITIAL_SELECTION)
  const [health, setHealth] = useState<HealthState>({ kind: 'loading' })
  useEffect(() => {
    const controller = new AbortController()
    fetchHealth({ signal: controller.signal })
      .then(() => setHealth({ kind: 'ok' }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setHealth({
          kind: 'error',
          message: error instanceof Error ? error.message : String(error),
        })
      })
    return () => controller.abort()
  }, [])
  return (
    <MissionWorkspace
      selection={selection}
      onSelect={(siteId) => setSelection((current) => ({ ...current, siteId }))}
      summary={
        <button
          type="button"
          className="w-full rounded text-left"
          aria-haspopup="dialog"
          aria-controls="datePlanner"
          aria-label="미션 날짜 비교 열기"
          onClick={() => setPlanner(true)}
        >
          <MissionSummary selection={selection} />
          <span className="mt-3 block text-right text-xs text-amber-400">
            날짜 및 비행 계획 보기 ↗
          </span>
        </button>
      }
      apiStatus={
        <p data-testid="api-status">
          {health.kind === 'loading' && 'Connecting to API…'}
          {health.kind === 'ok' && 'API connected'}
          {health.kind === 'error' && `API unavailable: ${health.message}`}
        </p>
      }
    >
      {planner ? (
        <Suspense
          fallback={
            <div
              role="status"
              className="hud-panel absolute bottom-20 left-4 p-3 text-xs"
            >
              날짜 패널을 불러오는 중입니다.
            </div>
          }
        >
          <DatePlanner
            schedule={selection}
            hour={0}
            analyze={(draft: Schedule) =>
              demoAnalysis(
                draft,
                DEMO_SITES.find((site) => site.id === selection.siteId) ??
                  DEMO_SITES[0]!,
              )
            }
            onApply={(schedule) => {
              setSelection((current) => ({ ...current, ...schedule }))
              setPlanner(false)
            }}
            onClose={() => setPlanner(false)}
          />
        </Suspense>
      ) : null}
    </MissionWorkspace>
  )
}
