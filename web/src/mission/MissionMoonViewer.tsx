import {
  fetchViewshed,
  GRID_TARGET_COUNT,
  visibleGridCount,
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
  traverseAt,
  type Company,
  type EquipmentSky,
} from './demoEquipment'
import type { Vector3 } from '../moon/sun'
import type { CandidateSite, MissionSelection } from './types'
import type { SunPathResult } from './useSunPath'
import type { VisibleCount } from './useVisibleCounts'
import { ViewshedPanel, type ViewshedResult } from './ViewshedPanel'
import { EMPTY_SKY, useEquipmentSky } from './useEquipmentSky'

// A side view leaves enough space to see the unit cross the terrain.
const FOLLOW_RANGE_M = 50
const FOLLOW_PITCH_DEG = -32

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

/** Adapts the shared Moon scene to the mission HUD's selection and its toolbar of 3D controls. */
export function MissionMoonViewer({
  ref,
  selection,
  sites,
  onSelect,
  demName,
  heights,
  height,
  setHeight,
  visibleCounts,
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
  /** The grid targets each of `sites` sees from `height`, in the same order. */
  visibleCounts: readonly VisibleCount[]
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
  const [showViewshed, setShowViewshed] = useState(true)
  const [detail, setDetail] = useState(false)
  const [attempt, retry] = useState(0)
  const lat = detail ? (observer?.lat ?? selected?.latitude) : undefined
  const lon = detail ? (observer?.lon ?? selected?.longitude) : undefined
  const center = selected?.grid
  const key = JSON.stringify([lat, lon, height, center, attempt, demName])
  const [result, setResult] = useState<
    ({ key: string } & ViewshedResult) | null
  >(null)
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
  // The viewshed panel is opened from the toolbar and stays open while the Moon is used.
  const [viewshedOpen, setViewshedOpen] = useState(false)
  const [equipmentView, setEquipmentView] = useState(false)
  const [travelM, setTravelM] = useState<number | null>(null)
  const [waypoint, setWaypoint] = useState(0)
  const frame = useRef(0)
  const stopDrive = () => {
    setEquipmentView(false)
    setTravelM(null)
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
  const routeKey = JSON.stringify([selected?.id, operatorId])
  const [shownRoute, setShownRoute] = useState(routeKey)
  if (shownRoute !== routeKey) {
    setShownRoute(routeKey)
    setTravelM(null)
    setWaypoint(0)
    setEquipmentView(false)
  }
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
      sky: EMPTY_SKY,
      progress: 0,
    }
    if (!selected) viewer.current?.setAssets([])
    draw()
  }, [selected, operator, draw])

  useEffect(() => {
    drive.current.sky = measured
    draw()
  }, [measured, selected, operator, draw])

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
    viewer.current?.releaseFollow()
    setEquipmentView(true)
    drive.current.progress = 0
    const duration = driveDurationMs(mobile)
    const length = pathLength(mobile.path)
    let lastReport = 0
    setTravelM(0)
    const started = performance.now()
    const step = (now: number) => {
      const progress = Math.min(1, (now - started) / duration)
      if (now - lastReport > 200 || progress === 1) {
        setTravelM(length * progress)
        setWaypoint(traverseAt(mobile.path, progress).waypoint)
        lastReport = now
      }
      drive.current.progress = progress
      const unit = draw()
      if (unit)
        viewer.current?.follow(
          unit.id,
          FOLLOW_RANGE_M,
          FOLLOW_PITCH_DEG,
          unit.headingDeg ?? 0,
        )
      if (progress < 1) frame.current = requestAnimationFrame(step)
      // Keep the final vehicle pose and camera framing until the next user action.
    }
    frame.current = requestAnimationFrame(step)
  }

  const totalM = mobile ? pathLength(mobile.path) : 0
  const shownUnit = mobile?.spec ?? operator.statics[0]
  const earth =
    shownUnit?.id === mobile?.spec.id
      ? measured.waypoints[waypoint]?.earth
      : shownUnit && measured.statics[shownUnit.id]?.earth

  const unitCount = operator.statics.length + (mobile ? 1 : 0)
  // Loading and failure always have to show. The summary is only useful next to the
  // controls it describes, so it goes away with them.
  const status =
    sky.kind === 'loading' ? (
      <span role="status">
        {operator.name} · {unitCount} units · computing Earth and Sun visibility
        per position…
      </span>
    ) : sky.kind === 'error' ? (
      <span role="alert" className="text-red-300">
        Could not load equipment visibility.
      </span>
    ) : sunMoving && selected ? (
      'Playing · equipment visibility is computed once it stops.'
    ) : sky.kind === 'idle' ? (
      selected ? (
        'Equipment visibility is computed after the candidate analysis.'
      ) : (
        'Select a candidate to place equipment.'
      )
    ) : showControls ? (
      <>
        {sky.missing > 0 ? (
          <span role="alert" className="text-red-300">
            {sky.missing} positions failed ·{' '}
          </span>
        ) : null}
        {operator.tagline} · {unitCount} units
        {mobile
          ? ` · drive ${Math.round(pathLength(mobile.path))} m, real ${mobile.speedMS} m/s played at ${DEMO_SPEED_SCALE}×`
          : ''}
      </>
    ) : sky.missing > 0 ? (
      <span role="alert" className="text-red-300">
        Earth and Sun visibility could not be computed for {sky.missing}{' '}
        positions.
      </span>
    ) : null
  // The point whose viewshed the Moon shows: only while it is looked at in 3D.
  const viewshedPoint =
    !equipmentView && detail && lat !== undefined && lon !== undefined
      ? {
          name: observer ? 'Map point' : (selected?.name ?? 'Selected point'),
          lat,
          lon,
        }
      : null
  const viewshedCount = current?.map ? visibleGridCount(current.map) : null
  const viewshedSummary = !viewshedPoint
    ? 'Viewshed'
    : !current
      ? 'Viewshed computing…'
      : viewshedCount === null
        ? 'Viewshed'
        : `Viewshed ${viewshedCount}/${GRID_TARGET_COUNT} · ${height} m`
  return (
    <>
      <div
        className="absolute inset-0"
        aria-label="3D map of the lunar south pole"
      >
        <MoonViewer
          ref={viewer}
          viewshed={
            !equipmentView && detail && showViewshed ? current?.map : null
          }
          markers={equipmentView ? undefined : markers}
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
      <div className="pointer-events-none absolute bottom-10 left-1/2 z-10 flex w-max max-w-[calc(100vw-624px)] -translate-x-1/2 flex-col items-center gap-2 max-xl:bottom-20 max-xl:max-w-[calc(100vw-32px)]">
        {viewshedOpen ? (
          <ViewshedPanel
            id="viewshedPanel"
            point={viewshedPoint}
            heights={heights}
            height={height}
            onHeightChange={setHeight}
            showViewshed={showViewshed}
            onShowViewshedChange={setShowViewshed}
            result={current}
            onRetry={() => retry((n) => n + 1)}
            sites={sites}
            counts={visibleCounts}
            selectedSiteId={selection.siteId}
            onSelectSite={(siteId) => {
              const site = sites.find((candidate) => candidate.id === siteId)
              if (!site) return
              onSelect(siteId)
              focusSite(site)
            }}
          />
        ) : null}
        {status ? (
          <p className="hud-panel pointer-events-auto max-w-72 px-2 py-1 text-center text-[10px] leading-snug text-neutral-400">
            {status}
            {(sky.kind === 'error' ||
              (sky.kind === 'ready' && sky.missing > 0)) && (
              <button
                className="hud-button"
                onClick={() => retrySky((n) => n + 1)}
              >
                Retry equipment analysis
              </button>
            )}
          </p>
        ) : null}
        {selected && mobile && travelM !== null && (
          <span className="hud-panel px-2 text-xs">
            Distance {Math.round(travelM)} m / {Math.round(totalM)} m
            {travelM === totalM && ' · arrived'}
          </span>
        )}
        {sights && selected && shownUnit && (
          <div
            className="hud-panel w-max max-w-full px-3 py-2 text-xs"
            aria-label="Equipment Earth direction"
          >
            {shownUnit.label} · Earth direction{' '}
            {earth ? (
              <span
                className={earth.visible ? 'text-green-300' : 'text-red-300'}
              >
                <span
                  aria-hidden="true"
                  className="inline-block"
                  style={{ transform: `rotate(${earth.azimuthDeg}deg)` }}
                >
                  ↑
                </span>{' '}
                {earth.azimuthDeg.toFixed(1)}° from north · elevation{' '}
                {earth.elevationDeg.toFixed(1)}° ·{' '}
                {earth.visible ? 'Earth visible' : 'hidden by terrain'}
              </span>
            ) : sky.kind === 'loading' ? (
              'computing'
            ) : (
              'no measurement'
            )}
          </div>
        )}
        <div
          role="toolbar"
          aria-label="3D view"
          className="pointer-events-auto flex max-w-full gap-2 overflow-x-auto whitespace-nowrap *:shrink-0"
        >
          {showControls ? (
            <label className="hud-button flex items-center gap-2">
              <span className="text-neutral-400">Operator</span>
              <select
                aria-label="Operator whose equipment is placed"
                className="bg-transparent outline-none"
                value={operatorId}
                onChange={(event) => {
                  stopDrive()
                  setPickedOperatorId(event.target.value)
                }}
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
                ? 'Loading the Sun direction over the mission'
                : sun.kind === 'error'
                  ? 'Could not load the Sun direction over the mission. Click to retry'
                  : 'Lights the Moon and casts terrain shadows from the Sun at the review time (the landing time until one is chosen)'
            }
            onClick={() => {
              if (sun.kind === 'error') sun.retry()
              else onPhotoChange(!photo)
            }}
          >
            {sun.kind === 'error'
              ? 'Retry sunlight'
              : lit
                ? 'Show photo'
                : 'Show sunlight'}
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
            Top view
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
            View selected point in 3D
          </button>
          <button
            type="button"
            className="hud-button"
            aria-pressed={sights}
            title="Shows the direction to Earth and where it meets the displayed terrain. Colours follow the analysis horizon."
            onClick={() => setSights((shown) => !shown)}
          >
            {sights ? 'Hide Earth direction' : 'Show Earth direction'}
          </button>
          {showControls || (selected && mobile) ? (
            <button
              type="button"
              className="hud-button"
              disabled={!selected || !mobile}
              title={
                mobile ? undefined : `${operator.name} has no mobile equipment`
              }
              onClick={runDrive}
            >
              {mobile ? `Drive ${mobile.spec.label}` : 'No mobile equipment'}
            </button>
          ) : null}
          <button
            type="button"
            className="hud-button"
            aria-expanded={viewshedOpen}
            aria-controls="viewshedPanel"
            title="Observer height, sightlines and viewshed comparison across candidates"
            onClick={() => setViewshedOpen((open) => !open)}
          >
            {viewshedSummary}{' '}
            <span aria-hidden="true">{viewshedOpen ? '▾' : '▴'}</span>
          </button>
        </div>
      </div>
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
