import { useEffect, useRef, useState } from 'react'
import { fetchLandingGrid, type LandingGrid } from '../api/landingGrid'

type GridState =
  | { kind: 'idle' }
  | { kind: 'loading'; key: string }
  | { kind: 'error'; key: string; message: string }
  | { kind: 'ready'; key: string; data: LandingGrid }

export function LandingGridPanel({
  lat,
  lon,
  disabled,
}: {
  lat: number
  lon: number
  disabled: boolean
}) {
  const [maxSlope, setMaxSlope] = useState(10)
  const [state, setState] = useState<GridState>({ kind: 'idle' })
  const controller = useRef<AbortController | null>(null)
  const key = JSON.stringify([lat, lon, maxSlope])
  const current =
    state.kind !== 'idle' && state.key === key
      ? state
      : { kind: 'idle' as const }

  useEffect(() => () => controller.current?.abort(), [lat, lon])

  async function load() {
    controller.current?.abort()
    const next = new AbortController()
    controller.current = next
    setState({ kind: 'loading', key })
    try {
      const data = await fetchLandingGrid(lat, lon, maxSlope, {
        signal: next.signal,
      })
      if (!next.signal.aborted) setState({ kind: 'ready', key, data })
    } catch (error) {
      if (!next.signal.aborted)
        setState({
          kind: 'error',
          key,
          message: error instanceof Error ? error.message : '격자 요청 실패',
        })
    }
  }

  return (
    <section
      className="flex flex-col gap-3 border-t border-white/10 pt-4"
      aria-label="국소 착륙 목표 격자"
    >
      <h4 className="text-sm font-semibold">국소 격자 · DEM 규모 지형 평가</h4>
      <p className="text-xs text-neutral-400">
        후보 중심 250m 반경을 80m LOLA 표본으로 확인하고, 50m 목표 원을 상대
        비교합니다. 실제 착륙 안전성은 인증하지 않습니다.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-neutral-300">
          경사 한도 (°)
          <input
            type="number"
            min={0}
            max={90}
            value={maxSlope}
            onChange={(event) => setMaxSlope(Number(event.target.value))}
            className="w-24 rounded border border-white/20 bg-black/30 px-2 py-1.5"
          />
        </label>
        <button
          type="button"
          onClick={() => void load()}
          disabled={
            disabled ||
            maxSlope < 0 ||
            maxSlope > 90 ||
            current.kind === 'loading'
          }
          className="rounded-md border border-sky-400/50 px-3 py-1.5 text-xs text-sky-200 hover:border-sky-300 disabled:opacity-50"
        >
          {current.kind === 'loading' ? '격자 계산 중…' : '250m 지형 격자 계산'}
        </button>
      </div>
      {current.kind === 'error' ? (
        <p role="alert" className="text-xs text-red-300">
          {current.message}
        </p>
      ) : null}
      {current.kind === 'ready' ? <GridResult result={current.data} /> : null}
    </section>
  )
}

function GridResult({ result }: { result: LandingGrid }) {
  const target = result.best_target
  const scale = result.sample_step_m
  return (
    <div className="grid items-start gap-3 lg:grid-cols-[minmax(0,320px)_1fr]">
      <svg
        viewBox="-300 -300 600 600"
        className="w-full max-w-80 rounded-lg border border-white/10 bg-[#121923]"
        role="img"
        aria-label="250m 평가 원과 DEM 표본 격자 및 통과한 50m 목표 원"
      >
        <circle
          r={result.assessment_radius_m}
          fill="#4f7199"
          fillOpacity="0.12"
          stroke="#86c5eb"
          strokeWidth="2"
        />
        {result.cells.map((cell) => (
          <rect
            key={cell.dx_m + ':' + cell.dy_m}
            x={cell.dx_m - scale / 2}
            y={-cell.dy_m - scale / 2}
            width={scale}
            height={scale}
            fill={
              !cell.valid
                ? '#995353'
                : (cell.slope_deg ?? 91) > result.max_slope_deg
                  ? '#b88a44'
                  : '#569d85'
            }
            fillOpacity={cell.in_assessment_circle ? '0.7' : '0.22'}
            stroke="#e9edf4"
            strokeWidth="1"
            strokeOpacity=".22"
          />
        ))}
        <circle r="4" fill="white" />
        {target ? (
          <circle
            cx={target.dx_m}
            cy={-target.dy_m}
            r={result.target_radius_m}
            fill="none"
            stroke="#d0f6ea"
            strokeWidth="4"
          />
        ) : null}
      </svg>
      <div className="flex flex-col gap-2 text-xs text-neutral-300">
        <p>
          목표 중심점 {result.total_target_centers}개 평가 · 조건 통과{' '}
          {result.passing_target_centers}개
        </p>
        {target ? (
          <>
            <p className="text-emerald-300">
              최상위 DEM 선별 목표 · 중심에서 동쪽 {target.dx_m.toFixed(0)}m,
              북쪽 {target.dy_m.toFixed(0)}m
            </p>
            <p>
              최대 국소 경사 {target.slope_max_deg?.toFixed(2) ?? 'N/A'}° · P95
              경사 {target.slope_p95_deg?.toFixed(2) ?? 'N/A'}° · 표본 완전성{' '}
              {(target.coverage_fraction * 100).toFixed(0)}%
            </p>
            <p className="font-mono">
              {target.lat_deg.toFixed(6)}° / {target.lon_deg.toFixed(6)}°E
            </p>
          </>
        ) : (
          <p className="text-amber-300">
            해당 기준을 충족하는 목표 원이 없습니다. 유효 DEM 부족 또는 지형
            제약 초과입니다.
          </p>
        )}
        <p className="text-amber-300">
          착륙 안전성 {result.landing_safety_status}: 50m 목표 원은 DEM
          해상도보다 작아 실제 장애물·착륙 분산·지지력을 판정할 수 없습니다.
        </p>
        <p className="text-neutral-500">
          범례: 녹색=경사 기준 충족 DEM 표본, 황색=초과, 적색=결측. 표본별 경사
          기준은 착륙 안전성 보증이 아닙니다.
        </p>
      </div>
    </div>
  )
}
