import {
  Cartesian2,
  Cartesian3,
  Color,
  ConstantProperty,
  ConstantPositionProperty,
  CustomDataSource,
  Entity,
  HeightReference,
  type Billboard,
  type Label,
  type PointPrimitive,
  type Viewer,
} from 'cesium'
import type { LunarLocation } from './location'
import clusterBadge from './cluster-badge.svg?raw'
import { createGridFootprint } from './gridFootprint'

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
  /** Cluster members at their terrain anchors, for zooming without changing selection. */
  clusterPositionsOf(picked: unknown): Cartesian3[] | undefined
  destroy(): void
}

export function createMarkerLayer(viewer: Viewer): MarkerLayer {
  const source = new CustomDataSource('candidate-markers')
  source.clustering.pixelRange = 32
  source.clustering.minimumClusterSize = 2
  source.clustering.clusterPoints = false
  source.clustering.clusterBillboards = false
  source.clustering.clusterEvent.addEventListener(
    (
      members: Entity[],
      cluster: { billboard: Billboard; label: Label; point: PointPrimitive },
    ) => {
      cluster.point.show = false
      cluster.billboard.show = true
      cluster.billboard.id = members
      cluster.billboard.image = `data:image/svg+xml,${encodeURIComponent(
        clusterBadge.replace('CANDIDATE_COUNT', String(members.length)),
      )}`
      cluster.billboard.position = cluster.label.position
      cluster.billboard.pixelOffset = new Cartesian2(0, -14)
      cluster.billboard.disableDepthTestDistance = Number.POSITIVE_INFINITY
      cluster.label.show = false
    },
  )
  void viewer.dataSources.add(source)
  const entities = new Map<string, Entity>()
  const footprints = new Map<string, ReturnType<typeof createGridFootprint>>()
  const removeUpdate = viewer.scene.preRender.addEventListener(() => {
    for (const footprint of footprints.values()) footprint.update()
  })
  let selectedId: string | null = null

  const paintSelection = () => {
    for (const [id, entity] of entities) {
      if (!entity.label) continue
      const color = id === selectedId ? SELECTED_LABEL_BACKGROUND : POINT_COLOR
      footprints.get(id)?.setStyle(color, id === selectedId ? 0.45 : 0.25)
      entity.label.backgroundColor = new ConstantProperty(
        id === selectedId ? SELECTED_LABEL_BACKGROUND : LABEL_BACKGROUND,
      )
    }
  }

  return {
    setMarkers(markers) {
      for (const footprint of footprints.values()) footprint.destroy()
      footprints.clear()
      source.entities.removeAll()
      entities.clear()
      source.clustering.enabled = markers.some((marker) => marker.footprint)
      const anchors: { entity: Entity; position: Cartesian3 }[] = []
      for (const marker of markers) {
        const corners = marker.footprint?.map((point) =>
          Cartesian3.fromDegrees(point.lon, point.lat),
        )
        const entity = source.entities.add({
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
          footprints.set(
            marker.id,
            createGridFootprint(viewer, entity, corners, POINT_COLOR),
          )
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
    clusterPositionsOf(picked) {
      if (typeof picked !== 'object' || picked === null || !('id' in picked))
        return undefined
      const members: unknown = picked.id
      if (!Array.isArray(members)) return undefined
      const owned = new Set(entities.values())
      const positions = members.flatMap((member: unknown) => {
        if (!(member instanceof Entity) || !owned.has(member)) return []
        const position = member.position?.getValue(viewer.clock.currentTime)
        return position ? [position] : []
      })
      return positions.length >= 2 ? positions : undefined
    },
    destroy() {
      removeUpdate()
      for (const footprint of footprints.values()) footprint.destroy()
      footprints.clear()
    },
  }
}
