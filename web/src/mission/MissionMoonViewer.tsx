import {
  fetchViewshed,
  GRID_TARGET_COUNT,
  visibleGridCount,
  type Viewshed,
} from '../api/viewshed'
import {
  useCallback,
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
import {
  COMPANIES,
  DEFAULT_COMPANY_ID,
  DEMO_SPEED_SCALE,
  buildEquipmentAssets,
  companyById,
  driveDurationMs,
  pathLength,
  type Company,
  type EquipmentSky,
} from './demoEquipment'
import type { Vector3 } from '../moon/sun'
import type { CandidateSite, MissionSelection } from './types'
import type { SunPathResult } from './useSunPath'
import { EMPTY_SKY, useEquipmentSky } from './useEquipmentSky'

/**
 * The camera rides behind the moving unit while it drives. A 2.4 m machine is three
 * pixels wide from the far side of the site, so the only way to watch it work is to
 * go with it; the badges carry the other units while it is away.
 */
const FOLLOW_RANGE_M = 45
const FOLLOW_PITCH_DEG = -15

export interface MissionMoonViewerHandle {
  focusSite(siteId: string): void
  /** Lights the Moon from a Sun that is still moving (`sunMoving`), one call per frame. */
  previewSun(direction: Vector3): void
}

/**
 * Which operator's equipment stands on the surface. The plan is for the signed-in
 * account to decide, so it is an input rather than a control on the map: pass
 * `operatorId` and nothing is shown to change it.
 *
 * Until login exists, an `?operator=` parameter stands in. Its presence also reveals
 * the picker and the drive button, which are there to work and demo with and are not
 * part of the product's own screen.
 */
function operatorParam(): string | null {
  return new URLSearchParams(window.location.search).get('operator')
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
  operatorId: givenOperatorId,
  sunDirection,
  siteAnalysisLoading,
  reviewDays,
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
  siteAnalysisLoading: boolean
  reviewDays: number
  sunMoving: boolean
  /** Show the photo instead of the sunlight. */
  photo: boolean
  onPhotoChange: (photo: boolean) => void
  /** The account's operator once there is one. Supplying it hides the picker. */
  operatorId?: string
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
  const [showSightlines, setShowSightlines] = useState(true)
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
  const frame = useRef(0)
  const stopDrive = () => {
    cancelAnimationFrame(frame.current)
    viewer.current?.releaseFollow()
  }
  const focusSite = (site: CandidateSite) => {
    stopDrive()
    setPicked(null)
    setDetail(true)
    viewer.current?.flyTo(
      { lat: site.latitude, lon: site.longitude },
      detail ? 18000 : site.grid ? site.grid.spacing_m * 20 : undefined,
    )
  }
  useImperativeHandle(ref, () => ({
    focusSite(siteId) {
      const site = sites.find((candidate) => candidate.id === siteId)
      if (site) focusSite(site)
    },
    previewSun(direction) {
      viewer.current?.previewSunDirection(direction)
    },
  }))

  // "Company" already means a delivery provider elsewhere in this app, so the operator
  // whose equipment stands on the surface is called that instead.
  const [sights, setSights] = useState(true)
  useEffect(() => {
    viewer.current?.setSightsVisible(sights)
  }, [sights])
  const [asked] = useState(operatorParam)
  const [pickedOperatorId, setPickedOperatorId] = useState(() =>
    COMPANIES.some((company) => company.id === asked)
      ? (asked ?? DEFAULT_COMPANY_ID)
      : DEFAULT_COMPANY_ID,
  )
  const operatorId = givenOperatorId ?? pickedOperatorId
  const operator = companyById(operatorId)
  /** The map carries no operator controls of its own; `?operator=` brings them back. */
  const showControls = givenOperatorId === undefined && asked !== null
  const [skyAttempt, retrySky] = useState(0)
  const instant = new Date(
    Date.parse(selection.landing + 'T00:00:00Z') +
      Math.round(reviewDays * 86400) * 1000,
  )
    .toISOString()
    .replace('.000Z', 'Z')
  const sky = useEquipmentSky(
    sunMoving || siteAnalysisLoading ? undefined : selected,
    instant,
    operator,
    skyAttempt,
  )
  const measured = 'sky' in sky ? sky.sky : EMPTY_SKY
  const { mobile } = operator

  // The drive redraws every frame, so its state lives in a ref and goes straight to
  // Cesium. React only renders the controls and the status line.
  const drive = useRef<{
    site: CandidateSite | undefined
    operator: Company
    sky: EquipmentSky
    progress: number
  }>({ site: undefined, operator, sky: EMPTY_SKY, progress: 0 })

  /** Redraws the set and hands back the mobile unit, which is the one that moves. */
  const draw = useCallback(() => {
    const { site, operator: shown, sky: measured, progress } = drive.current
    if (!site) return undefined
    const assets = buildEquipmentAssets(shown, site, progress, measured)
    viewer.current?.setAssets(assets)
    return shown.mobile ? assets.at(-1) : undefined
  }, [])

  useEffect(() => {
    cancelAnimationFrame(frame.current)
    viewer.current?.releaseFollow()
    if (drive.current.site?.id !== selected?.id) viewer.current?.setAssets([])
    drive.current = {
      site: selected,
      operator,
      sky: measured,
      progress: 0,
    }
    if (!selected) viewer.current?.setAssets([])
    draw()
  }, [selected, operator, measured, draw])

  useEffect(
    () => () => {
      cancelAnimationFrame(frame.current)
      viewer.current?.releaseFollow()
    },
    [],
  )

  const runDrive = () => {
    if (!selected || !mobile) return
    cancelAnimationFrame(frame.current)
    drive.current.progress = 0
    const duration = driveDurationMs(mobile)
    const started = performance.now()
    const step = (now: number) => {
      const progress = Math.min(1, (now - started) / duration)
      drive.current.progress = progress
      const unit = draw()
      if (unit)
        viewer.current?.follow(
          unit.location,
          FOLLOW_RANGE_M,
          FOLLOW_PITCH_DEG,
          unit.headingDeg ?? 0,
        )
      if (progress < 1) frame.current = requestAnimationFrame(step)
      else viewer.current?.releaseFollow()
    }
    frame.current = requestAnimationFrame(step)
  }

  const unitCount = operator.statics.length + (mobile ? 1 : 0)
  // Loading and failure always have to show. The summary is only useful next to the
  // controls it describes, so it goes away with them.
  const status =
    sky.kind === 'loading' ? (
      <span role="status">
        {operator.name} 장비 {unitCount}대 · 지점별 지구·태양 가시성 계산 중…
      </span>
    ) : sky.kind === 'error' ? (
      <span role="alert" className="text-red-300">
        장비 지점 가시성을 불러오지 못했습니다.
      </span>
    ) : sunMoving && selected ? (
      '재생 중 · 정지하면 장비 가시성을 계산합니다.'
    ) : sky.kind === 'idle' ? (
      selected ? (
        '후보 분석 후 장비 가시성을 계산합니다.'
      ) : (
        '후보를 선택하면 장비를 배치합니다.'
      )
    ) : showControls ? (
      <>
        {sky.missing > 0 ? (
          <span role="alert" className="text-red-300">
            {sky.missing}개 지점 계산 실패 ·{' '}
          </span>
        ) : null}
        {operator.tagline} · 장비 {unitCount}대
        {mobile
          ? ` · 주행 ${Math.round(pathLength(mobile.path))} m, 실제 ${mobile.speedMS} m/s를 ${DEMO_SPEED_SCALE}배속으로 재생`
          : ''}
      </>
    ) : sky.missing > 0 ? (
      <span role="alert" className="text-red-300">
        {sky.missing}개 지점의 지구·태양 가시성을 계산하지 못했습니다.
      </span>
    ) : null
  return (
    <>
      <div className="absolute inset-0" aria-label="달 남극 3D 지도">
        <MoonViewer
          ref={viewer}
          showSightlines={showSightlines}
          viewshed={detail ? current?.map : null}
          markers={markers}
          selectedMarkerId={selection.siteId}
          onPick={(location) => {
            stopDrive()
            onSelect(null)
            setPicked(location)
            viewer.current?.flyTo(location, 18000)
            setDetail(true)
          }}
          onMarkerSelect={(siteId) => {
            const site = sites.find((candidate) => candidate.id === siteId)
            if (!site) return
            onSelect(siteId)
            focusSite(site)
          }}
        />
      </div>
      <div className="absolute right-4 top-4 flex flex-col items-end gap-2">
        <div className="flex flex-wrap justify-end gap-2">
          {showControls ? (
            <label className="hud-button flex items-center gap-2">
              <span className="text-neutral-400">운영사</span>
              <select
                aria-label="장비를 배치할 운영사"
                className="bg-transparent outline-none"
                value={operatorId}
                onChange={(event) => setPickedOperatorId(event.target.value)}
              >
                {COMPANIES.map((option) => (
                  <option
                    key={option.id}
                    value={option.id}
                    className="bg-neutral-900"
                  >
                    {option.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
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
              stopDrive()
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
              stopDrive()
              setDetail(true)
              const location =
                observer ??
                (selected && {
                  lat: selected.latitude,
                  lon: selected.longitude,
                })
              if (location) viewer.current?.flyTo(location, 18000)
            }}
          >
            선택 지점 3D로 보기
          </button>
          <button
            type="button"
            className="hud-button"
            aria-pressed={sights}
            title="지구 방향과 현재 표시된 지형과의 교차를 표시합니다. 색상은 분석 지평선 기준입니다."
            onClick={() => setSights((shown) => !shown)}
          >
            {sights ? '지구 방향 끄기' : '지구 방향 켜기'}
          </button>
          {showControls ? (
            <button
              type="button"
              className="hud-button"
              disabled={!selected || !mobile || sky.kind !== 'ready'}
              title={
                mobile
                  ? undefined
                  : `${operator.name}에는 움직이는 장비가 없습니다`
              }
              onClick={runDrive}
            >
              {mobile ? `${mobile.spec.label} 주행` : '주행 장비 없음'}
            </button>
          ) : null}
        </div>
        {status ? (
          <p className="hud-panel max-w-72 px-2 py-1 text-right text-[10px] leading-snug text-neutral-400">
            {status}
            {(sky.kind === 'error' ||
              (sky.kind === 'ready' && sky.missing > 0)) && (
              <button
                className="hud-button"
                onClick={() => retrySky((n) => n + 1)}
              >
                장비 분석 다시 시도
              </button>
            )}
          </p>
        ) : null}
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
          <label className="ml-3 inline-flex items-center gap-1">
            <input
              type="checkbox"
              checked={showSightlines}
              onChange={(event) => setShowSightlines(event.target.checked)}
            />
            가시선 표시
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
