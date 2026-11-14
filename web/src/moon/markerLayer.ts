import {
  Cartesian2,
  Cartesian3,
  Color,
  ConstantProperty,
  Entity,
  HeightReference,
  type Viewer,
} from 'cesium'
import type { LunarLocation } from './location'

/** A labelled point on the Moon, e.g. a candidate landing site. */
export interface MoonMarker {
  id: string
  label: string
  location: LunarLocation
}

const POINT_COLOR = Color.fromCssColorString('#f0a43c')
const LABEL_BACKGROUND = Color.fromCssColorString('#15191ee6')
const SELECTED_LABEL_BACKGROUND = Color.fromCssColorString('#5aaee3')

export interface MarkerLayer {
  setMarkers(markers: readonly MoonMarker[]): void
  setSelected(id: string | null): void
  /** The marker id under a `scene.pick` result, if the pick hit one of ours. */
  markerIdOf(picked: unknown): string | undefined
}

export function createMarkerLayer(viewer: Viewer): MarkerLayer {
  const entities = new Map<string, Entity>()
  let selectedId: string | null = null

  const paintSelection = () => {
    for (const [id, entity] of entities) {
      if (!entity.label) continue
      entity.label.backgroundColor = new ConstantProperty(
        id === selectedId ? SELECTED_LABEL_BACKGROUND : LABEL_BACKGROUND,
      )
    }
  }

  return {
    setMarkers(markers) {
      for (const entity of entities.values()) viewer.entities.remove(entity)
      entities.clear()
      for (const marker of markers) {
        const entity = viewer.entities.add({
          position: Cartesian3.fromDegrees(
            marker.location.lon,
            marker.location.lat,
          ),
          point: {
            pixelSize: 7,
            color: POINT_COLOR,
            heightReference: HeightReference.CLAMP_TO_3D_TILE,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
          label: {
            text: marker.label,
            font: '600 15px monospace',
            showBackground: true,
            backgroundColor: LABEL_BACKGROUND,
            fillColor: Color.WHITE,
            heightReference: HeightReference.CLAMP_TO_3D_TILE,
            pixelOffset: new Cartesian2(0, -14),
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        })
        entities.set(marker.id, entity)
      }
      paintSelection()
    },
    setSelected(id) {
      selectedId = id
      paintSelection()
    },
    markerIdOf(picked) {
      if (typeof picked !== 'object' || picked === null || !('id' in picked))
        return undefined
      const { id: entity } = picked
      if (!(entity instanceof Entity)) return undefined
      for (const [id, candidate] of entities)
        if (candidate === entity) return id
      return undefined
    },
  }
}
