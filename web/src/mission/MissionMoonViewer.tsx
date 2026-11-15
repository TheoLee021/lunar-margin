import { useMemo, useRef } from 'react'
import MoonViewer, { type MoonViewerHandle } from '../moon/MoonViewer'
import { gridCellCorners } from '../moon/location'
import type { MoonMarker } from '../moon/markerLayer'
import type { CandidateSite, MissionSelection } from './types'

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
        footprint: site.grid ? gridCellCorners(site.grid) : undefined,
      })),
    [sites],
  )
  const selected = sites.find((site) => site.id === selection.siteId)
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
      <div className="absolute right-4 top-4 flex gap-2">
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
              viewer.current?.flyTo(
                { lat: selected.latitude, lon: selected.longitude },
                selected.grid ? selected.grid.spacing_m * 20 : undefined,
              )
          }}
        >
          선택 지점 3D로 보기
        </button>
      </div>
    </>
  )
}
