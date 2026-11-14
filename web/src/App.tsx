import { lazy, Suspense, useEffect, useState } from 'react'
import { fetchHealth } from './api/client'
import { MissionWorkspace } from './mission/MissionWorkspace'
import { MissionSummary } from './mission/MissionSummary'
import { INITIAL_SELECTION } from './mission/demoSites'

type HealthState =
  { kind: 'loading' } | { kind: 'ok' } | { kind: 'error'; message: string }

const AnalysisWorkspace = lazy(() => import('./AnalysisWorkspace'))

export default function App() {
  const analysis =
    new URLSearchParams(window.location.search).get('view') === 'analysis'
  return (
    <>
      <Suspense
        fallback={
          <p role="status" className="p-4 text-sm text-neutral-300">
            분석 화면을 불러오는 중입니다.
          </p>
        }
      >
        {analysis ? <AnalysisWorkspace /> : <MissionApp />}
      </Suspense>
      <a
        className="hud-button fixed bottom-4 left-32 z-20"
        href={analysis ? '/' : '/?view=analysis'}
      >
        {analysis ? '미션 대시보드' : '상세 분석'}
      </a>
    </>
  )
}

function MissionApp() {
  const [selection, setSelection] = useState(INITIAL_SELECTION)
  const [health, setHealth] = useState<HealthState>({ kind: 'loading' })
  useEffect(() => {
    const controller = new AbortController()
    fetchHealth({ signal: controller.signal })
      .then(() => setHealth({ kind: 'ok' }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setHealth({
          kind: 'error',
          message: error instanceof Error ? error.message : String(error),
        })
      })
    return () => controller.abort()
  }, [])
  return (
    <MissionWorkspace
      selection={selection}
      onSelect={(siteId) => setSelection((current) => ({ ...current, siteId }))}
      summary={<MissionSummary selection={selection} />}
      apiStatus={
        <p data-testid="api-status">
          {health.kind === 'loading' && 'Connecting to API…'}
          {health.kind === 'ok' && 'API connected'}
          {health.kind === 'error' && `API unavailable: ${health.message}`}
        </p>
      }
    />
  )
}
