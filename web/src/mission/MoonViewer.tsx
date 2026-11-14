import { useEffect, useRef, useState } from 'react'
import type { CandidateSite, MissionSelection } from './types'

type CameraMode = 'top' | 'site'
type MoonControls = {
  flyTo: (mode: CameraMode) => void
  select: (site: CandidateSite) => void
  destroy: () => void
}
type ViewerState =
  { kind: 'loading' } | { kind: 'ready' } | { kind: 'error'; message: string }

export function MoonViewer({
  selection,
  sites,
  onSelect,
}: {
  selection: MissionSelection
  sites: readonly CandidateSite[]
  onSelect: (siteId: string) => void
}) {
  const container = useRef<HTMLDivElement>(null)
  const controls = useRef<MoonControls | null>(null)
  const latestSelection = useRef(selection)
  const selectCallback = useRef(onSelect)
  const [state, setState] = useState<ViewerState>({ kind: 'loading' })
  useEffect(() => {
    latestSelection.current = selection
    selectCallback.current = onSelect
  }, [selection, onSelect])
  useEffect(() => {
    let disposed = false
    let destroy: (() => void) | undefined
    const element = container.current!
    void import('./createMoonViewer')
      .then(async ({ createMoonViewer }) => {
        if (disposed) return
        const moon = createMoonViewer(element, sites, (id) =>
          selectCallback.current(id),
        )
        destroy = moon.controls.destroy
        controls.current = moon.controls
        const selected = sites.find(
          (site) => site.id === latestSelection.current.siteId,
        )
        if (selected) moon.controls.select(selected)
        await moon.loadTerrain()
        if (!disposed) setState({ kind: 'ready' })
      })
      .catch((error: unknown) => {
        if (!disposed)
          setState({
            kind: 'error',
            message: error instanceof Error ? error.message : String(error),
          })
      })
    return () => {
      disposed = true
      destroy?.()
      controls.current = null
    }
  }, [sites])
  useEffect(() => {
    const selected = sites.find((site) => site.id === selection.siteId)
    if (selected) controls.current?.select(selected)
  }, [selection.siteId, sites])
  return (
    <>
      <div
        ref={container}
        className="absolute inset-0"
        aria-label="달 남극 3D 지도"
      />
      <div className="absolute right-4 top-4 flex gap-2">
        <button
          type="button"
          className="hud-button"
          disabled={state.kind === 'loading'}
          onClick={() => controls.current?.flyTo('top')}
        >
          위에서 보기
        </button>
        <button
          type="button"
          className="hud-button"
          disabled={state.kind === 'loading'}
          onClick={() => controls.current?.flyTo('site')}
        >
          선택 지점 3D로 보기
        </button>
      </div>
      {state.kind !== 'ready' ? (
        <div
          role="status"
          className="hud-panel absolute left-1/2 top-20 z-10 max-w-sm -translate-x-1/2 p-3 text-xs text-neutral-300"
        >
          {state.kind === 'loading' ? (
            '달 지형을 불러오는 중입니다.'
          ) : (
            <>
              {state.message}
              <br />
              기본 달 표면과 예시 후보는 계속 탐색할 수 있습니다.
            </>
          )}
        </div>
      ) : null}
    </>
  )
}
