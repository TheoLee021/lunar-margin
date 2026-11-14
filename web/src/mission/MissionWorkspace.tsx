import { useState } from 'react'
import { MissionMetrics } from './MissionMetrics'
import type { MissionAnalysisResult } from './useMissionAnalysis'
import type { ReactNode } from 'react'
import { MissionMoonViewer } from './MissionMoonViewer'
import { DEMO_SITES } from './demoSites'
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
  const [earth, setEarth] = useState(40),
    [darkness, setDarkness] = useState(252),
    [slope, setSlope] = useState(12),
    [weight, setWeight] = useState(50)
  const score = (site: (typeof DEMO_SITES)[number]) =>
    (site.earth * weight + site.sun * (100 - weight)) / 100
  const candidates = DEMO_SITES.filter(
    (site) =>
      site.earth >= earth &&
      site.longestDarkness <= darkness &&
      site.slope <= slope,
  ).toSorted((a, b) => score(b) - score(a))
  const selected =
    DEMO_SITES.find((site) => site.id === selection.siteId) ?? DEMO_SITES[0]!
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
          선택 지점: NASA 분석 · 후보 순위: 예시
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
              <h2>조건 필터 · 예시 데이터</h2>
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
              <h2>TOP 5 후보 · 예시 순위</h2>
              <ol className="space-y-1">
                {candidates.map((site, index) => (
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
                        {score(site).toFixed(0)}
                      </span>
                    </button>
                  </li>
                ))}
              </ol>
              {candidates.length === 0 ? (
                <p className="text-xs text-neutral-400">
                  조건을 만족하는 예시 후보가 없습니다. 필터를 완화하세요.
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
          </aside>
        </>
      ) : null}
      <div className="hud-panel absolute bottom-4 right-4 max-w-64 px-3 py-2 text-xs text-neutral-400">
        {apiStatus}
      </div>
      {children}
    </main>
  )
}
