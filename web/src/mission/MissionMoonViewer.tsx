import { useCallback, useEffect, useMemo, useRef } from 'react'
import MoonViewer, { type MoonViewerHandle } from '../moon/MoonViewer'
import type { MoonMarker } from '../moon/markerLayer'
import {
  DEMO_SPEED_SCALE,
  TRAVERSE_DURATION_MS,
  TRAVERSE_LENGTH_M,
  TRENCHER_SPEED_MS,
  buildEquipmentAssets,
  type EquipmentSky,
} from './demoEquipment'
import type { CandidateSite, MissionSelection } from './types'
import { EMPTY_SKY, useEquipmentSky } from './useEquipmentSky'

/** Close enough that metre-scale equipment reads on screen. */
const EQUIPMENT_RANGE_M = 450

/** Adapts the shared Moon scene to the mission HUD's selection and camera buttons. */
export function MissionMoonViewer({
  selection,
  sites,
  onSelect,
}: {
  selection: MissionSelection
  sites: readonly CandidateSite[]
  onSelect: (siteId: string) => void
}) {
  const viewer = useRef<MoonViewerHandle>(null)
  const markers = useMemo<readonly MoonMarker[]>(
    () =>
      sites.map((site, index) => ({
        id: site.id,
        label: String(index + 1),
        location: { lat: site.latitude, lon: site.longitude },
      })),
    [sites],
  )
  const selected = sites.find((site) => site.id === selection.siteId)
  const sky = useEquipmentSky(selected, selection)

  // The traverse redraws every frame, so its state lives in a ref and goes straight
  // to Cesium. React only renders the buttons and the status line.
  const traverse = useRef<{
    site: CandidateSite | undefined
    sky: EquipmentSky
    progress: number
  }>({ site: undefined, sky: EMPTY_SKY, progress: 0 })
  const frame = useRef(0)

  const draw = useCallback(() => {
    const { site, sky: measured, progress } = traverse.current
    if (!site) return
    viewer.current?.setAssets(buildEquipmentAssets(site, progress, measured))
  }, [])

  useEffect(() => {
    cancelAnimationFrame(frame.current)
    traverse.current = {
      site: selected,
      sky: sky.kind === 'ready' ? sky.sky : EMPTY_SKY,
      progress: 0,
    }
    if (!selected) viewer.current?.setAssets([])
    draw()
  }, [selected, sky, draw])

  useEffect(() => () => cancelAnimationFrame(frame.current), [])

  const runTraverse = () => {
    if (!selected) return
    cancelAnimationFrame(frame.current)
    viewer.current?.flyTo(
      { lat: selected.latitude, lon: selected.longitude },
      EQUIPMENT_RANGE_M,
    )
    const started = performance.now()
    const step = (now: number) => {
      const progress = Math.min(1, (now - started) / TRAVERSE_DURATION_MS)
      traverse.current.progress = progress
      draw()
      if (progress < 1) frame.current = requestAnimationFrame(step)
    }
    frame.current = requestAnimationFrame(step)
  }

  return (
    <>
      <div className="absolute inset-0" aria-label="달 남극 3D 지도">
        <MoonViewer
          ref={viewer}
          markers={markers}
          selectedMarkerId={selection.siteId}
          onMarkerSelect={onSelect}
        />
      </div>
      <div className="absolute right-4 top-4 flex flex-col items-end gap-2">
        <div className="flex gap-2">
          <button
            type="button"
            className="hud-button"
            onClick={() => viewer.current?.flyToOverview()}
          >
            위에서 보기
          </button>
          <button
            type="button"
            className="hud-button"
            disabled={!selected}
            onClick={() => {
              if (selected)
                viewer.current?.flyTo({
                  lat: selected.latitude,
                  lon: selected.longitude,
                })
            }}
          >
            선택 지점 3D로 보기
          </button>
          <button
            type="button"
            className="hud-button"
            disabled={!selected || sky.kind !== 'ready'}
            onClick={runTraverse}
          >
            트렌처 주행
          </button>
        </div>
        <p className="hud-panel max-w-64 px-2 py-1 text-right text-[10px] leading-snug text-neutral-400">
          {sky.kind === 'loading' ? (
            <span role="status">장비 지점별 지구 가시성 계산 중…</span>
          ) : sky.kind === 'error' ? (
            <span role="alert" className="text-red-300">
              장비 지점 가시성을 불러오지 못했습니다. 다른 후보를 고르면 다시
              계산합니다.
            </span>
          ) : sky.kind === 'ready' ? (
            <>
              {sky.missing > 0 ? (
                <span role="alert" className="text-red-300">
                  {sky.missing}개 지점 계산 실패 ·{' '}
                </span>
              ) : null}
              트렌치 {Math.round(TRAVERSE_LENGTH_M)} m · 실제{' '}
              {TRENCHER_SPEED_MS} m/s를 {DEMO_SPEED_SCALE}배속으로 재생
            </>
          ) : (
            '후보를 선택하면 장비를 배치합니다.'
          )}
        </p>
      </div>
    </>
  )
}
