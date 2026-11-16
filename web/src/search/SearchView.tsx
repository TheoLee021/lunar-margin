import { useCallback, useEffect, useMemo, useState } from 'react'
import type { LayerName, RunDetail, RunSummary } from '../api/candidates'
import { formatUtc } from '../analysis/derive'
import { CandidateDetail, type Selection } from './CandidateDetail'
import { CandidateTable } from './CandidateTable'
import {
  STEPS,
  isInsideRoi,
  layerStatesFor,
  nextStepIndex,
  stepLayers,
  xyToLonLat,
  type LayerState,
  type LayerStates,
  type Metric,
} from './derive'
import { FunnelPanel } from './FunnelPanel'
import { LayerControls, MapLegend } from './MapControls'
import { ProcessMap } from './ProcessMap'
import { RunInfo } from './RunInfo'
import { MissionForm } from './MissionForm'
import { DEFAULT_MISSION_VALUES, missionSummaryItems } from './mission'
import type { Schedule } from '../mission/types'
import { StepNav } from './StepNav'
import { StepPanel } from './StepPanel'
import { useRun, useRuns } from './useRuns'
import { useAvailability } from './useAvailability'
import { ReservationPanel } from './ReservationPanel'
import { useCandidatePrices } from './useCandidatePrices'

const AUTO_PLAY_MS = 3800
const CLI_COMMAND =
  'cd api && uv run python -m lunar_margin.pipeline.candidates --out data/candidates/default'

function Spinner({ text }: { text: string }) {
  return (
    <div
      role="status"
      className="flex items-center justify-center gap-3 rounded-xl border border-white/10 px-6 py-16 text-sm text-neutral-300"
    >
      <span className="size-4 animate-spin rounded-full border-2 border-white/20 border-t-neutral-100" />
      {text}
    </div>
  )
}

function ErrorBox({
  title,
  message,
  onRetry,
}: {
  title: string
  message: string
  onRetry: () => void
}) {
  return (
    <div
      role="alert"
      data-testid="search-error"
      className="rounded-xl border border-red-500/40 bg-red-500/10 px-6 py-6"
    >
      <p className="text-sm font-semibold text-red-300">{title}</p>
      <p className="mt-1 text-xs break-words text-red-200/80">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-3 rounded-md border border-red-400/50 px-3 py-1.5 text-xs text-red-200 hover:border-red-300"
      >
        다시 시도
      </button>
    </div>
  )
}

function EmptyRuns() {
  return (
    <div
      data-testid="search-empty"
      className="rounded-xl border border-dashed border-white/10 px-6 py-14 text-center"
    >
      <p className="text-base text-neutral-200">
        아직 후보지 탐색 결과가 없습니다
      </p>
      <p className="mt-2 text-sm text-neutral-500">
        위의 임무 조건을 입력하고 탐색을 실행하세요. 명령으로도 실행할 수
        있습니다.
      </p>
      <code className="mx-auto mt-4 block max-w-full overflow-x-auto rounded-md bg-[#0f1217]/60 px-4 py-2 text-left text-xs text-neutral-200">
        {CLI_COMMAND}
      </code>
    </div>
  )
}

function RunPicker({
  runs,
  value,
  onChange,
}: {
  runs: readonly RunSummary[]
  value: string
  onChange: (id: string) => void
}) {
  const current = runs.find((run) => run.id === value)
  return (
    <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
      <label className="flex flex-col gap-1 text-xs text-neutral-400">
        탐색 실행
        <select
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="min-w-48 rounded-md border border-white/15 bg-[#0f1217]/60 px-3 py-2 text-sm text-neutral-100"
        >
          {value && !current ? (
            <option value={value}>선택한 탐색 · {value}</option>
          ) : null}
          {runs.map((run) => (
            <option key={run.id} value={run.id}>
              {run.id} · 후보 {run.selected}개
            </option>
          ))}
        </select>
      </label>
      {current ? (
        <p className="text-xs text-neutral-400">
          {formatUtc(current.generated_at)}에 실행 · DEM {current.dem} · 분석
          기간 {current.window.start.slice(0, 10)} ~{' '}
          {current.window.end.slice(0, 10)} · 샘플{' '}
          {current.sampled_total.toLocaleString('ko-KR')}개
        </p>
      ) : null}
    </div>
  )
}

/** 앱에서 고른 일정(착륙일·표면 임무 기간)을 임무 입력의 초기값으로 쓴다. */
export default function SearchView({
  schedule,
}: {
  schedule?: Pick<Schedule, 'landing' | 'duration'>
}) {
  // MissionForm은 처음 렌더링할 때만 이 값을 읽는다.
  const initialValues = schedule
    ? {
        ...DEFAULT_MISSION_VALUES,
        landingDate: schedule.landing,
        durationDays: String(schedule.duration),
      }
    : DEFAULT_MISSION_VALUES
  const [requestedRunId] = useState(() =>
    new URLSearchParams(window.location.search).get('run'),
  )
  const [completed, setCompleted] = useState<string | null>(requestedRunId)
  const [revision, setRevision] = useState(0)
  const onComplete = useCallback((id: string) => {
    setCompleted(id)
    setRevision((value) => value + 1)
  }, [])
  const form = (
    <MissionForm initialValues={initialValues} onComplete={onComplete} />
  )
  const results = <SavedRuns key={revision} initialRunId={completed} />
  return (
    <div className="flex flex-col gap-6">
      {requestedRunId !== null ? (
        <>
          {results}
          <details className="hud-panel p-4">
            <summary className="cursor-pointer text-sm text-neutral-300">
              다른 임무 조건으로 탐색
            </summary>
            <div className="mt-4">{form}</div>
          </details>
        </>
      ) : (
        <>
          {form}
          {results}
        </>
      )}
    </div>
  )
}

function SavedRuns({ initialRunId }: { initialRunId: string | null }) {
  const { state: runs, reload: reloadRuns } = useRuns()
  const [picked, setPicked] = useState<string | null>(initialRunId)

  if (picked === null && runs.status === 'loading')
    return <Spinner text="탐색 결과 목록을 불러오는 중…" />
  if (picked === null && runs.status === 'error')
    return (
      <ErrorBox
        title="탐색 결과 목록을 불러오지 못했습니다"
        message={runs.message}
        onRetry={reloadRuns}
      />
    )
  if (picked === null && runs.status === 'ok' && runs.data.length === 0)
    return <EmptyRuns />

  const runId =
    picked ?? (runs.status === 'ok' ? (runs.data[0]?.id ?? null) : null)
  if (runId === null) return <EmptyRuns />

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-3">
        <div>
          <h2 className="text-lg font-semibold text-neutral-50">
            착륙 후보지 탐색
          </h2>
          <p className="mt-1 max-w-3xl text-sm text-neutral-400">
            남극 구역을 성기게 훑고, 유망한 곳만 촘촘히 다시 계산해서, 일조와
            지구 통신이 좋고 서로 떨어진 후보를 뽑는 과정입니다. 단계를 눌러
            보거나 재생해 보세요.
          </p>
        </div>
        {runs.status === 'ok' ? (
          <RunPicker runs={runs.data} value={runId} onChange={setPicked} />
        ) : runs.status === 'loading' ? (
          <p role="status" className="text-xs text-neutral-400">
            탐색 결과 목록을 불러오는 중…
          </p>
        ) : (
          <ErrorBox
            title="탐색 결과 목록을 불러오지 못했습니다"
            message={runs.message}
            onRetry={reloadRuns}
          />
        )}
      </header>
      <RunScreen key={runId} runId={runId} />
    </div>
  )
}

function RunScreen({ runId }: { runId: string }) {
  const { state, reload } = useRun(runId)
  const availability = useAvailability(runId)
  const pricing = useCandidatePrices(runId)
  if (state.status === 'loading')
    return <Spinner text="탐색 결과를 불러오는 중…" />
  if (state.status === 'error')
    return (
      <ErrorBox
        title="탐색 결과를 불러오지 못했습니다"
        message={state.message}
        onRetry={reload}
      />
    )
  return (
    <RunBody run={state.data} availability={availability} pricing={pricing} />
  )
}

function RunBody({
  run,
  availability,
  pricing,
}: {
  run: RunDetail
  availability: ReturnType<typeof useAvailability>
  pricing: ReturnType<typeof useCandidatePrices>
}) {
  const reservations = useMemo(
    () =>
      availability.state.status === 'ready'
        ? new Map(
            availability.state.data.candidates.map((item) => [
              item.candidate_id,
              item,
            ]),
          )
        : null,
    [availability.state],
  )
  const [stepIndex, setStepIndex] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [metric, setMetric] = useState<Metric>('sun')
  const [showCandidates, setShowCandidates] = useState<boolean | null>(null)
  const [override, setOverride] = useState<{
    key: string
    layers: LayerStates
  } | null>(null)
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [selection, setSelection] = useState<Selection | null>(null)

  const step = STEPS[stepIndex]
  const stepId = step?.id ?? 'coarse'
  const available = run.map.layers

  // 단계나 지표가 바뀌면 그 단계의 기본 레이어로 돌아간다. 직접 조절한 값은 그때까지만 유지한다.
  const presetKey = `${stepId}:${metric}`
  const presets = useMemo(() => stepLayers(stepId, metric), [stepId, metric])
  const baseLayers = useMemo(
    () => layerStatesFor(presets, available),
    [presets, available],
  )
  const layers = override?.key === presetKey ? override.layers : baseLayers
  const missingLayers = presets.some(
    (preset) => !available.includes(preset.name),
  )
  const candidatesVisible = showCandidates ?? stepId === 'select'
  // 최소 간격만큼 떨어진 이웃 후보의 마커와 겹치지 않도록 간격(픽셀)의 38% 이하로 둔다.
  const markerRadius = Math.min(
    Math.max((run.config.min_separation_m / run.map.pixel_size_m) * 0.38, 1.1),
    run.map.size_px / 110,
  )

  // 재생: 일정 시간 뒤 다음 단계로. 마지막 단계에 닿으면 저절로 멈춘 것으로 본다
  // (playing 상태를 따로 되돌리지 않고, 다음 단계가 있는지로 계산한다).
  const nextIndex = nextStepIndex(stepIndex, 1, STEPS.length)
  const isPlaying = playing && nextIndex !== null
  useEffect(() => {
    if (!isPlaying || nextIndex === null) return
    const timer = setTimeout(() => setStepIndex(nextIndex), AUTO_PLAY_MS)
    return () => clearTimeout(timer)
  }, [isPlaying, nextIndex])

  function goTo(index: number) {
    setPlaying(false)
    setShowCandidates(null)
    setStepIndex(index)
  }

  function togglePlay() {
    if (isPlaying) {
      setPlaying(false)
      return
    }
    setShowCandidates(null)
    // 마지막 단계에서 누르면 처음부터 다시 보여 준다.
    if (stepIndex === STEPS.length - 1) setStepIndex(0)
    setPlaying(true)
  }

  function changeLayer(name: LayerName, patch: Partial<LayerState>) {
    setOverride({
      key: presetKey,
      layers: { ...layers, [name]: { ...layers[name], ...patch } },
    })
  }

  function selectCandidate(id: string) {
    const candidate = run.candidates.find((c) => c.id === id)
    if (candidate) setSelection({ kind: 'candidate', candidate })
  }

  function selectPoint(x_m: number, y_m: number) {
    const { lat, lon } = xyToLonLat(x_m, y_m)
    setSelection({ kind: 'point', x_m, y_m, lat, lon })
  }

  const selectedId =
    selection?.kind === 'candidate' ? selection.candidate.id : null
  const selectedPoint =
    selection?.kind === 'point'
      ? { x_m: selection.x_m, y_m: selection.y_m }
      : null
  const insideRoi = selection
    ? selection.kind === 'candidate'
      ? true
      : isInsideRoi(selection.x_m, selection.y_m, run.map)
    : false

  return (
    <div className="flex flex-col gap-8">
      {run.mission ? (
        <section
          className="rounded-xl border border-white/15 p-4"
          aria-label="입력한 임무 조건"
        >
          <h3 className="font-semibold">입력한 임무 조건</h3>
          <dl className="mt-3 grid gap-3 sm:grid-cols-2">
            {missionSummaryItems(
              run.mission,
              run.config.thresholds,
              run.config.rf != null,
              run.config.weights,
            ).map((item) => (
              <div key={item.label}>
                <dt className="text-xs text-neutral-400">{item.label}</dt>
                <dd className="text-sm">{item.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}
      {run.mission ? (
        <a
          className="hud-button self-start"
          href={`/?planner=1&pricing_run=${encodeURIComponent(run.id)}&arrival=${run.mission.landing_date}&departure=${new Date(Date.parse(run.mission.landing_date) - 4 * 86400000).toISOString().slice(0, 10)}&duration=${run.mission.mission_duration_days}`}
        >
          이 임무 조건으로 날짜별 가격 비교
        </a>
      ) : null}
      {run.summary.warnings.length > 0 ? (
        <ul
          role="alert"
          data-testid="search-warnings"
          className="flex flex-col gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-5 py-4"
        >
          <li className="text-xs font-semibold text-amber-200">
            이 결과를 읽을 때 알아 둘 점
          </li>
          {run.summary.warnings.map((warning) => (
            <li key={warning} className="text-sm text-amber-100/90">
              {warning}
            </li>
          ))}
        </ul>
      ) : null}

      <section className="flex flex-col gap-4" aria-label="탐색 과정">
        <StepNav
          index={stepIndex}
          playing={isPlaying}
          metric={metric}
          onIndexChange={goTo}
          onTogglePlay={togglePlay}
          onMetricChange={setMetric}
        />
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_24rem]">
          <div className="flex min-w-0 flex-col gap-3">
            <ProcessMap
              runId={run.id}
              map={run.map}
              layers={layers}
              candidates={run.candidates}
              showCandidates={candidatesVisible}
              highlightedId={hoveredId}
              selectedId={selectedId}
              selectedPoint={selectedPoint}
              markerRadius={markerRadius}
              onHover={setHoveredId}
              onSelectCandidate={selectCandidate}
              onSelectPoint={selectPoint}
            />
            <MapLegend layers={layers} />
            <LayerControls
              available={available}
              layers={layers}
              showCandidates={candidatesVisible}
              onLayerChange={changeLayer}
              onShowCandidates={setShowCandidates}
            />
          </div>
          <StepPanel
            index={stepIndex}
            config={run.config}
            summary={run.summary}
            missingLayers={missingLayers}
          />
        </div>
      </section>

      <section className="flex flex-col gap-4" aria-label="요약">
        <h3 className="text-base font-semibold text-neutral-50">결과 요약</h3>
        <FunnelPanel summary={run.summary} config={run.config} />
      </section>

      <section className="flex flex-col gap-4" aria-label="후보 목록">
        <h3 className="text-base font-semibold text-neutral-50">
          선정된 후보 {run.candidates.length}곳
        </h3>
        <p className="text-xs text-neutral-500">
          후보를 누르면 지도에 표시되고 자세한 값이 열립니다. 지도의 아무
          지점이나 눌러도 그곳을 바로 계산해 볼 수 있습니다.
        </p>
        <p className="text-xs text-neutral-400">
          가격 기준: 24 kg · 표면 하역 · USD 모델 추정
        </p>
        {pricing.state.status === 'error' ? (
          <div role="alert" className="text-xs text-amber-300">
            <p>격자 가격을 불러오지 못했습니다.</p>
            <button
              type="button"
              onClick={pricing.reload}
              className="mt-2 rounded border border-white/20 px-3 py-1.5 text-neutral-200"
            >
              가격 다시 불러오기
            </button>
          </div>
        ) : pricing.state.status === 'unavailable' ? (
          <p className="text-xs text-neutral-400">
            가격은 임무 조건이 저장된 500 m 정밀 탐색 결과에서 제공됩니다.
          </p>
        ) : null}
        <CandidateTable
          observerHeight={run.config.observer_height_m}
          candidates={run.candidates}
          reservations={reservations}
          prices={pricing.state}
          highlightedId={hoveredId}
          selectedId={selectedId}
          onHover={setHoveredId}
          onSelect={selectCandidate}
        />
        <div className="rounded-lg border border-white/10 p-3 text-xs text-neutral-400">
          <p>
            과학 점수는 유지됩니다. 예약 가능 순위는 이 실행의 후보 중 겹치는
            확정 예약을 제외한 순서입니다.
          </p>
          {availability.state.status === 'ready' ? (
            <p className="mt-2">
              확인 기간: {formatUtc(availability.state.data.starts_at)} →{' '}
              {formatUtc(availability.state.data.ends_at)} · 종료 시각 제외
            </p>
          ) : null}
          {availability.state.status === 'loading' ? (
            <p role="status" className="mt-2">
              예약 상태 확인 중…
            </p>
          ) : null}
          {availability.state.status === 'error' ? (
            <p role="alert" className="mt-2 text-amber-300">
              예약 확인 불가 · 예약 확정이 차단되었습니다.{' '}
              {availability.state.message}
            </p>
          ) : null}
          <button
            type="button"
            onClick={availability.reload}
            disabled={availability.state.status === 'loading'}
            className="mt-2 rounded border border-white/20 px-3 py-1.5 text-neutral-200 disabled:opacity-40"
          >
            예약 상태 새로고침
          </button>
        </div>
        <ReservationPanel
          mission={run.mission}
          selected={selectedId ? (reservations?.get(selectedId) ?? null) : null}
          onChanged={availability.reload}
        />
      </section>

      {selection ? (
        <CandidateDetail
          key={
            selection.kind === 'candidate'
              ? selection.candidate.id
              : `${selection.x_m.toFixed(0)},${selection.y_m.toFixed(0)}`
          }
          selection={selection}
          runId={
            run.mission &&
            run.config.grid_spacing_m === 500 &&
            !run.id.startsWith('dev-')
              ? run.id
              : undefined
          }
          config={run.config}
          insideRoi={insideRoi}
          onClose={() => setSelection(null)}
        />
      ) : null}

      <section className="flex flex-col gap-4" aria-label="실행 정보">
        <h3 className="text-base font-semibold text-neutral-50">
          이 결과는 어떻게 만들어졌나
        </h3>
        <RunInfo run={run} />
      </section>
    </div>
  )
}
