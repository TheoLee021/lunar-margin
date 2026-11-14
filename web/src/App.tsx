import { useEffect, useState } from 'react'
import { fetchHealth } from './api/client'
import MoonViewer from './moon/MoonViewer'

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
    <main className="relative h-svh overflow-hidden bg-black text-neutral-100">
      <MoonViewer />
      <header className="pointer-events-none absolute top-4 left-4 flex flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight">Lunar Margin</h1>
        <p data-testid="api-status" className="text-xs text-neutral-400">
          {health.kind === 'loading' && 'Connecting to API…'}
          {health.kind === 'ok' && 'API connected'}
          {health.kind === 'error' && `API unavailable: ${health.message}`}
        </p>
      </header>
    </main>
  )
}
