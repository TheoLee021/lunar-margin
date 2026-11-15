import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import MoonViewer, { type MoonViewerHandle } from '../moon/MoonViewer'
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

/**
 * The camera rides behind the moving unit while it drives. A 2.4 m machine is three
 * pixels wide from the far side of the site, so the only way to watch it work is to
 * go with it; the badges carry the other units while it is away.
 */
const FOLLOW_RANGE_M = 45
const FOLLOW_PITCH_DEG = -15
/** Sit behind the machine, looking the way it is going. */
const FOLLOW_BEHIND_DEG = 180

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
  const [companyId, setCompanyId] = useState(DEFAULT_COMPANY_ID)
  const company = companyById(companyId)
  const sky = useEquipmentSky(selected, selection, company)
  const { mobile } = company

  // The drive redraws every frame, so its state lives in a ref and goes straight to
  // Cesium. React only renders the controls and the status line.
  const traverse = useRef<{
    site: CandidateSite | undefined
    company: Company
    sky: EquipmentSky
    progress: number
  }>({
    site: undefined,
    company,
    sky: EMPTY_SKY,
    progress: 0,
  })
  const frame = useRef(0)

  /** Redraws the set and hands back the mobile unit, which is the one that moves. */
  const draw = useCallback(() => {
    const { site, company: shown, sky: measured, progress } = traverse.current
    if (!site) return undefined
    const assets = buildEquipmentAssets(shown, site, progress, measured)
    viewer.current?.setAssets(assets)
    return shown.mobile ? assets.at(-1) : undefined
  }, [])

  useEffect(() => {
    cancelAnimationFrame(frame.current)
    viewer.current?.releaseFollow()
    traverse.current = {
      site: selected,
      company,
      sky: sky.kind === 'ready' ? sky.sky : EMPTY_SKY,
      progress: 0,
    }
    if (!selected) viewer.current?.setAssets([])
    draw()
  }, [selected, company, sky, draw])

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
    traverse.current.progress = 0
    const duration = driveDurationMs(mobile)
    const started = performance.now()
    const step = (now: number) => {
      const progress = Math.min(1, (now - started) / duration)
      traverse.current.progress = progress
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
          <label className="hud-button flex items-center gap-2">
            <span className="text-neutral-400">회사</span>
            <select
              aria-label="장비를 배치할 회사"
              className="bg-transparent outline-none"
              value={companyId}
              onChange={(event) => setCompanyId(event.target.value)}
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
            disabled={!selected || !mobile || sky.kind !== 'ready'}
            title={
              mobile
                ? undefined
                : `${company.name}에는 움직이는 장비가 없습니다`
            }
            onClick={runDrive}
          >
            {mobile ? `${mobile.spec.label} 주행` : '주행 장비 없음'}
          </button>
        </div>
        <p className="hud-panel max-w-72 px-2 py-1 text-right text-[10px] leading-snug text-neutral-400">
          {sky.kind === 'loading' ? (
            <span role="status">
              {company.name} 장비 {company.statics.length + (mobile ? 1 : 0)}대
              · 지점별 지구 가시성 계산 중…
            </span>
          ) : sky.kind === 'error' ? (
            <span role="alert" className="text-red-300">
              장비 지점 가시성을 불러오지 못했습니다. 다른 후보나 회사를 고르면
              다시 계산합니다.
            </span>
          ) : sky.kind === 'ready' ? (
            <>
              {sky.missing > 0 ? (
                <span role="alert" className="text-red-300">
                  {sky.missing}개 지점 계산 실패 ·{' '}
                </span>
              ) : null}
              {company.tagline} · 장비{' '}
              {company.statics.length + (mobile ? 1 : 0)}대
              {mobile
                ? ` · 주행 ${Math.round(pathLength(mobile.path))} m, 실제 ${mobile.speedMS} m/s를 ${DEMO_SPEED_SCALE}배속으로 재생`
                : ''}
            </>
          ) : (
            '후보를 선택하면 장비를 배치합니다.'
          )}
        </p>
      </div>
    </>
  )
}
