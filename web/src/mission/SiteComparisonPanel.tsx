import type { Candidate, RunDetail } from '../api/candidates'
import {
  comparisonMetrics,
  formatComparisonDistance,
  lunarSurfaceDistanceM,
  type ComparisonMetric,
} from './siteCompare'

const CYAN = '#5dd5ce'
const AMBER = '#f2b96b'

function polarPoint(value: number, index: number, radius: number) {
  const angle = (-Math.PI / 2) + (2 * Math.PI * index) / 6
  return [160 + radius * value * Math.cos(angle), 155 + radius * value * Math.sin(angle)] as const
}

function pointsFor(values: number[]) {
  return values
    .map((value, index) => polarPoint(value / 100, index, 94).join(','))
    .join(' ')
}

function Radar({ metrics }: { metrics: ComparisonMetric[] }) {
  const a = metrics.map((metric) => metric.aScore)
  const b = metrics.map((metric) => metric.bScore)
  const aComplete = a.every((v): v is number => v !== null)
  const bComplete = b.every((v): v is number => v !== null)
  return (
    <div className="flex flex-col items-center gap-2">
      <svg
        role="img"
        aria-label="A와 B의 여섯 지표 비교 차트. 모든 축이 0~100이고 결측은 표시하지 않음"
        viewBox="0 0 320 310"
        className="w-full max-w-[320px]"
      >
        {[0.25, 0.5, 0.75, 1].map((r) => (
          <polygon
            key={r}
            points={Array.from({ length: 6 }, (_, i) => polarPoint(r, i, 94).join(',')).join(' ')}
            fill="none"
            stroke="#70808d"
            strokeOpacity={0.3}
          />
        ))}
        {Array.from({ length: 6 }, (_, i) => {
          const [x, y] = polarPoint(1, i, 94)
          return <line key={i} x1="160" y1="155" x2={x} y2={y} stroke="#70808d" strokeOpacity={0.25} />
        })}
        {aComplete ? (
          <polygon points={pointsFor(a)} fill={CYAN} fillOpacity="0.17" stroke={CYAN} strokeWidth="2" />
        ) : null}
        {bComplete ? (
          <polygon points={pointsFor(b)} fill={AMBER} fillOpacity="0.14" stroke={AMBER} strokeWidth="2" />
        ) : null}
        {metrics.map((metric, i) => {
          const [x, y] = polarPoint(1.29, i, 94)
          const av = metric.aScore, bv = metric.bScore
          const ap = av === null ? null : polarPoint(av / 100, i, 94)
          const bp = bv === null ? null : polarPoint(bv / 100, i, 94)
          return (
            <g key={metric.key}>
              {ap ? <circle cx={ap[0]} cy={ap[1]} r="3.5" fill={CYAN} /> : null}
              {bp ? <circle cx={bp[0]} cy={bp[1]} r="3.5" fill={AMBER} /> : null}
              <text x={x} y={y} textAnchor="middle" fill="#e2e8f0" fontSize="10">
                {metric.label}
              </text>
            </g>
          )
        })}
      </svg>
      {(!aComplete || !bComplete) ? (
        <p className="text-xs text-amber-300">
          일부 지표가 없어 해당 후보의 육각형을 연결하지 않았습니다. 측정 가능한 축만 점으로 표시합니다.
        </p>
      ) : null}
      <p className="text-xs text-neutral-400">
        시각화용 정규화 점수입니다. 면적은 임무 적격성이나 성공확률이 아닙니다.
      </p>
    </div>
  )
}

function formatValue(value: number | null, unit: string): string {
  return value === null ? 'N/A' : `${value.toFixed(unit === '%' ? 1 : 2)} ${unit}`
}

export function SiteComparisonPanel({
  a,
  b,
  config,
  onRemove,
  onClose,
}: {
  a: Candidate
  b: Candidate | null
  config: RunDetail['config']
  onRemove: (id: string) => void
  onClose: () => void
}) {
  const metrics = b ? comparisonMetrics(a, b, config) : null
  const distance = b
    ? lunarSurfaceDistanceM(
        { latitude: a.lat_deg, longitude: a.lon_deg },
        { latitude: b.lat_deg, longitude: b.lon_deg },
      )
    : null
  const status = (candidate: Candidate) =>
    candidate.eligibility.status === 'eligible'
      ? '적격'
      : candidate.eligibility.status === 'excluded'
        ? '제외'
        : '판정 불가'
  return (
    <section
      aria-label="후보지 A/B 비교"
      className="hud-panel absolute right-4 top-24 z-30 max-h-[calc(100dvh-180px)] w-[min(560px,calc(100vw-32px))] overflow-y-auto p-4 max-sm:top-56 max-sm:max-h-[calc(100dvh-290px)]"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-semibold">Site A/B Comparison</h2>
        <button type="button" className="hud-button" onClick={onClose} aria-label="후보지 비교 닫기">✕</button>
      </div>
      <p className="mt-1 text-xs text-neutral-400">
        동일한 저장 탐색 실행 · {config.window.start.slice(0, 10)} → {config.window.end.slice(0, 10)} UTC
        · 관측 높이 {config.observer_height_m}m
      </p>
      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
        {[
          { candidate: a, letter: 'A', color: CYAN },
          { candidate: b, letter: 'B', color: AMBER },
        ].map(({ candidate, letter, color }) => (
          <div key={letter} className="rounded-lg border border-white/15 bg-white/5 p-3">
            <p className="font-bold" style={{ color }}>{letter} · {candidate ? `후보 ${candidate.rank}` : '선택 대기'}</p>
            {candidate ? (
              <>
                <p className="mt-1 font-mono">{candidate.lat_deg.toFixed(5)}°, {candidate.lon_deg.toFixed(5)}°E</p>
                <p className="mt-1">탐색 적격성: {status(candidate)}</p>
                <button type="button" className="mt-2 underline underline-offset-2" onClick={() => onRemove(candidate.id)}>제거</button>
              </>
            ) : <p className="mt-1">다른 후보를 Ctrl/Shift+Click 또는 '비교' 버튼으로 추가</p>}
          </div>
        ))}
      </div>
      {b && distance !== null ? (
        <>
          <div className="mt-3 rounded-lg border border-white/15 p-3">
            <p className="text-xs text-neutral-400">두 후보 중심 사이 달 표면 대권거리</p>
            <p className="font-mono text-xl">{formatComparisonDistance(distance)}</p>
            <p className="mt-1 text-xs text-neutral-500">
              평균 달 반지름 1,737.4km 사용 · 로버 주행거리/지형 LOS 아님
            </p>
          </div>
          {metrics ? (
            <>
              <Radar metrics={metrics} />
              <div className="overflow-x-auto">
                <table className="w-full min-w-[380px] border-collapse text-xs" aria-label="후보지 실제 지표 비교">
                  <thead>
                    <tr className="border-b border-white/20 text-neutral-300">
                      <th className="py-2 text-left">지표</th>
                      <th className="py-2 text-right">A</th>
                      <th className="py-2 text-right">B</th>
                    </tr>
                  </thead>
                  <tbody>
                    {metrics.map((metric) => (
                      <tr key={metric.key} className="border-b border-white/10">
                        <th className="py-2 text-left font-normal text-neutral-300">
                          {metric.label}
                          <span className="block text-[10px] text-neutral-500">기준: {metric.reference}</span>
                        </th>
                        <td className="py-2 text-right font-mono">{formatValue(metric.a, metric.unit)}</td>
                        <td className="py-2 text-right font-mono">{formatValue(metric.b, metric.unit)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : null}
          <p className="mt-3 text-xs text-amber-300">
            Earth 지표는 지형에 따른 기하학적 LOS이며 RF 통신 성립을 뜻하지 않습니다.
            경사·거칠기는 LOLA DEM의 지역 추정치이고 착륙 안전성은 UNVERIFIED입니다.
          </p>
        </>
      ) : (
        <p className="mt-3 text-xs text-neutral-300">두 번째 후보 B를 추가하면 거리와 육각형 비교가 표시됩니다.</p>
      )}
    </section>
  )
}
