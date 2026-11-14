import { lazy, Suspense, useEffect, useState } from 'react'
import { fetchHealth } from './api/client'
import { MissionWorkspace } from './mission/MissionWorkspace'
import { MissionSummary } from './mission/MissionSummary'
import { DEMO_SITES, INITIAL_SELECTION } from './mission/demoSites'
import { missionParams } from './mission/liveAnalysis'
import { useMissionAnalysis } from './mission/useMissionAnalysis'

const DatePlanner = lazy(() =>
  import('./mission/DatePlanner').then((module) => ({
    default: module.DatePlanner,
  })),
)

type HealthState =
  { kind: 'loading' } | { kind: 'ok' } | { kind: 'error'; message: string }

const AnalysisWorkspace = lazy(() => import('./AnalysisWorkspace'))

export default function App() {
  const analysis =
    new URLSearchParams(window.location.search).get('view') === 'analysis'
  return (
    <>
      <Suspense
        fallback={
          <p role="status" className="p-4 text-sm text-neutral-300">
            분석 화면을 불러오는 중입니다.
          </p>
        }
      >
        {analysis ? <AnalysisWorkspace /> : <MissionApp />}
      </Suspense>
      {!analysis ? (
        <a
          className="hud-button fixed bottom-10 left-32 z-20"
          href="/?view=analysis"
        >
          상세 분석
        </a>
      ) : null}
    </>
  )
}

function MissionApp() {
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
  const site =
    DEMO_SITES.find((s) => s.id === selection.siteId) ?? DEMO_SITES[0]!
  const live = useMissionAnalysis(missionParams(site, selection))
  return (
    <MissionWorkspace
      selection={selection}
      analysis={live}
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
            site={site}
            appliedAnalysis={live}
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
