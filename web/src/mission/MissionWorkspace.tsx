import { useState } from 'react'
import { MissionMetrics } from './MissionMetrics'
import type { MissionAnalysisResult } from './useMissionAnalysis'
import type { ReactNode } from 'react'
import { MissionMoonViewer } from './MissionMoonViewer'
import { DEMO_SITES } from './demoSites'
import { assessCandidate } from './siteDecision'
import { useSiteAssessments } from './useSiteAssessments'
import type { MissionSelection } from './types'

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
  const [earth, setEarth] = useState(60),
    [darkness, setDarkness] = useState(48),
    [slope, setSlope] = useState(10),
    [weight, setWeight] = useState(50)
  const { results, errors, loading, retry } = useSiteAssessments(DEMO_SITES, selection)
  const constraints = {
    minEarthPercent: earth,
    maxDarkHours: darkness,
    maxSlopeDeg: slope,
  }
  const evaluated = DEMO_SITES.flatMap((site) => {
    const result = results[site.id]
    if (!result) return []
    return [{ site, data: result, verdict: assessCandidate(result, constraints, weight) }]
  })
  const candidates = evaluated
    .filter((entry) => entry.verdict.pass)
    .toSorted((a, b) => b.verdict.score - a.verdict.score)
  const selected =
    DEMO_SITES.find((site) => site.id === selection.siteId) ?? DEMO_SITES[0]!
  const selectedEvaluation = evaluated.find((entry) => entry.site.id === selected.id)
  const errorCount = Object.keys(errors).length
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
          선택 지점: NASA 분석 · 후보 순위: 계산값 기반
        </span>
      </header>
      <button
        type="button"
        className="hud-button absolute bottom-4 left-4 z-10"
        aria-pressed={collapsed}
        onClick={() => setCollapsed((value) => !value)}
      >
        {collapsed ? '패널 보이기' : '패널 숨기기'}
      </button>
      {!collapsed ? (
        <>
          <aside
            aria-label="미션 조건"
            className="hud-panel absolute bottom-16 left-4 top-24 w-72 overflow-y-auto max-sm:bottom-32 max-sm:w-60"
          >
            <section className="hud-section">
              <h2>미션 · UTC</h2>
              {summary}
            </section>
            <section className="hud-section">
              <h2>조건 필터 · NASA 분석</h2>
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
              <h2>요구조건 충족 후보 · 계산값</h2>
              <p className="mb-2 text-[10px] text-neutral-400">동일한 기간의 Sun/Earth 가시성 및 LOLA 80 m DEM 경사 기준. 수평선 기반 지구 가시성은 RF 통신 품질이 아닙니다.</p>
              {loading ? <p role="status" className="text-xs text-sky-300">NASA 후보 분석 계산 중… ({evaluated.length}/{DEMO_SITES.length})</p> : null}
              {errorCount > 0 ? (
                <div role="alert" className="my-2 text-xs text-red-300">
                  {errorCount}개 후보 분석 실패 · 해당 후보는 순위에서 제외됨.
                  <button type="button" className="ml-2 underline" onClick={retry}>재시도</button>
                </div>
              ) : null}
              <ol className="space-y-1">
                {candidates.map(({ site, data, verdict }, index) => (
                  <li key={site.id}>
                    <button
                      type="button"
                      aria-current={selection.siteId === site.id}
                      onClick={() => onSelect(site.id)}
                      className="flex w-full items-center gap-2 rounded border border-transparent p-2 text-left text-xs hover:bg-white/5 aria-[current=true]:border-white/20 aria-[current=true]:bg-white/5"
                    >
                      <span className="grid size-5 shrink-0 place-items-center rounded-full bg-neutral-100 font-mono text-neutral-950">
                        {index + 1}
                      </span>
                      <span>
                        {site.name} · {Math.abs(site.latitude).toFixed(2)}°S
                      </span>
                      <span className="ml-auto font-mono">
                        {verdict.score.toFixed(0)}
                      </span>
                    </button>
                    <span className="block text-[10px] text-neutral-400">일조 {(data.sun.visible_fraction * 100).toFixed(1)}% · 지구 {(data.earth.visible_fraction * 100).toFixed(1)}% · 경사 {data.terrain.slope_deg.toFixed(1)}°</span>
                  </li>
                ))}
              </ol>
              {!loading && errorCount === 0 && candidates.length === 0 ? (
                <p className="text-xs text-neutral-400">
                  실제 계산된 후보 중 모든 기준을 충족하는 지점이 없습니다. 조건을 완화하세요.
                </p>
              ) : null}
            </section>
          </aside>
          <aside
            aria-label="선택한 지점"
            className="hud-panel absolute right-4 top-24 w-72 p-3 max-lg:hidden"
          >
            <h2 className="mb-1 font-semibold">{selected.name}</h2>
            <p className="mb-3 font-mono text-xs text-neutral-400">
              {Math.abs(selected.latitude).toFixed(2)}°S{' '}
              {Math.abs(selected.longitude).toFixed(1)}°W
            </p>
            <MissionMetrics result={analysis} />
            {selectedEvaluation ? (
              <section className="mt-3 border-t border-white/10 pt-3 text-xs">
                <h3 className="font-semibold">Mission Constraints · {selectedEvaluation.verdict.pass ? 'PASS' : 'FAIL'}</h3>
                <p className="mt-1 text-neutral-400">LOLA DEM: 경사 {selectedEvaluation.data.terrain.slope_deg.toFixed(2)}° ({selectedEvaluation.data.terrain.slope_baseline_m.toFixed(0)} m 기준) · 거칠기 RMS {selectedEvaluation.data.terrain.roughness_rms_m.toFixed(2)} m ({selectedEvaluation.data.terrain.roughness_window_m.toFixed(0)} m 창)</p>
                <p className="mt-1 text-neutral-400">DEM 80 m 해상도: 미세 지형·착륙 위험물 판정 불가</p>
                <ul className="mt-2 space-y-1">
                  {selectedEvaluation.verdict.checks.map((check) => (
                    <li key={check.id} className={check.pass ? 'text-emerald-300' : 'text-red-300'}>{check.pass ? '✓ ' : '✗ '}{check.reason}</li>
                  ))}
                </ul>
              </section>
            ) : <p className="mt-3 text-xs text-neutral-400">후보 지형·제약 판정 결과 대기 중</p>}
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
