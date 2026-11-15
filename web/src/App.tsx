import { lazy, Suspense, useEffect, useState } from 'react'
import { fetchHealth } from './api/client'
import { MissionWorkspace } from './mission/MissionWorkspace'
import { MissionSummary } from './mission/MissionSummary'
import { DEMO_SITES, INITIAL_SELECTION } from './mission/demoSites'
import { missionParams } from './mission/liveAnalysis'
import { useMissionAnalysis } from './mission/useMissionAnalysis'
import { ScheduleSchema } from './mission/scheduleSchema'
import type { MissionSelection, Schedule } from './mission/types'

const DatePlanner = lazy(() =>
  import('./mission/DatePlanner').then((module) => ({
    default: module.DatePlanner,
  })),
)
const AnalysisWorkspace = lazy(() => import('./AnalysisWorkspace'))
const OrbitWorkspace = lazy(() => import('./mission/OrbitWorkspace'))
const SearchWorkspace = lazy(() => import('./search/SearchWorkspace'))
type View = 'mission' | 'analysis' | 'orbit' | 'search'
type HealthState =
  { kind: 'loading' } | { kind: 'ok' } | { kind: 'error'; message: string }

function currentView(): View {
  if (window.location.pathname.replace(/\/+$/, '') === '/orbit') return 'orbit'
  const view = new URLSearchParams(window.location.search).get('view')
  return view === 'analysis' || view === 'orbit' || view === 'search'
    ? view
    : 'mission'
}

function initialSelection(): MissionSelection {
  const params = new URLSearchParams(window.location.search)
  const schedule = ScheduleSchema.safeParse({
    departure: params.get('departure'),
    landing: params.get('arrival'),
    duration: Number(params.get('duration') ?? INITIAL_SELECTION.duration),
  })
  const siteId = params.get('site')
  return {
    ...INITIAL_SELECTION,
    ...(schedule.success ? schedule.data : {}),
    siteId: DEMO_SITES.some((site) => site.id === siteId)
      ? siteId!
      : INITIAL_SELECTION.siteId,
  }
}

function locationFor(
  view: View,
  selection: MissionSelection,
  planner: boolean,
): string {
  const url = new URL(window.location.href)
  url.pathname = view === 'orbit' ? '/orbit' : '/'
  if (view === 'analysis' || view === 'search')
    url.searchParams.set('view', view)
  else url.searchParams.delete('view')
  url.searchParams.set('departure', selection.departure)
  url.searchParams.set('arrival', selection.landing)
  url.searchParams.set('duration', String(selection.duration))
  url.searchParams.set('site', selection.siteId)
  if (view === 'mission' && planner) url.searchParams.set('planner', '1')
  else url.searchParams.delete('planner')
  return `${url.pathname}${url.search}${url.hash}`
}

export default function App() {
  const [view, setView] = useState<View>(currentView)
  const [selection, setSelection] = useState(initialSelection)
  const [planner, setPlanner] = useState(
    () => new URLSearchParams(window.location.search).get('planner') === '1',
  )
  useEffect(() => {
    const pop = () => {
      setView(currentView())
      setPlanner(
        new URLSearchParams(window.location.search).get('planner') === '1',
      )
    }
    window.addEventListener('popstate', pop)
    return () => window.removeEventListener('popstate', pop)
  }, [])
  useEffect(() => {
    // Keep the shared selection through Back/Forward and reload, including changes on the orbit page.
    window.history.replaceState(
      window.history.state,
      '',
      locationFor(view, selection, planner),
    )
  }, [view, selection, planner])
  function navigate(
    nextView: View,
    openPlanner = false,
    nextSelection = selection,
  ) {
    window.history.pushState(
      null,
      '',
      locationFor(nextView, nextSelection, openPlanner),
    )
    setSelection(nextSelection)
    setView(nextView)
    setPlanner(openPlanner)
  }
  return (
    <>
      <Suspense
        fallback={
          <p role="status" className="p-4 text-sm text-neutral-300">
            화면을 불러오는 중입니다.
          </p>
        }
      >
        {view === 'analysis' ? (
          <AnalysisWorkspace
            dashboardHref={locationFor('mission', selection, false)}
            onDashboardClick={(event) => {
              if (
                event.button !== 0 ||
                event.metaKey ||
                event.ctrlKey ||
                event.shiftKey ||
                event.altKey
              )
                return
              event.preventDefault()
              navigate('mission')
            }}
          />
        ) : view === 'orbit' ? (
          <OrbitWorkspace
            schedule={selection}
            onScheduleChange={(schedule) =>
              setSelection((current) => ({ ...current, ...schedule }))
            }
            onBack={() => navigate('mission', true)}
          />
        ) : view === 'search' ? (
          <SearchWorkspace
            schedule={selection}
            onBack={() => navigate('mission')}
          />
        ) : (
          <MissionApp
            selection={selection}
            onSelect={(siteId) =>
              setSelection((current) => ({ ...current, siteId }))
            }
            planner={planner}
            onPlannerChange={setPlanner}
            onApply={(schedule) => {
              setSelection((current) => ({ ...current, ...schedule }))
              setPlanner(false)
            }}
            onViewOrbit={(schedule) =>
              navigate('orbit', false, { ...selection, ...schedule })
            }
          />
        )}
      </Suspense>
      {view === 'mission' ? (
        <div className="fixed bottom-10 left-32 z-20 flex gap-2">
          <a
            className="hud-button"
            href={locationFor('analysis', selection, false)}
            onClick={(event) => {
              if (
                event.button !== 0 ||
                event.metaKey ||
                event.ctrlKey ||
                event.shiftKey ||
                event.altKey
              )
                return
              event.preventDefault()
              navigate('analysis')
            }}
          >
            상세 분석
          </a>
          <button
            type="button"
            className="hud-button"
            onClick={() => navigate('search')}
          >
            후보지 탐색
          </button>
        </div>
      ) : null}
    </>
  )
}

function MissionApp({
  selection,
  onSelect,
  planner,
  onPlannerChange,
  onApply,
  onViewOrbit,
}: {
  selection: MissionSelection
  onSelect: (siteId: string) => void
  planner: boolean
  onPlannerChange: (open: boolean) => void
  onApply: (schedule: Schedule) => void
  onViewOrbit: (schedule: Schedule) => void
}) {
  const [health, setHealth] = useState<HealthState>({ kind: 'loading' })
  useEffect(() => {
    const controller = new AbortController()
    fetchHealth({ signal: controller.signal })
      .then(() => setHealth({ kind: 'ok' }))
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
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
      onSelect={onSelect}
      summary={
        <button
          type="button"
          className="w-full rounded text-left"
          aria-haspopup="dialog"
          aria-controls="datePlanner"
          aria-label="미션 날짜 비교 열기"
          onClick={() => onPlannerChange(true)}
        >
          <MissionSummary selection={selection} />
          <span className="mt-3 block text-right text-xs text-amber-400">
            날짜 계획 보기 ↗
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
            onApply={onApply}
            onViewOrbit={onViewOrbit}
            onClose={() => onPlannerChange(false)}
          />
        </Suspense>
      ) : null}
    </MissionWorkspace>
  )
}
