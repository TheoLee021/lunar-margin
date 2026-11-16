import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  fetchViewshed,
  GRID_TARGET_COUNT,
  visibleGridCount,
} from '../api/viewshed'
import { landingStart } from './liveAnalysis'
import { MissionMetrics } from './MissionMetrics'
import { ReviewTimeline } from './ReviewTimeline'
import { RequirementMarginPanel } from './RequirementMarginPanel'
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

export function MissionWorkspace({
  selection,
  analysis,
  candidates,
  sites,
  onSelect,
  summary,
  apiStatus,
  children,
}: {
  analysis: MissionAnalysisResult
  candidates: ReturnType<typeof useDashboardRun>
  sites: readonly CandidateSite[]
  selection: MissionSelection
  onSelect: (id: string | null) => void
  summary: ReactNode
  apiStatus: ReactNode
  children?: ReactNode
}) {
  const [collapsed, setCollapsed] = useState(false)
  const result = candidates.result
  const run = result.kind === 'ready' ? result.run : null
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

  const [sortByVisibility, setSortByVisibility] = useState(false)
  const [comparison, setComparison] = useState<{
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
      if (!controller.signal.aborted) setComparison({ sites, height, counts })
    })
    return () => controller.abort()
  }, [sites, height, demName, searchHeight])
  const counts =
    comparison?.sites === sites && comparison.height === height
      ? comparison.counts
      : undefined
  const rows = sites.map((site, index) => ({
    site,
    index,
    count:
      height === searchHeight
        ? (run?.candidates.find((candidate) => candidate.id === site.id)?.score
            .visible_grid_points ?? null)
        : counts?.[index],
  }))
  if (sortByVisibility)
    rows.sort(
      (a, b) =>
        (typeof b.count === 'number' ? b.count : -1) -
        (typeof a.count === 'number' ? a.count : -1),
    )
  const moon = useRef<MissionMoonViewerHandle>(null)
  const selected = sites.find((site) => site.id === selection.siteId)
  const selectedCandidate = run?.candidates.find(
    (candidate) => candidate.id === selected?.id,
  )
  const searchUrl = new URL(window.location.href)
  searchUrl.searchParams.set('view', 'search')
  searchUrl.searchParams.delete('planner')
  if (run) searchUrl.searchParams.set('run', run.id)
  else searchUrl.searchParams.delete('run')
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
          선택 일정의 저장된 정밀 탐색 결과
        </span>
      </header>
      <button
        type="button"
        className="hud-button absolute bottom-10 left-4 z-10"
        aria-pressed={collapsed}
        onClick={() => setCollapsed((value) => !value)}
      >
        {collapsed ? '패널 보이기' : '패널 숨기기'}
      </button>
      {!collapsed ? (
        <>
          <aside
            aria-label="미션 조건"
            className="hud-panel absolute bottom-20 left-4 top-24 w-72 overflow-y-auto max-sm:bottom-32 max-sm:w-60"
          >
            <section className="hud-section">
              <h2>미션 · UTC</h2>
              {summary}
            </section>
            {run ? (
              <section className="hud-section">
                <h2>적용된 탐색 조건</h2>
                <div className="grid gap-2 text-xs text-neutral-300">
                  <div>
                    최장 연속 어둠 ≤{' '}
                    {run.config.thresholds.max_sun_dark_hours ?? '제한 없음'}
                    {run.config.thresholds.max_sun_dark_hours === null
                      ? ''
                      : '시간'}
                  </div>
                  <div>
                    {run.config.rf ? 'RF 최장 두절' : '최장 지구 차폐'} ≤{' '}
                    {(run.config.rf
                      ? run.config.thresholds.max_rf_blackout_hours
                      : run.config.thresholds.max_earth_blackout_hours) ??
                      '제한 없음'}
                    {(run.config.rf
                      ? run.config.thresholds.max_rf_blackout_hours
                      : run.config.thresholds.max_earth_blackout_hours) == null
                      ? ''
                      : '시간'}
                  </div>
                  <div>
                    지형 경사 한도{' '}
                    {run.config.thresholds.max_terrain_slope_degrees == null
                      ? '제한 없음'
                      : `${run.config.thresholds.max_terrain_slope_degrees}°`}
                  </div>
                  {run.config.rf ? (
                    <div>
                      최소 RF 통신 가능 비율{' '}
                      {run.config.thresholds.min_rf_fraction == null
                        ? '제한 없음'
                        : `${run.config.thresholds.min_rf_fraction * 100}%`}
                    </div>
                  ) : null}
                  <div>관측 높이 {run.config.observer_height_m} m</div>
                  <div>
                    일조·{run.config.rf ? 'RF 통신' : '지구 가시성'} 가중치{' '}
                    {run.config.weights.sun} : {run.config.weights.earth}
                    {run.config.weights.visibility
                      ? ` · 주변 가시권 가중치 ${run.config.weights.visibility}`
                      : null}
                  </div>
                </div>
              </section>
            ) : null}
            <section className="hud-section">
              <h2>TOP 5 후보</h2>
              <p className="text-xs text-neutral-400">
                멀리서는 가까운 후보를 묶어 표시합니다. 묶음을 누르면 확대되고,
                가까이서는 500m × 500m 격자가 보입니다.
              </p>
              <p className="text-xs text-neutral-400">
                {selection.landing} · {selection.duration}일
                {run
                  ? ` · 선정 ${run.candidates.length}개 중 상위 ${sites.length}개`
                  : ''}
              </p>
              {result.kind === 'loading' ? (
                <p role="status" className="text-xs text-neutral-400">
                  저장된 탐색 결과를 불러오는 중…
                </p>
              ) : null}
              {result.kind === 'error' ? (
                <p role="alert" className="text-xs text-red-300">
                  {result.message}
                </p>
              ) : null}
              {result.kind === 'empty' ? (
                <p className="text-xs text-neutral-400">
                  이 날짜와 임무 기간의 저장된 탐색 결과가 없습니다.
                </p>
              ) : null}
              {run && sites.length === 0 ? (
                <p className="text-xs text-neutral-400">
                  이 탐색에서 선정된 후보가 없습니다. 탐색 화면에서 제외 이유를
                  확인하세요.
                </p>
              ) : null}
              {sites.length > 0 && (
                <div className="grid gap-1 text-xs">
                  {run && (
                    <p className="text-neutral-300">
                      {run.config.weights.visibility
                        ? `탐색 점수 · 가시권 가중치 ${Math.round(run.config.weights.visibility * 100)}% (탐색 높이 ${run.config.observer_height_m} m)`
                        : '탐색 점수 · 가시권 미반영 (0%)'}
                    </p>
                  )}
                  <label>
                    후보 정렬{' '}
                    <select
                      className="bg-neutral-800"
                      value={sortByVisibility ? 'visible' : 'score'}
                      onChange={(event) =>
                        setSortByVisibility(event.target.value === 'visible')
                      }
                    >
                      <option value="score">탐색 점수순</option>
                      <option value="visible">보이는 격자점 많은 순</option>
                    </select>
                  </label>
                  <label>
                    가시권 비교 높이{' '}
                    <select
                      className="bg-neutral-800"
                      value={height}
                      onChange={(event) =>
                        setHeight(Number(event.target.value))
                      }
                    >
                      {heights.map((h) => (
                        <option key={h} value={h}>
                          {h} m{h === searchHeight ? ' (탐색 높이)' : ''}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              )}
              <ol className="space-y-1">
                {rows.map(({ site, index, count }) => (
                  <li key={site.id}>
                    <button
                      type="button"
                      aria-current={selection.siteId === site.id}
                      onClick={() => {
                        onSelect(site.id)
                        moon.current?.focusSite(site.id)
                      }}
                      className="flex w-full items-center gap-2 rounded border border-transparent p-2 text-left text-xs hover:bg-white/5 aria-[current=true]:border-white/20 aria-[current=true]:bg-white/5"
                    >
                      <span className="grid size-5 shrink-0 place-items-center rounded-full bg-neutral-100 font-mono text-neutral-950">
                        {index + 1}
                      </span>
                      <span>
                        {site.name} · {Math.abs(site.latitude).toFixed(2)}°S
                        <span className="block text-teal-300">
                          {typeof count === 'number'
                            ? `${height} m에서 보이는 점 ${count} / ${GRID_TARGET_COUNT}`
                            : count === null
                              ? '지형 자료 부족'
                              : count === 'error'
                                ? '가시권 계산 불가'
                                : '가시권 계산 중…'}
                        </span>
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
                className="hud-button justify-self-start"
                onClick={candidates.reload}
              >
                결과 새로고침
              </button>
              <a
                className="hud-button"
                href={`${searchUrl.pathname}${searchUrl.search}`}
              >
                {run ? '이 결과의 후보지 탐색 보기' : '후보지 탐색하기'}
              </a>
            </section>
          </aside>
          {selected ? (
            <aside
              aria-label="선택한 지점"
              className="hud-panel absolute right-4 top-24 z-20 max-h-[calc(100dvh-176px)] w-[420px] max-w-[calc(100vw-32px)] overflow-y-auto p-3 max-sm:top-80 max-sm:max-h-[calc(100dvh-400px)]"
            >
              <div className="mb-1 flex items-center justify-between gap-3">
                <h2 className="font-semibold">{selected.name}</h2>
                <button
                  type="button"
                  className="hud-button"
                  aria-label="후보 선택 해제"
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
                  <strong>착륙 일조 경고</strong> · {selection.landing} 00:00
                  UTC에 이 지점에서는 태양 중심이 지형에 가려집니다.
                </p>
              )}
              <MissionMetrics result={analysis} />
              {run && selectedCandidate ? (
                <RequirementMarginPanel
                  candidate={selectedCandidate}
                  config={run.config}
                />
              ) : null}
              {selectedCandidate?.rf ? (
                <section
                  aria-label="저장된 RF 통신 평가"
                  className="mt-3 border-t border-white/10 pt-3 text-xs text-sky-300"
                >
                  <h3 className="font-semibold">
                    명목 RF 통신 · 저장된 탐색 결과
                  </h3>
                  <p>
                    통신 가능 비율{' '}
                    {selectedCandidate.rf.fraction == null
                      ? '—'
                      : `${(selectedCandidate.rf.fraction * 100).toFixed(1)}%`}{' '}
                    · 최장 두절{' '}
                    {selectedCandidate.rf.longest_blackout_hours?.toFixed(1) ??
                      '—'}
                    시간
                  </p>
                  <p className="mt-1 text-[10px] text-neutral-400">
                    LOS 차폐 시 통신 불가. 가능 비율과 최장 두절을 순위 점수에
                    함께 반영합니다. 실제 지상국·일정·대기·멀티패스는 반영하지
                    않습니다.
                  </p>
                </section>
              ) : null}
              {analysis.kind === 'ready' ? (
                <section
                  className="mission-timeline-panel mt-4 border-t border-white/10 pt-4"
                  aria-label="미션 기간 타임라인"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-xs font-semibold text-neutral-300">
                      미션 기간 타임라인
                    </h3>
                    <span className="text-[10px] text-neutral-400">
                      선택한 후보 기준
                    </span>
                  </div>
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
                </section>
              ) : null}
            </aside>
          ) : null}
        </>
      ) : null}
      <div className="hud-panel absolute bottom-20 right-4 max-w-64 px-3 py-2 text-xs text-neutral-400">
        {apiStatus}
      </div>
      {children}
    </main>
  )
}
