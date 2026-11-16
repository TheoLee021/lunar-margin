import {
  fetchViewshed,
  GRID_TARGET_COUNT,
  visibleGridCount,
  type Viewshed,
} from '../api/viewshed'
import {
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type Ref,
} from 'react'
import MoonViewer, { type MoonViewerHandle } from '../moon/MoonViewer'
import { gridCellCorners, type LunarLocation } from '../moon/location'
import type { MoonMarker } from '../moon/markerLayer'
import type { Vector3 } from '../moon/sun'
import type { CandidateSite, MissionSelection } from './types'
import type { SunPathResult } from './useSunPath'

export interface MissionMoonViewerHandle {
  focusSite(siteId: string): void
  /** Lights the Moon from a Sun that is still moving (`sunMoving`), one call per frame. */
  previewSun(direction: Vector3): void
}

/** Adapts the shared Moon scene to the mission HUD's selection and camera buttons. */
export function MissionMoonViewer({
  ref,
  selection,
  sites,
  onSelect,
  demName,
  heights,
  height,
  setHeight,
  sun,
  sunDirection,
  sunMoving,
  photo,
  onPhotoChange,
}: {
  demName?: string
  heights: readonly number[]
  height: number
  setHeight: (height: number) => void
  ref?: Ref<MissionMoonViewerHandle>
  selection: MissionSelection
  sites: readonly CandidateSite[]
  onSelect: (siteId: string | null) => void
  /** The Sun over the mission, for the state of the sunlight button. */
  sun: SunPathResult
  /** The Sun at the shown time: its Moon-to-Sun direction (MOON_ME) once it has loaded. */
  sunDirection: Vector3 | null
  /**
   * The shown time is being dragged or played: the Sun of each frame comes through `previewSun`,
   * and `sunDirection` is taken again, with its precise shadows, once this is over.
   */
  sunMoving: boolean
  /** Show the photo instead of the sunlight. */
  photo: boolean
  onPhotoChange: (photo: boolean) => void
}) {
  const viewer = useRef<MoonViewerHandle>(null)
  const lit = sunDirection !== null && !photo
  useEffect(() => {
    if (lit && sunMoving) return
    viewer.current?.setSunDirection(lit ? sunDirection : null)
  }, [lit, sunMoving, sunDirection])
  const [picked, setPicked] = useState<LunarLocation | null>(null)
  const observer = selection.siteId === null ? picked : null
  const markers = useMemo<readonly MoonMarker[]>(
    () =>
      sites.map((site, index) => ({
        id: site.id,
        label: String(index + 1),
        location: { lat: site.latitude, lon: site.longitude },
        footprint: site.grid ? gridCellCorners(site.grid) : undefined,
      })),
    [sites],
  )
  const selected = sites.find((site) => site.id === selection.siteId)
  const [detail, setDetail] = useState(false)
  const [attempt, retry] = useState(0)
  const lat = detail ? (observer?.lat ?? selected?.latitude) : undefined
  const lon = detail ? (observer?.lon ?? selected?.longitude) : undefined
  const center = selected?.grid
  const key = JSON.stringify([lat, lon, height, center, attempt, demName])
  const [result, setResult] = useState<{
    key: string
    distanceKm?: number
    map: Viewshed | null
  } | null>(null)
  useEffect(() => {
    if (lat === undefined || lon === undefined) return
    viewer.current?.flyTo(observer ?? { lat, lon }, 18000)
  }, [lat, lon, observer])
  useEffect(() => {
    if (lat === undefined || lon === undefined) return
    const controller = new AbortController()
    void fetchViewshed(
      lat,
      lon,
      height,
      AbortSignal.any([controller.signal, AbortSignal.timeout(30000)]),
      center,
      demName,
    )
      .then((map) => {
        if (!controller.signal.aborted)
          setResult({ key, map, distanceKm: maxVisibleDistanceKm(map.cells) })
      })
      .catch(() => {
        if (!controller.signal.aborted) setResult({ key, map: null })
      })
    return () => controller.abort()
  }, [key, lat, lon, height, center, demName])
  const current = result?.key === key ? result : null
  const focusSite = (site: CandidateSite) =>
    viewer.current?.flyTo(
      { lat: site.latitude, lon: site.longitude },
      detail ? 18000 : site.grid ? site.grid.spacing_m * 20 : undefined,
    )
  useImperativeHandle(ref, () => ({
    focusSite(siteId) {
      setPicked(null)
      const site = sites.find((candidate) => candidate.id === siteId)
      if (site) focusSite(site)
    },
    previewSun(direction) {
      viewer.current?.previewSunDirection(direction)
    },
  }))
  return (
    <>
      <div className="absolute inset-0" aria-label="달 남극 3D 지도">
        <MoonViewer
          ref={viewer}
          viewshed={detail ? current?.map : null}
          markers={markers}
          selectedMarkerId={selection.siteId}
          onPick={(location) => {
            onSelect(null)
            setPicked(location)
            setDetail(true)
          }}
          onMarkerSelect={(siteId) => {
            const site = sites.find((candidate) => candidate.id === siteId)
            if (!site) return
            setPicked(null)
            onSelect(siteId)
            focusSite(site)
          }}
        />
      </div>
      <div className="absolute right-4 top-4 flex gap-2">
        <button
          type="button"
          className="hud-button"
          disabled={sun.kind === 'loading'}
          aria-pressed={lit}
          title={
            sun.kind === 'loading'
              ? '미션 기간의 태양 방향을 불러오는 중입니다'
              : sun.kind === 'error'
                ? '미션 기간의 태양 방향을 불러오지 못했습니다. 누르면 다시 시도합니다'
                : '검토 시점(선택 전에는 착륙 시각)의 태양으로 조명과 지형 그림자를 그립니다'
          }
          onClick={() => {
            if (sun.kind === 'error') sun.retry()
            else onPhotoChange(!photo)
          }}
        >
          {sun.kind === 'error'
            ? '햇빛 다시 시도'
            : lit
              ? '사진으로 보기'
              : '햇빛 보기'}
        </button>
        <button
          type="button"
          className="hud-button"
          onClick={() => {
            setPicked(null)
            setDetail(false)
            viewer.current?.flyToOverview()
          }}
        >
          위에서 보기
        </button>
        <button
          type="button"
          className="hud-button"
          disabled={!selected && !observer}
          onClick={() => {
            setDetail(true)
            if (detail && selected) focusSite(selected)
          }}
        >
          선택 지점 3D로 보기
        </button>
      </div>
      {detail && lat !== undefined && lon !== undefined && (
        <div
          role="status"
          className="pointer-events-auto absolute left-1/2 top-16 -translate-x-1/2 rounded bg-black/85 px-3 py-2 text-xs text-white"
        >
          {observer ? '지도 관측점' : selected?.name} · 주변 가시권 · 5 km ·
          <label>
            관측 높이{' '}
            <select
              aria-label="관측 높이"
              className="rounded bg-neutral-800 px-1"
              value={height}
              onChange={(event) => setHeight(Number(event.target.value))}
            >
              {heights.map((h) => (
                <option key={h} value={h}>
                  {h} m
                </option>
              ))}
            </select>
          </label>
          <div>
            {!current ? (
              '지형 가시권 계산 중…'
            ) : current.map ? (
              <>
                <div>
                  {lat.toFixed(4)}°, {lon.toFixed(4)}°
                </div>
                <strong>
                  반경 내 최장 가시거리 {current.distanceKm?.toFixed(2)} km
                </strong>
                <div>
                  {current.map.targets.length === GRID_TARGET_COUNT
                    ? `보이는 격자점 ${visibleGridCount(current.map)} / ${GRID_TARGET_COUNT}`
                    : `지형 자료 부족 · ${GRID_TARGET_COUNT}개 중 ${current.map.targets.length}개 경로 확인`}
                </div>
                <span className="text-amber-400">⊙ 관측점</span>　
                <span className="text-green-400">● 보임</span>　
                <span className="text-red-400">● 가려짐</span>
                <div>
                  격자점 800 m 간격 · 주황점은 첫 차폐 지점 · 빨간 선은 차폐
                  구간
                </div>
              </>
            ) : (
              <button type="button" onClick={() => retry((n) => n + 1)}>
                {lat > -80
                  ? '남위 80° 이남의 지점을 선택하세요'
                  : '계산 실패 · 다시 시도'}
              </button>
            )}
          </div>
        </div>
      )}
    </>
  )
}

// Each character represents one 80 m cell in the south-polar projection.
function maxVisibleDistanceKm(cells: string): number {
  const side = Math.sqrt(cells.length)
  const center = (side - 1) / 2
  let maxSquared = 0
  for (let i = 0; i < cells.length; i++) {
    if (cells[i] !== '2') continue
    const dx = (i % side) - center
    const dy = Math.floor(i / side) - center
    maxSquared = Math.max(maxSquared, dx * dx + dy * dy)
  }
  return Math.sqrt(maxSquared) * 0.08
}
