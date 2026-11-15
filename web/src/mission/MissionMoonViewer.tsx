import { fetchViewshed, type Viewshed } from '../api/viewshed'
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
import type { CandidateSite, MissionSelection } from './types'
import type { SunDirectionResult } from './useSunDirection'

export interface MissionMoonViewerHandle {
  focusSite(siteId: string): void
}

/** Adapts the shared Moon scene to the mission HUD's selection and camera buttons. */
export function MissionMoonViewer({
  ref,
  selection,
  sites,
  onSelect,
  sun,
}: {
  ref?: Ref<MissionMoonViewerHandle>
  selection: MissionSelection
  sites: readonly CandidateSite[]
  onSelect: (siteId: string | null) => void
  /** The Sun at the shown time: its Moon-to-Sun direction (MOON_ME) once it has loaded. */
  sun: SunDirectionResult
}) {
  const viewer = useRef<MoonViewerHandle>(null)
  const [photo, setPhoto] = useState(false)
  const sunDirection = sun.kind === 'ready' ? sun.direction : null
  const lit = sunDirection !== null && !photo
  useEffect(() => {
    viewer.current?.setSunDirection(lit ? sunDirection : null)
  }, [lit, sunDirection])
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
  const key = JSON.stringify([lat, lon, attempt])
  const [result, setResult] = useState<{
    key: string
    distanceKm?: number
    map: Viewshed | null
  } | null>(null)
  useEffect(() => {
    if (lat === undefined || lon === undefined) return
    viewer.current?.flyTo(observer ?? { lat, lon }, 18000)
    const controller = new AbortController()
    void fetchViewshed(
      lat,
      lon,
      AbortSignal.any([controller.signal, AbortSignal.timeout(30000)]),
    )
      .then((map) => {
        if (!controller.signal.aborted)
          setResult({ key, map, distanceKm: maxVisibleDistanceKm(map.cells) })
      })
      .catch(() => {
        if (!controller.signal.aborted) setResult({ key, map: null })
      })
    return () => controller.abort()
  }, [key, lat, lon, observer])
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
              ? '착륙 시각의 태양 방향을 불러오는 중입니다'
              : sun.kind === 'error'
                ? '착륙 시각의 태양 방향을 불러오지 못했습니다. 누르면 다시 시도합니다'
                : '착륙 시각의 태양으로 조명과 지형 그림자를 그립니다'
          }
          onClick={() => {
            if (sun.kind === 'error') sun.retry()
            else setPhoto((value) => !value)
          }}
        >
          {sun.kind === 'error'
            ? '햇빛 다시 시도'
            : lit
              ? '사진으로 보기'
              : '착륙 시각 햇빛'}
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
          높이 2 m
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
                <br />
                <span className="text-amber-400">⊙ 관측점</span>　
                <span className="text-green-400">● 보임</span>　
                <span className="text-red-400">● 가려짐</span>
                <div>수평 시선 15° 간격 · 주황색 끝점은 첫 지형 충돌</div>
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
