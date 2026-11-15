import {
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
import type { Vector3 } from '../moon/sun'
import type { CandidateSite, MissionSelection } from './types'

export interface MissionMoonViewerHandle {
  focusSite(siteId: string): void
}

/** Adapts the shared Moon scene to the mission HUD's selection and camera buttons. */
export function MissionMoonViewer({
  ref,
  selection,
  sites,
  onSelect,
  sunDirection,
}: {
  ref?: Ref<MissionMoonViewerHandle>
  selection: MissionSelection
  sites: readonly CandidateSite[]
  onSelect: (siteId: string) => void
  /** Moon-to-Sun direction (MOON_ME) at the shown time, or null while it is unknown. */
  sunDirection: Vector3 | null
}) {
  const viewer = useRef<MoonViewerHandle>(null)
  const [photo, setPhoto] = useState(false)
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
      <div className="absolute right-4 top-4 flex gap-2">
        <button
          type="button"
          className="hud-button"
          disabled={sunDirection === null}
          aria-pressed={lit}
          title="착륙 시각의 태양으로 조명과 지형 그림자를 그립니다"
          onClick={() => setPhoto((value) => !value)}
        >
          {lit ? '사진으로 보기' : '착륙 시각 햇빛'}
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
      </div>
    </>
  )
}
