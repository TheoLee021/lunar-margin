import { useRef, useState } from 'react'
import { MissionMetrics } from './MissionMetrics'
import { MissionTimeline } from './MissionTimeline'
import { SiteComparisonPanel } from './SiteComparisonPanel'
import { nextComparisonIds } from './siteCompare'
import type { MissionAnalysisResult } from './useMissionAnalysis'
import type { ReactNode } from 'react'
import {
  MissionMoonViewer,
  type MissionMoonViewerHandle,
} from './MissionMoonViewer'
import type { CandidateSite, MissionSelection } from './types'
import type { useDashboardRun } from './useDashboardRun'

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
  const [compareState, setCompareState] = useState<{ runId: string; ids: string[] } | null>(null)
  const moon = useRef<MissionMoonViewerHandle>(null)
  const selected = sites.find((site) => site.id === selection.siteId)
  const result = candidates.result
  const run = result.kind === 'ready' ? result.run : null
  const compareIds = run?.id === compareState?.runId
    ? compareState.ids.filter((id) => run.candidates.some((c) => c.id === id))
    : []
  const comparison = compareIds.map((id) => run?.candidates.find((c) => c.id === id)).filter((c) => c !== undefined)
  function addComparison(id: string) {
    if (!run || !run.candidates.some((candidate) => candidate.id === id)) return
    const selectedInRun = run.candidates.some((c) => c.id === selection.siteId)
      ? selection.siteId
      : null
    const next = nextComparisonIds(compareIds, id, selectedInRun)
    setCompareState({ runId: run.id, ids: next })
  }
  const searchUrl = new URL(window.location.href)
  searchUrl.searchParams.set('view', 'search')
  searchUrl.searchParams.delete('planner')
  if (run) searchUrl.searchParams.set('run', run.id)
  else searchUrl.searchParams.delete('run')
  return (
    <main className="relative h-svh overflow-hidden bg-[#050607] text-[#ebe8e2]">
      <MissionMoonViewer
        ref={moon}
        selection={selection}
        sites={sites}
        onSelect={onSelect}
        onCompare={addComparison}
        compareIds={compareIds}
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
                    최장 지구 차폐 ≤{' '}
                    {run.config.thresholds.max_earth_blackout_hours ??
                      '제한 없음'}
                    {run.config.thresholds.max_earth_blackout_hours === null
                      ? ''
                      : '시간'}
                  </div>
                  <div>
                    지형 경사 한도{' '}
                    {run.config.thresholds.max_terrain_slope_degrees == null
                      ? '제한 없음'
                      : `${run.config.thresholds.max_terrain_slope_degrees}°`}
                  </div>
                  <div>관측 높이 {run.config.observer_height_m} m</div>
                  <div>
                    일조·지구 가시성 가중치 {run.config.weights.sun} :{' '}
                    {run.config.weights.earth}
                  </div>
                </div>
              </section>
            ) : null}
            <section className="hud-section">
              <h2>TOP 5 후보</h2>
              <p className="text-xs text-neutral-400">Ctrl/Shift+Click: 후보 A/B 비교 · 일반 클릭: 단일 후보 분석</p>
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
              <ol className="space-y-1">
                {sites.map((site, index) => (
                  <li key={site.id}>
                    <button
                      type="button"
                      aria-current={selection.siteId === site.id}
                      onClick={(event) => {
                        if (event.ctrlKey || event.metaKey || event.shiftKey) {
                          addComparison(site.id)
                          return
                        }
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
                      </span>
                      <span className="ml-auto font-mono">
                        {site.score == null ? '—' : site.score.toFixed(1)}
                      </span>
                    </button>
                    <button
                      type="button"
                      className="ml-8 text-xs text-cyan-300 underline underline-offset-2"
                      onClick={() => addComparison(site.id)}
                      aria-label={`비교에 추가: ${index + 1}번 지점`}
                    >
                      {compareIds.includes(site.id) ? '비교에서 제거' : '비교에 추가'}
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
              <MissionMetrics result={analysis} />
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
                  <MissionTimeline
                    key={`${analysis.data.sun.start}/${analysis.data.sun.end}/${analysis.data.sun.lat}/${analysis.data.sun.lon}`}
                    timeline={analysis.data.timeline}
                    duration={selection.duration}
                    hour={0}
                    observerHeightM={analysis.data.sun.observer_height_m}
                  />
                </section>
              ) : null}
            </aside>
          ) : null}
        </>
      ) : null}
      {run && comparison.length > 0 ? (
        <SiteComparisonPanel
          a={comparison[0]!}
          b={comparison[1] ?? null}
          config={run.config}
          onRemove={addComparison}
          onClose={() => setCompareState({ runId: run.id, ids: [] })}
        />
      ) : null}
      <div className="hud-panel absolute bottom-20 right-4 max-w-64 px-3 py-2 text-xs text-neutral-400">
        {apiStatus}
      </div>
      {children}
    </main>
  )
}
