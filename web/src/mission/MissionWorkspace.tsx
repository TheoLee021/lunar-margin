import { useCallback, useMemo, useRef, useState } from 'react'
import { AnalysisStatus } from './AnalysisStatus'
import { AppliedConditions } from './AppliedConditions'
import { landingStart } from './liveAnalysis'
import { ReviewTimeline } from './ReviewTimeline'
import { limitAlerts, requirementMargins } from './requirementMargins'
import type { MissionAnalysisResult } from './useMissionAnalysis'
import type { ReactNode } from 'react'
import {
  MissionMoonViewer,
  type MissionMoonViewerHandle,
} from './MissionMoonViewer'
import type { CandidateSite, MissionSelection } from './types'
import type { useDashboardRun } from './useDashboardRun'
import { sunAt } from './sunPlayback'
import { useSunPath } from './useSunPath'
import type { Vector3 } from '../moon/sun'
import { SiteComparisonPanel } from './SiteComparisonPanel'
import { toggleComparison } from './siteCompare'
import { SiteMetricCards } from './SiteMetricCards'
import { useVisibleCounts } from './useVisibleCounts'

export function MissionWorkspace({
  selection,
  analysis,
  candidates,
  sites,
  onSelect,
  nav,
  summary,
  apiStatus,
  children,
}: {
  analysis: MissionAnalysisResult
  candidates: ReturnType<typeof useDashboardRun>
  sites: readonly CandidateSite[]
  selection: MissionSelection
  onSelect: (id: string | null) => void
  /** The stage links, unless a dialog that covers the page is showing them. */
  nav: ReactNode
  summary: ReactNode
  apiStatus: ReactNode
  children?: ReactNode
}) {
  const [collapsed, setCollapsed] = useState(false)
  const result = candidates.result
  const run = result.kind === 'ready' ? result.run : null
  const comparisonKey = JSON.stringify([
    run?.id,
    run?.run.generated_at,
    selection.landing,
    selection.duration,
    sites.map((site) => site.id),
  ])
  // Which candidates the comparison dialog shows: all of them (`null`) until it is narrowed down.
  // The choice belongs to one saved result and starts over with the next.
  const [checked, setChecked] = useState<{
    key: string
    ids: string[] | null
    open: boolean
  }>({ key: comparisonKey, ids: null, open: false })
  if (result.kind !== 'loading' && checked.key !== comparisonKey)
    setChecked({ key: comparisonKey, ids: null, open: false })
  const siteIds = sites.map((site) => site.id)
  const checkedIds =
    checked.key === comparisonKey && checked.ids ? checked.ids : siteIds
  const comparisonCandidates =
    run?.candidates
      .filter((candidate) => siteIds.includes(candidate.id))
      .sort((a, b) => a.rank - b.rank) ?? []
  const [override, setOverride] = useState<{
    runId?: string
    value: number
  } | null>(null)
  const demName = run?.config.dem
  const searchHeight = run?.config.observer_height_m ?? 2
  const height =
    override && override.runId === run?.id ? override.value : searchHeight
  const setHeight = (value: number) => setOverride({ runId: run?.id, value })
  const heights = [...new Set([searchHeight, 2, 10, 40])]

  const visibleCounts = useVisibleCounts(
    sites,
    height,
    searchHeight,
    (siteId) =>
      run?.candidates.find((candidate) => candidate.id === siteId)?.score
        .visible_grid_points ?? null,
    demName,
  )
  const moon = useRef<MissionMoonViewerHandle>(null)
  const selected = sites.find((site) => site.id === selection.siteId)
  const selectedCandidate = run?.candidates.find(
    (candidate) => candidate.id === selected?.id,
  )
  const alerts =
    run && selectedCandidate
      ? limitAlerts(requirementMargins(selectedCandidate, run.config))
      : []
  const sun = useSunPath(selection.landing, selection.duration)
  const sunPath = sun.kind === 'ready' ? sun.path : null
  const [photo, setPhoto] = useState(false)
  // The review time the Moon is lit from, in days after landing. It belongs to one schedule and to
  // the selected candidates: it survives going from one candidate to the next, so two can be
  // compared at the same moment, and is back at landing once none is selected, when there is no
  // timeline to show where it is.
  const schedule = `${selection.landing}/${selection.duration}`
  const [review, setReview] = useState({ schedule, days: 0 })
  if (
    review.schedule !== schedule ||
    (selection.siteId === null && review.days !== 0)
  )
    setReview({ schedule, days: 0 })
  // The review time is being dragged or played: each frame's Sun goes straight to the Moon, which
  // takes the Sun below again, with its precise shadows, once the time has come to rest.
  const [sunMoving, setSunMoving] = useState(false)
  const onPreview = useCallback((direction: Vector3) => {
    setSunMoving(true)
    moon.current?.previewSun(direction)
  }, [])
  const onReview = useCallback(
    (days: number) => {
      setSunMoving(false)
      setReview({ schedule, days })
    },
    [schedule],
  )
  const onLight = useCallback(() => setPhoto(false), [])
  // The Sun lights the Moon whether or not a candidate is selected: at landing (00:00 UTC) until a
  // review time is chosen.
  const reviewDays = review.schedule === schedule ? review.days : 0
  const sunDirection = useMemo(
    () => (sunPath ? sunAt(sunPath, reviewDays) : null),
    [sunPath, reviewDays],
  )
  const landingSun = analysis.kind === 'ready' ? analysis.data.sun : null
  const shadowedAtLanding =
    selected &&
    landingSun?.lat === selected.latitude &&
    landingSun.lon === selected.longitude &&
    Date.parse(landingSun.series.times[0] ?? '') ===
      Date.parse(landingStart(selection.landing)) &&
    landingSun.series.visible[0] === false
  return (
    <main className="relative h-svh overflow-hidden bg-[#050607] text-[#ebe8e2]">
      <MissionMoonViewer
        siteAnalysisLoading={analysis.kind === 'loading'}
        reviewDays={reviewDays}
        ref={moon}
        selection={selection}
        sites={sites}
        onSelect={onSelect}
        demName={demName}
        heights={heights}
        height={height}
        setHeight={setHeight}
        visibleCounts={visibleCounts}
        sun={sun}
        sunDirection={sunDirection}
        sunMoving={sunMoving}
        photo={photo}
        onPhotoChange={setPhoto}
      />
      <header className="pointer-events-none absolute left-4 top-4 flex max-w-[60%] flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold uppercase tracking-wide">
          Lunar Margin
        </h1>
        <span className="border border-amber-400/60 bg-black/50 px-2 py-0.5 font-mono text-[10px] text-amber-300">
          Saved precise search result for the selected schedule
        </span>
      </header>
      <button
        type="button"
        className="hud-button absolute bottom-10 left-4 z-10"
        aria-pressed={collapsed}
        onClick={() => setCollapsed((value) => !value)}
      >
        {collapsed ? 'Show panels' : 'Hide panels'}
      </button>
      {!collapsed ? (
        <>
          <aside
            aria-label="Mission conditions"
            className="hud-panel absolute bottom-20 left-4 top-24 w-72 overflow-y-auto max-xl:bottom-32 max-sm:w-60"
          >
            <section className="hud-section">
              <h2>Mission · UTC</h2>
              {summary}
              {run ? <AppliedConditions config={run.config} /> : null}
            </section>
            <section className="hud-section">
              <div className="flex items-center justify-between gap-2">
                <h2>TOP 5 candidates</h2>
                <button
                  type="button"
                  className="hud-button px-2 py-0.5"
                  aria-label="Refresh results"
                  title="Refresh results"
                  onClick={candidates.reload}
                >
                  ↻
                </button>
              </div>
              {run ? (
                <p className="text-xs text-neutral-400">
                  Top {sites.length} of {run.candidates.length} selected · by
                  search score
                </p>
              ) : null}
              {result.kind === 'loading' ? (
                <p role="status" className="text-xs text-neutral-400">
                  Loading the saved search result…
                </p>
              ) : null}
              {result.kind === 'error' ? (
                <p role="alert" className="text-xs text-red-300">
                  {result.message}
                </p>
              ) : null}
              {result.kind === 'empty' ? (
                <p className="text-xs text-neutral-400">
                  No saved search result for this date and mission duration.
                </p>
              ) : null}
              {run && sites.length === 0 ? (
                <p className="text-xs text-neutral-400">
                  This search selected no candidates. Check the exclusion
                  reasons in the search view.
                </p>
              ) : null}
              <ol className="space-y-1">
                {sites.map((site, index) => (
                  <li key={site.id}>
                    <button
                      type="button"
                      aria-current={selection.siteId === site.id}
                      onClick={() => {
                        onSelect(site.id)
                        moon.current?.focusSite(site.id)
                      }}
                      className="flex w-full items-center gap-2 rounded border border-transparent px-2 py-1.5 text-left text-xs hover:bg-white/5 aria-[current=true]:border-white/20 aria-[current=true]:bg-white/5"
                    >
                      <span className="grid size-5 shrink-0 place-items-center rounded-full bg-neutral-100 font-mono text-neutral-950">
                        {index + 1}
                      </span>
                      <span>
                        {site.name} · {Math.abs(site.latitude).toFixed(2)}°S
                      </span>
                      <span className="ml-auto font-mono">
                        {site.score == null ? '—' : site.score.toFixed(1)}
                      </span>
                    </button>
                  </li>
                ))}
              </ol>
              <button
                type="button"
                className="hud-button justify-self-start disabled:cursor-default disabled:opacity-40"
                aria-haspopup="dialog"
                disabled={sites.length === 0}
                onClick={() =>
                  setChecked((current) => ({ ...current, open: true }))
                }
              >
                Compare candidates
              </button>
            </section>
          </aside>
          {selected ? (
            <aside
              aria-label="Selected site"
              className="hud-panel absolute right-4 top-24 z-20 max-h-[calc(100dvh-176px)] w-[420px] max-w-[calc(100vw-32px)] overflow-y-auto p-3 max-xl:max-h-[calc(100dvh-224px)] max-sm:top-80 max-sm:max-h-[calc(100dvh-448px)]"
            >
              <div className="mb-1 flex items-center justify-between gap-3">
                <h2 className="font-semibold">{selected.name}</h2>
                <button
                  type="button"
                  className="hud-button"
                  aria-label="Deselect candidate"
                  onClick={() => onSelect(null)}
                >
                  ✕
                </button>
              </div>
              <p className="mb-3 font-mono text-xs text-neutral-400">
                {Math.abs(selected.latitude).toFixed(4)}°
                {selected.latitude < 0 ? 'S' : 'N'}{' '}
                {Math.abs(selected.longitude).toFixed(4)}°
                {selected.longitude < 0 ? 'W' : 'E'}
              </p>
              {shadowedAtLanding && (
                <p
                  role="alert"
                  className="mb-3 rounded border border-amber-400/60 bg-amber-950/40 p-3 text-xs text-amber-200"
                >
                  <strong>Landing sunlight warning</strong> · At{' '}
                  {selection.landing} 00:00 UTC the Sun’s centre is hidden by
                  terrain at this site.
                </p>
              )}
              {alerts.map((alert) => (
                <p
                  key={alert}
                  role="alert"
                  className="mb-3 rounded border border-red-400/60 bg-red-950/40 p-3 text-xs text-red-200"
                >
                  <strong>Outside search limit</strong> · {alert}
                </p>
              ))}
              {run && selectedCandidate ? (
                <SiteMetricCards
                  candidate={selectedCandidate}
                  config={run.config}
                />
              ) : null}
              <section
                className="mission-timeline-panel mt-4 border-t border-white/10 pt-4"
                aria-label="Mission timeline"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-xs font-semibold text-neutral-300">
                    Mission timeline
                  </h3>
                  <span className="text-[10px] text-neutral-400">
                    For the selected candidate · computed live
                  </span>
                </div>
                {analysis.kind !== 'ready' ? (
                  <AnalysisStatus result={analysis} />
                ) : analysis.data.timeline.t.length === 0 ? (
                  <p role="status" className="text-xs text-neutral-400">
                    No analysis samples in the selected period.
                  </p>
                ) : (
                  <ReviewTimeline
                    key={`${analysis.data.sun.start}/${analysis.data.sun.end}/${analysis.data.sun.lat}/${analysis.data.sun.lon}`}
                    timeline={analysis.data.timeline}
                    duration={selection.duration}
                    observerHeightM={analysis.data.sun.observer_height_m}
                    sun={sun}
                    photo={photo}
                    reviewDays={reviewDays}
                    onReview={onReview}
                    onPreview={onPreview}
                    onLight={onLight}
                  />
                )}
              </section>
            </aside>
          ) : null}
        </>
      ) : null}
      <div className="hud-panel absolute bottom-20 right-4 max-w-64 px-3 py-2 text-xs text-neutral-400 max-xl:bottom-32">
        {apiStatus}
      </div>
      {/* The 3D controls sit in the bottom toolbar, so the top right is free for the stage links. */}
      {nav ? <div className="absolute top-4 right-4 z-20">{nav}</div> : null}
      {children}
      {run && checked.key === comparisonKey && checked.open ? (
        <SiteComparisonPanel
          candidates={comparisonCandidates}
          checkedIds={checkedIds}
          selectedId={selection.siteId}
          config={run.config}
          onToggle={(id) =>
            setChecked((current) => ({
              ...current,
              ids: toggleComparison(checkedIds, id, siteIds),
            }))
          }
          onSelect={(id) => {
            setChecked((current) => ({ ...current, open: false }))
            onSelect(id)
            moon.current?.focusSite(id)
          }}
          onClose={() => setChecked((current) => ({ ...current, open: false }))}
          onClear={() => setChecked((current) => ({ ...current, ids: [] }))}
        />
      ) : null}
    </main>
  )
}
