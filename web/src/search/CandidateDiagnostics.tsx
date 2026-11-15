import type { AnalysisParams } from '../api/analysis'
import { diagnosticValues } from './diagnosticValues'
import { useCandidateDiagnostics } from './useCandidateDiagnostics'

function Value({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-white/10 py-1 text-xs">
      <dt className="text-neutral-400">{label}</dt>
      <dd className="tabular-nums text-neutral-100">{value}</dd>
    </div>
  )
}

export function CandidateDiagnostics({
  params,
  enabled,
  rfMargin,
}: {
  params: AnalysisParams
  enabled: boolean
  rfMargin: number | null | undefined
}) {
  const { state, retry } = useCandidateDiagnostics(params, enabled)
  const values = diagnosticValues(
    state.status === 'ok' ? state.data : {},
    rfMargin,
  )
  return (
    <section
      aria-label="후보 일조·지형 여유각 진단"
      className="grid gap-4 border-t border-white/10 pt-4 md:grid-cols-2"
    >
      <div>
        <h4 className="text-sm font-semibold text-sky-300">
          지형 여유각 · 기하학적 LOS (°)
        </h4>
        <p className="mt-1 text-xs text-neutral-400">
          천체 중심 고도 − 지형 수평선 고도. P10은 가시 구간만의 10백분위수이며
          신뢰구간이나 통신 성공률이 아닙니다.
        </p>
        {state.status === 'loading' ? (
          <p role="status" className="mt-2 text-xs text-neutral-400">
            일조 연속성과 지형 여유각을 계산하는 중…
          </p>
        ) : null}
        {state.status === 'error' ? (
          <div role="alert" className="mt-2 text-xs text-red-300">
            <p>상세 진단을 불러오지 못했습니다. {state.message}</p>
            <button
              type="button"
              onClick={retry}
              className="mt-2 rounded border border-red-400/50 px-2 py-1"
            >
              상세 진단 다시 시도
            </button>
          </div>
        ) : null}
        {state.status === 'unavailable' ? (
          <p className="mt-2 text-xs text-amber-300">
            분석 가능한 지점에서 진단을 표시합니다.
          </p>
        ) : null}
        {state.status === 'ok' ? (
          <dl className="mt-2">
            <Value label="태양 지형 여유각 P10" value={values.sunClearance} />
            <Value label="지구 지형 여유각 P10" value={values.earthClearance} />
          </dl>
        ) : null}
      </div>
      <div>
        <h4 className="text-sm font-semibold text-neutral-200">
          RF 링크마진 · 저장된 명목 평가 (dB)
        </h4>
        <dl className="mt-2">
          <Value label="최소 명목 RF 링크마진" value={values.rfMargin} />
        </dl>
        <p className="mt-1 text-xs text-neutral-400">
          RF 마진은 별도 링크 예산 결과입니다. 지형 여유각(°)을 dB로 환산하지
          않습니다. 차폐 시 마진은 가상 LOS 계산값이며 실제 통신 가능을 뜻하지
          않습니다.
        </p>
        {rfMargin == null ? (
          <p className="mt-1 text-xs text-neutral-500">
            이 후보에는 저장된 RF 평가가 없습니다.
          </p>
        ) : null}
      </div>
      <div>
        <h4 className="text-sm font-semibold text-amber-300">
          일조 연속성 · 상세 분석 기간
        </h4>
        {state.status === 'ok' ? (
          <dl className="mt-2">
            <Value label="최장 연속 일조" value={values.longestSunlight} />
            <Value label="일조·차폐 전환 횟수" value={values.transitions} />
          </dl>
        ) : null}
        <p className="mt-1 text-xs text-neutral-400">
          태양 중심의 지형 LOS 기준입니다. 발전량·배터리 용량이나 정확한
          일출·일몰 시각을 예측하지 않습니다.
        </p>
      </div>
      <p className="text-xs text-neutral-500">
        진단 기간: {params.start} → {params.end} · {params.step_minutes}분 간격
        · 관측 높이 {params.observer_height_m} m. 저장된 RF 값은 원래 탐색
        기간의 결과입니다.
      </p>
    </section>
  )
}
