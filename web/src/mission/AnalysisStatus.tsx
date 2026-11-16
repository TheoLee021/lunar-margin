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
          Retry analysis
        </button>
      </div>
    )
  return (
    <p role="status" className="text-xs text-neutral-400">
      {result.kind === 'loading'
        ? 'Computing sunlight and Earth visibility for the selected site and period…'
        : 'Select a schedule to analyze.'}
    </p>
  )
}
