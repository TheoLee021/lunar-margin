import { useEffect, useState } from 'react'
import { fetchHealth } from './api/client'

type HealthState =
  { kind: 'loading' } | { kind: 'ok' } | { kind: 'error'; message: string }

export default function App() {
  const [health, setHealth] = useState<HealthState>({ kind: 'loading' })

  useEffect(() => {
    const controller = new AbortController()
    fetchHealth({ signal: controller.signal })
      .then(() => setHealth({ kind: 'ok' }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        const message = error instanceof Error ? error.message : String(error)
        setHealth({ kind: 'error', message })
      })
    return () => controller.abort()
  }, [])

  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-4 bg-neutral-950 text-neutral-100">
      <h1 className="text-3xl font-semibold tracking-tight">Lunar Margin</h1>
      <p data-testid="api-status" className="text-sm text-neutral-400">
        {health.kind === 'loading' && 'Connecting to API…'}
        {health.kind === 'ok' && 'API connected'}
        {health.kind === 'error' && `API unavailable: ${health.message}`}
      </p>
    </main>
  )
}
