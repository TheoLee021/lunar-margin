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
import { gridCellCorners } from '../moon/location'
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
import type { CandidateSite, MissionSelection } from './types'
import { EMPTY_SKY, useEquipmentSky } from './useEquipmentSky'
import type { SunDirectionResult } from './useSunDirection'

/**
 * The camera rides behind the moving unit while it drives. A 2.4 m machine is three
 * pixels wide from the far side of the site, so the only way to watch it work is to
 * go with it; the badges carry the other units while it is away.
 */
const FOLLOW_RANGE_M = 45
const FOLLOW_PITCH_DEG = -15
/** Sit behind the machine, looking the way it is going. */
const FOLLOW_BEHIND_DEG = 180

export interface MissionMoonViewerHandle {
  focusSite(siteId: string): void
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
  sun,
  operatorId: givenOperatorId,
}: {
  ref?: Ref<MissionMoonViewerHandle>
  selection: MissionSelection
  sites: readonly CandidateSite[]
  onSelect: (siteId: string) => void
  /** The Sun at the shown time: its Moon-to-Sun direction (MOON_ME) once it has loaded. */
  sun: SunDirectionResult
  /** The account's operator once there is one. Supplying it hides the picker. */
  operatorId?: string
}) {
  const viewer = useRef<MoonViewerHandle>(null)
  const [photo, setPhoto] = useState(false)
  const sunDirection = sun.kind === 'ready' ? sun.direction : null
  const lit = sunDirection !== null && !photo
  useEffect(() => {
    viewer.current?.setSunDirection(lit ? sunDirection : null)
  }, [lit, sunDirection])
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
  const focusSite = (site: CandidateSite) =>
    viewer.current?.flyTo(
      { lat: site.latitude, lon: site.longitude },
      site.grid ? site.grid.spacing_m * 20 : undefined,
    )
  useImperativeHandle(ref, () => ({
    focusSite(siteId) {
      const site = sites.find((candidate) => candidate.id === siteId)
      if (site) focusSite(site)
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
  const sky = useEquipmentSky(selected, selection, operator)
  const { mobile } = operator

  // The drive redraws every frame, so its state lives in a ref and goes straight to
  // Cesium. React only renders the controls and the status line.
  const drive = useRef<{
    site: CandidateSite | undefined
    operator: Company
    sky: EquipmentSky
    progress: number
  }>({ site: undefined, operator, sky: EMPTY_SKY, progress: 0 })
  const frame = useRef(0)

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
    drive.current = {
      site: selected,
      operator,
      sky: sky.kind === 'ready' ? sky.sky : EMPTY_SKY,
      progress: 0,
    }
    if (!selected) viewer.current?.setAssets([])
    draw()
  }, [selected, operator, sky, draw])

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
          (unit.headingDeg ?? 0) + FOLLOW_BEHIND_DEG,
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
        {operator.name} 장비 {unitCount}대 · 지점별 지구 가시성 계산 중…
      </span>
    ) : sky.kind === 'error' ? (
      <span role="alert" className="text-red-300">
        장비 지점 가시성을 불러오지 못했습니다. 다른 후보를 고르면 다시
        계산합니다.
      </span>
    ) : sky.kind === 'idle' ? (
      '후보를 선택하면 장비를 배치합니다.'
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
        {sky.missing}개 지점의 지구 가시성을 계산하지 못했습니다.
      </span>
    ) : null
  return (
    <>
      <div className="absolute inset-0" aria-label="달 남극 3D 지도">
        <MoonViewer
          ref={viewer}
          markers={markers}
          selectedMarkerId={selection.siteId}
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
            aria-pressed={sights}
            title="각 장비에서 지구를 향하는 화살표를 그립니다"
            onClick={() => setSights((shown) => !shown)}
          >
            {sights ? '지구 방향 끄기' : '지구 방향 켜기'}
          </button>
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
              if (selected) focusSite(selected)
            }}
          >
            선택 지점 3D로 보기
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
          </p>
        ) : null}
      </div>
    </>
  )
}
