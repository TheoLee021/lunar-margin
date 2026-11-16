import type { RunDetail } from '../api/candidates'
import { formatUtc } from '../analysis/derive'
import { shortHash } from './derive'
import { formatElapsed } from './progress'
import { thresholdLines } from './stepCopy'

function Item({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-white/10 py-2">
      <dt className="text-[11px] text-neutral-500">{label}</dt>
      <dd className="text-xs break-words text-neutral-100">{value}</dd>
    </div>
  )
}

function km(meters: number): string {
  return meters >= 1000 ? `${meters / 1000} km` : `${meters} m`
}

export function RunInfo({ run }: { run: RunDetail }) {
  const { config, source } = run
  const thresholds = thresholdLines(config.thresholds)
  return (
    <section className="flex flex-col gap-4">
      <p
        role="note"
        className="rounded-md border border-white/10 bg-white/[0.03] px-4 py-3 text-xs leading-relaxed text-neutral-300"
      >
        <b className="text-neutral-100">분석 기간</b>은 고를 수 있는 날짜 범위가
        아니라, 이 탐색이 지점마다 지표를 계산할 때 쓴 시간 구간입니다.
        일조율·가시율은 기간 전체의 평균이고, 최장 암흑·두절은 그 기간 중 가장
        나빴던 값(최악값)입니다.
      </p>
      <dl className="grid gap-x-6 sm:grid-cols-2 lg:grid-cols-3">
        <Item
          label="분석 기간"
          value={`${formatUtc(config.window.start)} → ${formatUtc(config.window.end)} · ${config.window.step_minutes}분 간격`}
        />
        <Item
          label="높이 지도(DEM)"
          value={`${source.dem.name} · ${source.dem.resolution_m} m 해상도 · ${source.dem.file}`}
        />
        <Item label="DEM 체크섬(sha256)" value={shortHash(source.dem.sha256)} />
        <Item
          label="격자 간격"
          value={`세밀 ${km(config.grid_spacing_m)} · 거친 ${
            config.coarse_spacing_m === null
              ? '단계 없음'
              : km(config.coarse_spacing_m)
          } · 세밀화 상위 ${Math.round(config.refine_fraction * 100)}%`}
        />
        <Item
          label="탐색 구역"
          value={`남위 ${Math.abs(config.roi.max_lat_deg)}° ~ ${Math.abs(config.roi.min_lat_deg)}°`}
        />
        <Item
          label="후보 선정"
          value={`최소 간격 ${km(config.min_separation_m)} · 최대 ${config.top_k}개`}
        />
        <Item
          label="점수 가중치"
          value={`일조 ${config.weights.sun} : ${config.rf ? 'RF 통신' : '지구'} ${config.weights.earth}${config.weights.visibility ? ` · 주변 가시권 ${config.weights.visibility}` : ''}`}
        />
        <Item
          label="필수 조건(임계값)"
          value={
            thresholds.length === 0
              ? '아직 정해지지 않음'
              : thresholds.join(' · ')
          }
        />
        <Item label="관측 높이" value={`${config.observer_height_m} m`} />
        <Item
          label="계산에 걸린 시간"
          value={`${Math.round(run.run.elapsed_seconds).toLocaleString('ko-KR')}초 · 프로세스 ${run.run.workers}개`}
        />
        {run.run.total_elapsed_seconds !== null ? (
          <Item
            label="총 소요 시간 (결과 저장 포함)"
            value={formatElapsed(run.run.total_elapsed_seconds)}
          />
        ) : null}
        {run.run.started_at !== null ? (
          <Item label="시작 시각" value={formatUtc(run.run.started_at)} />
        ) : null}
        {run.run.completed_at !== null ? (
          <Item label="완료 시각" value={formatUtc(run.run.completed_at)} />
        ) : null}
        <Item label="실행 시각" value={formatUtc(run.run.generated_at)} />
        <Item
          label="천체력·지구 자전 커널"
          value={source.spice_kernels
            .map((k) => `${k.name} (${shortHash(k.sha256)})`)
            .join(', ')}
        />
        <Item label="좌표계" value={source.projection} />
      </dl>
    </section>
  )
}
