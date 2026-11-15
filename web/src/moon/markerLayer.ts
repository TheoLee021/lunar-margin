import {
  Cartesian2,
  Cartesian3,
  Color,
  ColorMaterialProperty,
  ClassificationType,
  PolygonHierarchy,
  ConstantProperty,
  ConstantPositionProperty,
  Entity,
  HeightReference,
  type Viewer,
} from 'cesium'
import type { LunarLocation } from './location'

/** A labelled point or grid footprint on the Moon. */
export interface MoonMarker {
  id: string
  label: string
  location: LunarLocation
  footprint?: readonly LunarLocation[]
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
      const color = id === selectedId ? SELECTED_LABEL_BACKGROUND : POINT_COLOR
      if (entity.polygon)
        entity.polygon.material = new ColorMaterialProperty(
          color.withAlpha(id === selectedId ? 0.45 : 0.25),
        )
      if (entity.polyline)
        entity.polyline.material = new ColorMaterialProperty(color)
      entity.label.backgroundColor = new ConstantProperty(
        id === selectedId ? SELECTED_LABEL_BACKGROUND : LABEL_BACKGROUND,
      )
    }
  }

  return {
    setMarkers(markers) {
      for (const entity of entities.values()) viewer.entities.remove(entity)
      entities.clear()
      const anchors: { entity: Entity; position: Cartesian3 }[] = []
      for (const marker of markers) {
        const corners = marker.footprint?.map((point) =>
          Cartesian3.fromDegrees(point.lon, point.lat),
        )
        const entity = viewer.entities.add({
          position: Cartesian3.fromDegrees(
            marker.location.lon,
            marker.location.lat,
          ),
          point: corners
            ? undefined
            : {
                pixelSize: 7,
                color: POINT_COLOR,
                heightReference: HeightReference.CLAMP_TO_3D_TILE,
                disableDepthTestDistance: Number.POSITIVE_INFINITY,
              },
          polygon: corners
            ? {
                hierarchy: new PolygonHierarchy(corners),
                classificationType: ClassificationType.CESIUM_3D_TILE,
                material: POINT_COLOR.withAlpha(0.25),
              }
            : undefined,
          polyline: corners
            ? {
                positions: [...corners, corners[0]!],
                width: 2,
                clampToGround: true,
                classificationType: ClassificationType.CESIUM_3D_TILE,
                material: POINT_COLOR,
              }
            : undefined,
          label: {
            show: !corners,
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
        if (corners)
          anchors.push({
            entity,
            position: Cartesian3.fromDegrees(
              marker.location.lon,
              marker.location.lat,
            ),
          })
      }
      paintSelection()
      if (anchors.length && viewer.scene.clampToHeightSupported) {
        void viewer.scene
          .clampToHeightMostDetailed(
            anchors.map((anchor) => anchor.position),
            anchors.map((anchor) => anchor.entity),
          )
          .then((positions) => {
            if (viewer.isDestroyed()) return
            positions.forEach((position, index) => {
              const anchor = anchors[index]!
              if (
                !position ||
                ![...entities.values()].includes(anchor.entity) ||
                !anchor.entity.label
              )
                return
              anchor.entity.position = new ConstantPositionProperty(position)
              anchor.entity.label.heightReference = new ConstantProperty(
                HeightReference.NONE,
              )
              anchor.entity.label.show = new ConstantProperty(true)
            })
          })
          .catch(() => {
            /* Keep geometry visible without placing labels at an incorrect height. */
          })
      }
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
