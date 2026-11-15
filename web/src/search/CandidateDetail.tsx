import { useEffect, useRef, useState } from 'react'
import type { AnalysisKind, AnalysisParams } from '../api/analysis'
import type { Candidate, RunDetail } from '../api/candidates'
import { ResultView } from '../analysis/ResultView'
import { KIND_COPY } from '../analysis/kinds'
import { useAnalysis, type AnalysisState } from '../analysis/useAnalysis'
import {
  degText,
  fractionText,
  hoursText,
  detailPeriod,
  detailPeriodText,
  reasonLabel,
  scoreText,
} from './derive'
import { thresholdsFor } from './stepCopy'
import { LandingGridPanel } from './LandingGridPanel'

export type Selection =
  | { kind: 'candidate'; candidate: Candidate }
  | { kind: 'point'; x_m: number; y_m: number; lat: number; lon: number }

interface Props {
  selection: Selection
  config: RunDetail['config']
  insideRoi: boolean
  onClose: () => void
}

const STATUS_TEXT: Record<Candidate['eligibility']['status'], string> = {
  eligible: '적격',
  excluded: '제외',
  unevaluated: '판정 불가',
}

const PICKED_TEXT: Readonly<Record<string, string>> = {
  region_best: '영역 대표(영역에서 점수가 가장 높음)',
  fill: '남는 자리를 점수 순으로 채움',
}

const METRIC_NAMES: Readonly<Record<string, string>> = {
  sun_fraction: '일조율',
  sun_longest_dark_h: '최장 암흑',
  earth_fraction: '지구 가시율',
  earth_longest_blackout_h: '최장 통신 두절',
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-white/10 py-1 text-xs">
      <dt className="text-neutral-400">{label}</dt>
      <dd className="tabular-nums text-neutral-100">{value}</dd>
    </div>
  )
}

export function CandidateDetail({
  selection,
  config,
  insideRoi,
  onClose,
}: Props) {
  const sun = useAnalysis()
  const earth = useAnalysis()
  const [kind, setKind] = useState<AnalysisKind>('illumination')
  // 태양 계산이 끝난 뒤에 지구를 요청한다. 백엔드의 천체 계산(SPICE)이 동시 요청을
  // 처리하지 못해서, 두 요청을 한꺼번에 보내지 않는다.
  const pendingEarth = useRef<AnalysisParams | null>(null)
  const sunStatus = sun.state.status
  const runEarth = earth.run
  useEffect(() => {
    const params = pendingEarth.current
    if (params && (sunStatus === 'ok' || sunStatus === 'error')) {
      pendingEarth.current = null
      runEarth('earth-visibility', params)
    }
  }, [sunStatus, runEarth])

  const lat =
    selection.kind === 'candidate' ? selection.candidate.lat_deg : selection.lat
  const lon =
    selection.kind === 'candidate' ? selection.candidate.lon_deg : selection.lon
  // 분석 API 는 위도 -90 ~ -80 만 받는다.
  const analyzable = insideRoi && lat >= -90 && lat <= -80

  function loadAnalysis() {
    const { start, end } = detailPeriod(config.window)
    const params: AnalysisParams = {
      lat: Number(lat.toFixed(6)),
      lon: Number(lon.toFixed(6)),
      start,
      end,
      step_minutes: 30,
      observer_height_m: config.observer_height_m,
    }
    pendingEarth.current = params
    sun.run('illumination', params)
  }

  const current = kind === 'illumination' ? sun.state : earth.state
  const started = sun.state.status !== 'idle' || earth.state.status !== 'idle'

  return (
    <section
      aria-label="선택한 지점 상세"
      className="flex flex-col gap-5 rounded-xl border border-white/10 bg-white/[0.03] p-5"
    >
      <header className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-neutral-50">
            {selection.kind === 'candidate'
              ? `후보 ${selection.candidate.rank}번 · ${selection.candidate.id}`
              : '지도에서 고른 지점'}
          </h3>
          <p className="mt-1 text-xs text-neutral-400">
            위도 {lat.toFixed(4)}° · 경도 {lon.toFixed(3)}°E
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-white/15 px-2.5 py-1 text-xs text-neutral-300 hover:border-sky-400"
        >
          닫기
        </button>
      </header>

      {selection.kind === 'candidate' ? (
        <CandidateFacts candidate={selection.candidate} />
      ) : (
        <p className="text-sm text-neutral-400">
          탐색 결과에 없는 지점입니다. 아래 버튼으로 이 지점의 일조와 지구
          가시성을 바로 계산해서 볼 수 있습니다.
        </p>
      )}

      <LandingGridPanel lat={Number(lat.toFixed(6))} lon={Number(lon.toFixed(6))} disabled={!analyzable} />

      <div className="flex flex-col gap-3 border-t border-white/10 pt-4">
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={loadAnalysis}
            disabled={
              !analyzable ||
              sun.state.status === 'loading' ||
              earth.state.status === 'loading'
            }
            className="rounded-md bg-neutral-100 px-4 py-2 text-sm font-medium text-neutral-950 hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {started ? '다시 계산' : '시계열로 자세히 보기'}
          </button>
          <p className="text-xs text-neutral-500">
            {detailPeriodText(config.window)} 태양과 지구 모두 계산합니다. (분석
            API는 한 번에 최대 3년까지만 받습니다.)
          </p>
        </div>
        {!analyzable ? (
          <p role="note" className="text-xs text-amber-300">
            {insideRoi
              ? '이 지점은 분석 API가 받는 위도(-90° ~ -80°) 밖입니다.'
              : '탐색 구역(점선) 밖이라 계산하지 않습니다.'}
          </p>
        ) : null}

        {started ? (
          <>
            <div
              role="tablist"
              aria-label="분석 종류"
              className="flex gap-1 border-b border-white/10"
            >
              {(['illumination', 'earth-visibility'] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  aria-selected={kind === value}
                  onClick={() => setKind(value)}
                  className={`-mb-px border-b-2 px-4 py-2 text-sm ${
                    kind === value
                      ? 'border-neutral-100 text-neutral-100'
                      : 'border-transparent text-neutral-400 hover:text-neutral-200'
                  }`}
                >
                  {KIND_COPY[value].tab}
                </button>
              ))}
            </div>
            <AnalysisSlot
              state={current}
              kind={kind}
              config={config}
              onRetry={loadAnalysis}
            />
          </>
        ) : null}
      </div>
    </section>
  )
}

function CandidateFacts({ candidate }: { candidate: Candidate }) {
  const { eligibility, data_quality: quality, score, selection } = candidate
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <div className="flex flex-col gap-4">
        <div>
          <h4 className="mb-1 text-xs font-semibold text-amber-300">
            태양 일조
          </h4>
          <dl>
            <Row
              label="평균 일조율"
              value={fractionText(candidate.sun.fraction)}
            />
            <Row
              label="최장 연속 암흑"
              value={hoursText(candidate.sun.longest_dark_hours)}
            />
            <Row
              label="24시간당 일조 창"
              value={
                candidate.sun.windows_per_24h === null
                  ? '—'
                  : `${candidate.sun.windows_per_24h.toFixed(3)}회`
              }
            />
            <Row
              label="일조 중 태양 평균 고도"
              value={degText(candidate.sun.mean_elevation_deg)}
            />
          </dl>
        </div>
        <div>
          <h4 className="mb-1 text-xs font-semibold text-sky-300">
            지구 직접 통신
          </h4>
          <dl>
            <Row
              label="평균 지구 가시율"
              value={fractionText(candidate.earth.fraction)}
            />
            <Row
              label="최장 통신 두절"
              value={hoursText(candidate.earth.longest_blackout_hours)}
            />
            <Row
              label="24시간당 통신 가능 구간"
              value={
                candidate.earth.windows_per_24h === null
                  ? '—'
                  : `${candidate.earth.windows_per_24h.toFixed(3)}회`
              }
            />
            <Row
              label="보이는 동안 지구 평균 고도각"
              value={degText(candidate.earth.mean_elevation_deg)}
            />
          </dl>
        </div>
      </div>

      <div className="flex flex-col gap-4 text-xs">
        <div>
          <h4 className="mb-1 font-semibold text-neutral-200">지역 지형</h4>
          {candidate.terrain ? (
            <>
              <dl>
                <Row
                  label="지역 경사 P95"
                  value={degText(candidate.terrain.slope_p95_deg)}
                />
                <Row
                  label="DEM 유효 표본"
                  value={fractionText(candidate.terrain.coverage_fraction)}
                />
              </dl>
              <p className="mt-1 text-neutral-400">
                반경 {candidate.terrain.assessment_radius_m} m · 경사 기준{' '}
                {candidate.terrain.slope_baseline_m} m · DEM{' '}
                {candidate.terrain.dem_pixel_m} m
              </p>
              <p className="mt-1 text-amber-300">
                착륙 안전성 UNVERIFIED · 미세 장애물·발판·지반 안전성 미검증
              </p>
            </>
          ) : (
            <p className="text-neutral-400">
              이 실행은 지역 경사를 계산하지 않았습니다.
            </p>
          )}
        </div>
        <div>
          <h4 className="mb-1 font-semibold text-neutral-200">점수</h4>
          <dl>
            <Row label="종합 점수" value={scoreText(score.total)} />
            <Row label="일조 성분" value={scoreText(score.sun_component)} />
            <Row label="지구 성분" value={scoreText(score.earth_component)} />
          </dl>
          {score.components_used < 2 ? (
            <p className="mt-1 text-neutral-500">
              값이 없는 성분은 0으로 치지 않고 빼서 나머지 가중치로 다시
              계산했습니다.
            </p>
          ) : null}
        </div>
        <div>
          <h4 className="mb-1 font-semibold text-neutral-200">적격 판정</h4>
          <p className="text-neutral-100">
            {STATUS_TEXT[eligibility.status]}
            {eligibility.failed.length > 0
              ? ` · ${eligibility.failed.map(reasonLabel).join(', ')}`
              : ''}
          </p>
          {eligibility.not_applied.length > 0 ? (
            <p className="mt-1 text-amber-300">
              값이 없어 적용하지 못한 조건:{' '}
              {eligibility.not_applied.map(reasonLabel).join(', ')}
            </p>
          ) : null}
        </div>
        <div>
          <h4 className="mb-1 font-semibold text-neutral-200">선정 방식</h4>
          <p className="text-neutral-100">
            {PICKED_TEXT[selection.picked_as] ?? (selection.picked_as || '—')}
          </p>
          {selection.note ? (
            <p className="mt-1 text-neutral-400">
              {selection.note.split(';').map(reasonLabel).join(', ')}
            </p>
          ) : null}
          <p className="mt-1 text-neutral-500">영역 {candidate.region_id}번</p>
        </div>
        <div>
          <h4 className="mb-1 font-semibold text-neutral-200">데이터 품질</h4>
          <p
            className={
              quality.horizon_complete ? 'text-emerald-300' : 'text-amber-300'
            }
          >
            {quality.horizon_complete
              ? '수평선 계산이 높이 지도 안에서 끝났습니다.'
              : '수평선 탐색이 높이 지도 밖으로 나가, 지평선이 실제보다 낮게 계산됐을 수 있습니다.'}
          </p>
          <p className="mt-1 text-neutral-400">
            가장 높은 수평선 {degText(quality.horizon_max_deg)} ·{' '}
            {quality.stage === 'fine' ? '세밀 격자 값' : '거친 격자 값'}
          </p>
          {quality.missing_metrics.length > 0 ? (
            <p className="mt-1 text-amber-300">
              계산하지 못한 지표:{' '}
              {quality.missing_metrics
                .map((name) => METRIC_NAMES[name] ?? name)
                .join(', ')}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function AnalysisSlot({
  state,
  kind,
  config,
  onRetry,
}: {
  state: AnalysisState
  kind: AnalysisKind
  config: RunDetail['config']
  onRetry: () => void
}) {
  if (state.status === 'idle')
    return (
      <p role="status" className="text-sm text-neutral-400">
        태양 계산이 끝나면 이어서 계산합니다…
      </p>
    )
  if (state.status === 'loading')
    return (
      <div
        role="status"
        className="flex items-center justify-center gap-3 rounded-xl border border-white/10 px-6 py-12 text-sm text-neutral-300"
      >
        <span className="size-4 animate-spin rounded-full border-2 border-white/20 border-t-neutral-100" />
        지형 수평선과 천체 위치를 계산하는 중…
      </div>
    )
  if (state.status === 'error')
    return (
      <div
        role="alert"
        className="rounded-xl border border-red-500/40 bg-red-500/10 px-6 py-5"
      >
        <p className="text-sm font-semibold text-red-300">
          분석을 불러오지 못했습니다
        </p>
        <p className="mt-1 text-xs break-words text-red-200/80">
          {state.message}
        </p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 rounded-md border border-red-400/50 px-3 py-1.5 text-xs text-red-200 hover:border-red-300"
        >
          다시 시도
        </button>
      </div>
    )
  if (state.status === 'ok')
    return (
      <ResultView
        key={`${state.kind}-${state.data.lat}-${state.data.lon}`}
        kind={state.kind}
        data={state.data}
        thresholds={thresholdsFor(kind, config.thresholds)}
      />
    )
  return null
}
