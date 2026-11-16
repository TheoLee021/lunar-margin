/** Time-tagged lunar-flight overlay; MOON_ME Cartesian metres, no geodetic conversions. */
import {
  ArcType,
  BoundingSphere,
  Cartesian3,
  Color,
  ConstantPositionProperty,
  type Entity,
  type Viewer,
} from 'cesium'
import type { FlightPoint } from '../flight/flightData'

export interface FlightLayer {
  setPath(points: readonly FlightPoint[]): void
  setFrame(index: number): void
  destroy(): void
}

export function createFlightLayer(viewer: Viewer): FlightLayer {
  const entities: Entity[] = []
  let cursor: Entity | undefined
  let samples: readonly FlightPoint[] = []

  const clear = () => {
    for (const entity of entities) viewer.entities.remove(entity)
    entities.length = 0
    cursor = undefined
  }

  const cartesian = (xyz: readonly number[]) =>
    new Cartesian3(xyz[0]!, xyz[1]!, xyz[2]!)

  return {
    setPath(points) {
      clear()
      samples = points
      for (const phase of [
        'PARKING_COAST',
        'DOI_COAST',
        'POWERED_DESCENT',
      ] as const) {
        const locations = points
          .filter((point) => point.phase === phase)
          .map((point) => cartesian(point.moonMe))
        if (locations.length < 2) continue
        const material =
          phase === 'POWERED_DESCENT'
            ? Color.ORANGE
            : phase === 'DOI_COAST'
              ? Color.AQUAMARINE
              : Color.CYAN
        entities.push(
          viewer.entities.add({
            polyline: {
              positions: locations,
              arcType: ArcType.NONE,
              width: phase === 'POWERED_DESCENT' ? 4 : 2.5,
              material,
              depthFailMaterial: material,
            },
          }),
        )
      }
      if (!samples.length) return
      const bounds = BoundingSphere.fromPoints(
        samples.map((point) => cartesian(point.moonMe)),
      )
      viewer.camera.flyToBoundingSphere(bounds, { duration: 0.8 })
      cursor = viewer.entities.add({
        position: cartesian(samples[0]!.moonMe),
        point: {
          pixelSize: 11,
          color: Color.YELLOW,
          outlineColor: Color.BLACK,
          outlineWidth: 2,
          disableDepthTestDistance: Infinity,
        },
      })
      entities.push(cursor)
    },
    setFrame(index) {
      const point = samples[index]
      if (!cursor || !point) return
      cursor.position = new ConstantPositionProperty(cartesian(point.moonMe))
    },
    destroy() {
      clear()
    },
  }
}
