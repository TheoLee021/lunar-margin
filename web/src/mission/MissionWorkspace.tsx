import { useState } from 'react'
import { MissionMetrics } from './MissionMetrics'
import { MissionTimeline } from './MissionTimeline'
import type { MissionAnalysisResult } from './useMissionAnalysis'
import type { ReactNode } from 'react'
import { MissionMoonViewer } from './MissionMoonViewer'
import { DEMO_SITES } from './demoSites'
import { judgeSite, type SiteVerdict } from './siteDecision'
import type { CandidateSite, MissionSelection } from './types'
import {
  useSiteAssessments,
  type SiteAssessmentState,
} from './useSiteAssessments'

type SiteRow = {
  site: CandidateSite
  state: SiteAssessmentState
  verdict: SiteVerdict | null
}

/** 판정된 후보가 먼저, 그중 PASS가 먼저, 다음은 점수 순. 계산 중·실패 후보는 원래 순서로 뒤에. */
function compareRows(a: SiteRow, b: SiteRow): number {
  if (!a.verdict || !b.verdict)
    return Number(Boolean(b.verdict)) - Number(Boolean(a.verdict))
  return (
    Number(b.verdict.pass) - Number(a.verdict.pass) ||
    b.verdict.score - a.verdict.score
  )
}

export function MissionWorkspace({
  selection,
  analysis,
  onSelect,
  summary,
  apiStatus,
  children,
}: {
  analysis: MissionAnalysisResult
  selection: MissionSelection
  onSelect: (id: string) => void
  summary: ReactNode
  apiStatus: ReactNode
  children?: ReactNode
}) {
  const [collapsed, setCollapsed] = useState(false)
  const [earth, setEarth] = useState(40),
    [darkness, setDarkness] = useState(252),
    [slope, setSlope] = useState(12),
    [weight, setWeight] = useState(50)
  const { stateOf, retry } = useSiteAssessments(DEMO_SITES, selection)
  const limits = {
    minEarthPercent: earth,
    maxDarkHours: darkness,
    maxSlopeDeg: slope,
  }
  const rows: SiteRow[] = DEMO_SITES.map((site) => {
    const state = stateOf(site.id)
    return {
      site,
      state,
      verdict:
        state.kind === 'ready' ? judgeSite(state.data, limits, weight) : null,
    }
  })
  const ranked = rows.toSorted(compareRows)
  const judged = rows.filter((row) => row.verdict).length
  const failedCount = rows.filter((row) => row.state.kind === 'error').length
  const selected =
    DEMO_SITES.find((site) => site.id === selection.siteId) ?? DEMO_SITES[0]!
  const selectedRow = rows.find((row) => row.site.id === selected.id)
  return (
    <main className="relative h-svh overflow-hidden bg-[#050607] text-[#ebe8e2]">
      <MissionMoonViewer
        selection={selection}
        sites={DEMO_SITES}
        onSelect={onSelect}
      />
      <header className="pointer-events-none absolute left-4 top-4 flex max-w-[60%] flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold uppercase tracking-wide">
          Lunar Margin
        </h1>
        <span className="border border-amber-400/60 bg-black/50 px-2 py-0.5 font-mono text-[10px] text-amber-300">
          선택 지점 · 후보 판정: NASA 분석
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
            <section className="hud-section">
              <h2>조건 필터</h2>
              {(
                [
                  ['지구 가시 시간 ≥', earth, setEarth, 0, 100, 5, '%'],
                  [
                    '최장 연속 어둠 ≤',
                    darkness,
                    setDarkness,
                    0,
                    336,
                    12,
                    '시간',
                  ],
                  ['경사 ≤', slope, setSlope, 0, 20, 1, '°'],
                ] as const
              ).map(([label, value, setValue, min, max, step, unit]) => (
                <label
                  key={label}
                  className="grid gap-2 text-xs text-neutral-300"
                >
                  <span className="flex justify-between">
                    {label}
                    <span className="font-mono">
                      {value}
                      {unit}
                    </span>
                  </span>
                  <input
                    type="range"
                    min={min}
                    max={max}
                    step={step}
                    value={value}
                    className="w-full accent-sky-400"
                    onChange={(event) => setValue(Number(event.target.value))}
                  />
                </label>
              ))}
            </section>
            <section className="hud-section">
              <h2>순위 가중치</h2>
              <input
                type="range"
                aria-label="통신 대 태양광 가중치"
                min={0}
                max={100}
                step={5}
                value={weight}
                className="w-full accent-neutral-100"
                onChange={(event) => setWeight(Number(event.target.value))}
              />
              <div className="flex justify-between text-xs">
                <span className="text-sky-400">통신 {weight}%</span>
                <span className="text-amber-400">태양광 {100 - weight}%</span>
              </div>
            </section>
            <section className="hud-section">
              <h2>후보 판정 · NASA 분석</h2>
              {judged + failedCount < DEMO_SITES.length ? (
                <p role="status" className="mb-1 text-xs text-sky-300">
                  후보 분석 중… ({judged}/{DEMO_SITES.length})
                </p>
              ) : null}
              {failedCount > 0 ? (
                <p role="alert" className="mb-1 text-xs text-red-300">
                  {failedCount}곳 분석 실패
                  <button
                    type="button"
                    className="ml-2 underline"
                    onClick={retry}
                  >
                    재시도
                  </button>
                </p>
              ) : null}
              <ol className="space-y-1">
                {ranked.map(({ site, state, verdict }, index) => (
                  <li key={site.id}>
                    <button
                      type="button"
                      aria-current={selection.siteId === site.id}
                      onClick={() => onSelect(site.id)}
                      className="flex w-full items-center gap-2 rounded border border-transparent p-2 text-left text-xs hover:bg-white/5 aria-[current=true]:border-white/20 aria-[current=true]:bg-white/5"
                    >
                      <span className="grid size-5 shrink-0 place-items-center rounded-full bg-neutral-100 font-mono text-neutral-950">
                        {verdict ? index + 1 : '–'}
                      </span>
                      <span>
                        {site.name} · {Math.abs(site.latitude).toFixed(2)}°S
                      </span>
                      <span
                        className={`ml-auto font-mono ${
                          verdict
                            ? verdict.pass
                              ? 'text-emerald-300'
                              : 'text-red-300'
                            : 'text-neutral-400'
                        }`}
                      >
                        {verdict
                          ? `${verdict.pass ? 'PASS' : 'FAIL'} · ${verdict.score.toFixed(0)}`
                          : state.kind === 'error'
                            ? '분석 실패'
                            : '계산 중'}
                      </span>
                    </button>
                    {verdict && !verdict.pass ? (
                      <p className="px-2 pb-1 text-[10px] text-red-300">
                        {verdict.checks
                          .filter((check) => !check.pass)
                          .map((check) => check.label)
                          .join(' · ')}{' '}
                        미충족
                      </p>
                    ) : null}
                  </li>
                ))}
              </ol>
              {judged === DEMO_SITES.length &&
              rows.every((row) => !row.verdict?.pass) ? (
                <p className="text-xs text-neutral-400">
                  모든 조건을 만족하는 후보가 없습니다. FAIL 이유를 확인하거나
                  조건을 완화하세요.
                </p>
              ) : null}
            </section>
          </aside>
          <aside
            aria-label="선택한 지점"
            className="hud-panel absolute right-4 top-24 max-h-[calc(100dvh-176px)] w-[420px] overflow-y-auto p-3 max-lg:hidden"
          >
            <h2 className="mb-1 font-semibold">{selected.name}</h2>
            <p className="mb-3 font-mono text-xs text-neutral-400">
              {Math.abs(selected.latitude).toFixed(2)}°S{' '}
              {Math.abs(selected.longitude).toFixed(1)}°W
            </p>
            <MissionMetrics result={analysis} />
            <section
              aria-label="미션 조건 판정"
              className="mt-4 border-t border-white/10 pt-4 text-xs"
            >
              <h3 className="mb-2 font-semibold text-neutral-300">
                미션 조건 판정
                {selectedRow?.verdict
                  ? ` · ${selectedRow.verdict.pass ? 'PASS' : 'FAIL'}`
                  : ''}
              </h3>
              {selectedRow?.verdict && selectedRow.state.kind === 'ready' ? (
                <>
                  <ul className="space-y-1">
                    {selectedRow.verdict.checks.map((check) => (
                      <li
                        key={check.id}
                        className={
                          check.pass ? 'text-emerald-300' : 'text-red-300'
                        }
                      >
                        {check.pass ? '✓' : '✗'} {check.reason}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2 text-[10px] text-neutral-400">
                    경사는 {selectedRow.state.data.terrain.dem_pixel_m} m DEM
                    규모의 선별입니다. 착륙 안전성은 검증하지 않았습니다
                    (UNVERIFIED).
                  </p>
                </>
              ) : (
                <p className="text-neutral-400">
                  {selectedRow?.state.kind === 'error'
                    ? '이 후보의 판정을 불러오지 못했습니다. 왼쪽 목록에서 재시도하세요.'
                    : '조건 판정 계산 중…'}
                </p>
              )}
            </section>
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
                />
              </section>
            ) : null}
          </aside>
        </>
      ) : null}
      <div className="hud-panel absolute bottom-20 right-4 max-w-64 px-3 py-2 text-xs text-neutral-400">
        {apiStatus}
      </div>
      {children}
    </main>
  )
}
