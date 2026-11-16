import { FlightConditions, type FlightOverride } from './flight/flightPlan'
import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { fetchHealth } from './api/client'
import { MissionWorkspace } from './mission/MissionWorkspace'
import { MissionSummary } from './mission/MissionSummary'
import { missionParams } from './mission/liveAnalysis'
import { useDashboardRun } from './mission/useDashboardRun'
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
const CandidateOverview = lazy(() => import('./search/CandidateOverview'))
const SearchWorkspace = lazy(() => import('./search/SearchWorkspace'))
const INITIAL_SELECTION: MissionSelection = {
  departure: '2027-01-06',
  landing: '2027-01-10',
  duration: 14,
  siteId: null,
}
type View = 'mission' | 'analysis' | 'orbit' | 'search' | 'flight'
type HealthState =
  { kind: 'loading' } | { kind: 'ok' } | { kind: 'error'; message: string }

function overviewRun() {
  const params = new URLSearchParams(window.location.search)
  return params.get('overview') === '1' ? params.get('run') : null
}

function currentView(): View {
  if (overviewRun()) return 'mission'
  if (window.location.pathname.replace(/\/+$/, '') === '/orbit') return 'orbit'
  if (window.location.pathname.replace(/\/+$/, '') === '/flight')
    return 'flight'
  const view = new URLSearchParams(window.location.search).get('view')
  return view === 'analysis' || view === 'orbit' || view === 'search'
    ? view
    : 'mission'
}

function initialSelection(): MissionSelection {
  const params = new URLSearchParams(window.location.search)
  const schedule = ScheduleSchema.safeParse({
    maxSlope: params.has('max_slope')
      ? params.get('max_slope') === 'none'
        ? null
        : Number(params.get('max_slope'))
      : undefined,
    launchId: params.get('launch_id'),
    departure: params.get('departure'),
    landing: params.get('arrival'),
    duration: Number(params.get('duration') ?? INITIAL_SELECTION.duration),
  })
  const siteId = params.get('site')
  return {
    ...INITIAL_SELECTION,
    ...(schedule.success ? schedule.data : {}),
    siteId,
  }
}

function locationFor(
  view: View,
  selection: MissionSelection,
  planner: boolean,
): string {
  const url = new URL(window.location.href)
  url.pathname =
    view === 'orbit' ? '/orbit' : view === 'flight' ? '/flight' : '/'
  if (view === 'analysis' || view === 'search')
    url.searchParams.set('view', view)
  else url.searchParams.delete('view')
  url.searchParams.set('departure', selection.departure)
  url.searchParams.set('arrival', selection.landing)
  url.searchParams.set('duration', String(selection.duration))
  if (selection.maxSlope !== undefined)
    url.searchParams.set('max_slope', String(selection.maxSlope ?? 'none'))
  else url.searchParams.delete('max_slope')
  if (selection.launchId) url.searchParams.set('launch_id', selection.launchId)
  else url.searchParams.delete('launch_id')
  if (selection.siteId) url.searchParams.set('site', selection.siteId)
  else url.searchParams.delete('site')
  if (view === 'mission' && planner) url.searchParams.set('planner', '1')
  else url.searchParams.delete('planner')
  return `${url.pathname}${url.search}${url.hash}`
}

export default function App() {
  const [panelRun, setPanelRun] = useState(overviewRun)
  const [view, setView] = useState<View>(currentView)
  const [override, apply] = useState<FlightOverride | null>(null)
  const [selection, setSelection] = useState(initialSelection)
  const [planner, setPlanner] = useState(
    () => new URLSearchParams(window.location.search).get('planner') === '1',
  )
  useEffect(() => {
    const pop = () => {
      setPanelRun(overviewRun())
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
  function toggleOverview(runId: string | null) {
    const url = new URL(
      locationFor('mission', selection, false),
      window.location.origin,
    )
    if (runId) {
      url.searchParams.set('run', runId)
      url.searchParams.set('overview', '1')
    } else {
      url.searchParams.delete('overview')
    }
    window.history.pushState(null, '', url)
    setPanelRun(runId)
    setPlanner(false)
  }
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
    <FlightConditions.Provider value={{ override, apply }}>
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
        ) : view === 'orbit' || view === 'flight' ? (
          <OrbitWorkspace
            initialLanding={view === 'flight'}
            siteId={selection.siteId}
            schedule={selection}
            onScheduleChange={(schedule) =>
              setSelection((current) => ({
                ...current,
                ...schedule,
                siteId:
                  current.landing === schedule.landing &&
                  current.duration === schedule.duration
                    ? current.siteId
                    : null,
              }))
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
            onOverview={toggleOverview}
            selection={selection}
            onSelect={(siteId) =>
              setSelection((current) => ({ ...current, siteId }))
            }
            planner={planner}
            onPlannerChange={setPlanner}
            onApply={(schedule) => {
              setSelection((current) => ({
                ...current,
                ...schedule,
                siteId: null,
              }))
              setPlanner(false)
            }}
            onViewOrbit={(schedule) =>
              navigate('orbit', false, {
                ...selection,
                ...schedule,
                siteId:
                  selection.landing === schedule.landing &&
                  selection.duration === schedule.duration
                    ? selection.siteId
                    : null,
              })
            }
          />
        )}
      </Suspense>
      {view === 'mission' && panelRun && (
        <Suspense fallback={null}>
          <CandidateOverview
            key={panelRun}
            runId={panelRun}
            onClose={() => toggleOverview(null)}
          />
        </Suspense>
      )}
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
    </FlightConditions.Provider>
  )
}

function MissionApp({
  onOverview,
  selection,
  onSelect,
  planner,
  onPlannerChange,
  onApply,
  onViewOrbit,
}: {
  onOverview: (runId: string) => void
  selection: MissionSelection
  onSelect: (siteId: string | null) => void
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
  const candidates = useDashboardRun(selection)
  const run = candidates.result.kind === 'ready' ? candidates.result.run : null
  const sites = useMemo(
    () =>
      run
        ? [...run.candidates]
            .sort((a, b) => a.rank - b.rank)
            .slice(0, 5)
            .map((candidate) => ({
              id: candidate.id,
              name: `후보 ${candidate.rank}`,
              latitude: candidate.lat_deg,
              longitude: candidate.lon_deg,
              grid: {
                x_m: candidate.x_m,
                y_m: candidate.y_m,
                spacing_m: candidate.grid_spacing_m,
              },
              sun:
                candidate.sun.fraction === null
                  ? null
                  : candidate.sun.fraction * 100,
              earth:
                candidate.earth.fraction === null
                  ? null
                  : candidate.earth.fraction * 100,
              longestDarkness: candidate.sun.longest_dark_hours,
              slope: candidate.terrain?.slope_p95_deg ?? null,
              score:
                candidate.score.total === null
                  ? null
                  : candidate.score.total * 100,
            }))
        : [],
    [run],
  )
  const site = sites.find((candidate) => candidate.id === selection.siteId)
  const live = useMissionAnalysis(
    site && run
      ? {
          ...missionParams(site, selection),
          observer_height_m: run.config.observer_height_m,
        }
      : null,
  )
  return (
    <MissionWorkspace
      onOverview={onOverview}
      selection={selection}
      analysis={live}
      candidates={candidates}
      sites={sites}
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
            site={site}
            selectedSiteId={selection.siteId}
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
