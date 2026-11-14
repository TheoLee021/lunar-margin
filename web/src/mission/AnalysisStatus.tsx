import type { MissionAnalysisResult } from './useMissionAnalysis'

export function AnalysisStatus({ result }: { result: MissionAnalysisResult }) {
  if (result.kind === 'ready') return null
  if (result.kind === 'error')
    return (
      <div role="alert" className="grid gap-3 text-xs text-neutral-300">
        <p>{result.message}</p>
        <button
          type="button"
          className="hud-button justify-self-start"
          onClick={result.retry}
        >
          분석 다시 시도
        </button>
      </div>
    )
  return (
    <p role="status" className="text-xs text-neutral-400">
      {result.kind === 'loading'
        ? '선택한 지점과 기간의 일조·지구 가시성을 계산 중입니다…'
        : '분석할 일정을 선택하세요.'}
    </p>
  )
}
