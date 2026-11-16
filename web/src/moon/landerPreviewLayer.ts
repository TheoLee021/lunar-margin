/** Static, illustrative lunar-lander geometry at a chosen surface site.
 * Not a flown vehicle, touchdown result, or substitute for flight playback.
 * Every part is placed in the local east/north/up frame after clamping
 * the anchor to the visible Cesium Moon 3D tiles.
 */
import {
  Cartesian3,
  Color,
  Ellipsoid,
  Matrix4,
  Transforms,
  type Entity,
  type Viewer,
} from 'cesium'
import type { LunarLocation } from './location'

export interface LanderPreviewLayer {
  setSite(site: LunarLocation | null): void
  destroy(): void
}

export function createLanderPreviewLayer(viewer: Viewer): LanderPreviewLayer {
  const parts: Entity[] = []
  let generation = 0

  const clear = () => {
    for (const part of parts) viewer.entities.remove(part)
    parts.length = 0
  }

  const draw = (anchor: Cartesian3) => {
    const local = Transforms.eastNorthUpToFixedFrame(anchor, Ellipsoid.MOON)
    const at = (east: number, north: number, up: number) =>
      Matrix4.multiplyByPoint(
        local,
        new Cartesian3(east, north, up),
        new Cartesian3(),
      )
    const addBox = (
      east: number,
      north: number,
      up: number,
      x: number,
      y: number,
      z: number,
      color: Color,
    ) => {
      parts.push(
        viewer.entities.add({
          position: at(east, north, up),
          box: { dimensions: new Cartesian3(x, y, z), material: color },
        }),
      )
    }
    const addCylinder = (
      east: number,
      north: number,
      up: number,
      height: number,
      radius: number,
      color: Color,
    ) => {
      parts.push(
        viewer.entities.add({
          position: at(east, north, up),
          cylinder: {
            length: height,
            topRadius: radius,
            bottomRadius: radius,
            material: color,
          },
        }),
      )
    }

    // Simple 5 m wide conceptual robotic lander, not a CLPS vehicle model.
    addBox(0, 0, 2.8, 2.8, 2.8, 1.6, Color.SILVER)
    addCylinder(0, 0, 4.0, 0.8, 0.9, Color.GOLD)
    for (const east of [-1.9, 1.9]) {
      for (const north of [-1.9, 1.9]) {
        addCylinder(east, north, 1.1, 2.2, 0.12, Color.LIGHTGRAY)
        addCylinder(east, north, 0.12, 0.2, 0.52, Color.DARKGRAY)
      }
    }
    addBox(0, 0, 1.75, 4.5, 0.16, 0.16, Color.GRAY)
    addBox(0, 0, 1.75, 0.16, 4.5, 0.16, Color.GRAY)
  }

  return {
    setSite(site) {
      const request = ++generation
      clear()
      if (!site || !viewer.scene.clampToHeightSupported) return
      const approximate = Cartesian3.fromDegrees(
        site.lon,
        site.lat,
        0,
        Ellipsoid.MOON,
      )
      void viewer.scene
        .clampToHeightMostDetailed([approximate])
        .then(([ground]) => {
          if (request !== generation || viewer.isDestroyed() || !ground) return
          draw(ground)
        })
        .catch(() => {
          // Never present a made-up surface height as an actual tile placement.
        })
    },
    destroy() {
      generation++
      clear()
    },
  }
}
