// Imperative Cesium scene for the Moon. Loaded lazily by MoonViewer; React never holds Cesium state.
import {
  BoundingSphere,
  Cartesian2,
  Cartesian3,
  Cartographic,
  CameraEventType,
  Cesium3DTileset,
  CustomShader,
  Ellipsoid,
  HeadingPitchRange,
  Ion,
  KeyboardEventModifier,
  Math as CesiumMath,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  UniformType,
  Viewer,
} from 'cesium'
import 'cesium/Build/Cesium/Widgets/widgets.css'
import { shouldFreeCameraAxis } from './camera'
import { toLunarLocation, type LunarLocation } from './location'
import { createMarkerLayer, type MoonMarker } from './markerLayer'
import { parseSunDirection } from './sun'

/** Cesium Moon Terrain (3D Tiles). The ion account must have it under My Assets, or it 404s. */
const CESIUM_MOON_ASSET_ID = 2684829

// Start straight above the south pole, framing the 85.5°S high-resolution disc with its surroundings,
// with 0° longitude at the top of the screen as on south-polar maps.
const START_HEIGHT_M = 800_000
const SITE_RANGE_M = 30_000
const OBLIQUE_PITCH = CesiumMath.toRadians(-45)
const MIN_ZOOM_DISTANCE_M = 150
const MAX_ZOOM_DISTANCE_M = 20_000_000

// Tiles ship as KHR_materials_unlit with no normals, so scene.light has no effect on them.
// Until real lighting lands this shader applies a simple Lambert term from a Sun direction,
// with face normals from screen-space derivatives. With no Sun set the photo shows as-is.
const SUN_AMBIENT = 0.08
function createMoonShader(): CustomShader {
  return new CustomShader({
    uniforms: {
      u_sunDirectionWC: {
        type: UniformType.VEC3,
        value: new Cartesian3(0, 0, 1),
      },
      u_sunLit: { type: UniformType.FLOAT, value: 0 },
    },
    fragmentShaderText: /* glsl */ `
    void fragmentMain(FragmentInput fsInput, inout czm_modelMaterial material) {
      if (u_sunLit < 0.5) return;
      vec3 positionEC = fsInput.attributes.positionEC;
      vec3 normalEC = normalize(cross(dFdx(positionEC), dFdy(positionEC)));
      normalEC = faceforward(normalEC, positionEC, normalEC);
      vec3 toSunEC = normalize(czm_viewRotation * u_sunDirectionWC);
      float lambert = max(dot(normalEC, toSunEC), 0.0);
      material.diffuse *= mix(${SUN_AMBIENT.toFixed(2)}, 1.0, lambert);
    }
  `,
  })
}

export interface MoonSceneOptions {
  ionToken: string
  signal: AbortSignal
  onPick: (location: LunarLocation) => void
  onMarkerSelect: (id: string) => void
  onHeadingChange: (headingRad: number) => void
}

export interface MoonScene {
  flyTo(location: LunarLocation, rangeM?: number): void
  /** Back to the start view: straight above the south pole. */
  flyToOverview(): void
  setMarkers(markers: readonly MoonMarker[]): void
  setSelectedMarker(id: string | null): void
  /** Moon-to-Sun unit vector in MOON_ME, or null for flat (photo-only) shading. */
  setSunDirection(direction: unknown): void
  resetNorth(): void
  destroy(): void
}

export async function createMoonScene(
  container: HTMLElement,
  options: MoonSceneOptions,
): Promise<MoonScene> {
  Ellipsoid.default = Ellipsoid.MOON
  Ion.defaultAccessToken = options.ionToken

  const viewer = new Viewer(container, {
    globe: false,
    baseLayer: false,
    skyAtmosphere: false,
    scene3DOnly: true,
    animation: false,
    baseLayerPicker: false,
    fullscreenButton: false,
    geocoder: false,
    homeButton: false,
    infoBox: false,
    navigationHelpButton: false,
    sceneModePicker: false,
    selectionIndicator: false,
    timeline: false,
  })

  const moonShader = createMoonShader()
  try {
    const tileset = await Cesium3DTileset.fromIonAssetId(CESIUM_MOON_ASSET_ID)
    options.signal.throwIfAborted()
    tileset.customShader = moonShader
    viewer.scene.primitives.add(tileset)
  } catch (error) {
    viewer.destroy()
    throw error
  }

  const { scene, camera } = viewer
  // The Moon has no atmosphere, and Cesium's Sun and Moon billboards are placed for Earth.
  scene.fog.enabled = false
  if (scene.sun) scene.sun.show = false
  if (scene.moon) scene.moon.show = false

  configureGoogleEarthControls(viewer)

  let axisFree = false
  let lastHeading = Number.NaN
  const removePreRender = scene.preRender.addEventListener(() => {
    const latitudeDeg = CesiumMath.toDegrees(
      camera.positionCartographic.latitude,
    )
    const nextFree = shouldFreeCameraAxis(latitudeDeg, axisFree)
    if (nextFree !== axisFree) {
      axisFree = nextFree
      camera.constrainedAxis = axisFree ? undefined : Cartesian3.UNIT_Z
    }
  })
  const removePostRender = scene.postRender.addEventListener(() => {
    if (Math.abs(camera.heading - lastHeading) < 1e-3) return
    lastHeading = camera.heading
    options.onHeadingChange(camera.heading)
  })

  const pickSurface = (windowPosition: Cartesian2): Cartesian3 | undefined => {
    const position = scene.pickPosition(windowPosition)
    return position && Number.isFinite(position.x) ? position : undefined
  }

  // Fly so the camera keeps its heading and pitch, looking at `target` from `range` metres.
  const flyAround = (
    target: Cartesian3,
    heading: number,
    pitch: number,
    range: number,
    duration: number,
  ) => {
    camera.flyToBoundingSphere(new BoundingSphere(target, 0), {
      offset: new HeadingPitchRange(heading, pitch, range),
      duration,
    })
  }

  const markers = createMarkerLayer(viewer)
  let flight = 0
  const handler = new ScreenSpaceEventHandler(scene.canvas)
  handler.setInputAction(
    ({ position }: ScreenSpaceEventHandler.PositionedEvent) => {
      const picked: unknown = scene.pick(position)
      const cluster = markers.clusterPositionsOf(picked)
      if (cluster) {
        flight++
        const bounds = BoundingSphere.fromPoints(cluster)
        camera.flyToBoundingSphere(bounds, {
          offset: new HeadingPitchRange(
            0,
            -CesiumMath.PI_OVER_TWO,
            Math.max(bounds.radius * 5, 5_000),
          ),
          duration: 1.2,
        })
        return
      }
      const markerId = markers.markerIdOf(picked)
      if (markerId !== undefined) {
        options.onMarkerSelect(markerId)
        return
      }
      const surface = pickSurface(position)
      if (!surface) return
      options.onPick(
        toLunarLocation(Cartographic.fromCartesian(surface, Ellipsoid.MOON)),
      )
    },
    ScreenSpaceEventType.LEFT_CLICK,
  )
  handler.setInputAction(
    ({ position }: ScreenSpaceEventHandler.PositionedEvent) => {
      const surface = pickSurface(position)
      if (!surface) return
      const range = Math.max(
        Cartesian3.distance(camera.position, surface) / 2,
        MIN_ZOOM_DISTANCE_M * 4,
      )
      flyAround(surface, camera.heading, Math.min(camera.pitch, -0.3), range, 1)
    },
    ScreenSpaceEventType.LEFT_DOUBLE_CLICK,
  )

  const overview = {
    destination: Cartesian3.fromDegrees(0, -90, START_HEIGHT_M),
    orientation: { heading: 0, pitch: -CesiumMath.PI_OVER_TWO, roll: 0 },
  }
  camera.setView(overview)

  return {
    flyTo(location, rangeM = SITE_RANGE_M) {
      const request = ++flight
      const position = Cartesian3.fromDegrees(location.lon, location.lat)
      const arrive = (surface: Cartesian3) => {
        if (viewer.isDestroyed() || request !== flight) return
        flyAround(surface, 0, OBLIQUE_PITCH, rangeM, 2)
      }
      if (scene.clampToHeightSupported) {
        void scene
          .clampToHeightMostDetailed([position])
          .then(([surface]) => arrive(surface ?? position))
          .catch(() => arrive(position))
      } else arrive(position)
    },
    flyToOverview() {
      flight++
      camera.flyTo({ ...overview, duration: 1.2 })
    },
    setMarkers(next) {
      markers.setMarkers(next)
    },
    setSelectedMarker(id) {
      markers.setSelected(id)
    },
    setSunDirection(direction) {
      if (direction === null) {
        moonShader.setUniform('u_sunLit', 0)
        return
      }
      const [x, y, z] = parseSunDirection(direction)
      moonShader.setUniform('u_sunDirectionWC', new Cartesian3(x, y, z))
      moonShader.setUniform('u_sunLit', 1)
    },
    resetNorth() {
      const canvas = scene.canvas
      const centre = pickSurface(
        new Cartesian2(canvas.clientWidth / 2, canvas.clientHeight / 2),
      )
      if (!centre) {
        camera.setView({
          orientation: { heading: 0, pitch: camera.pitch, roll: 0 },
        })
        return
      }
      flyAround(
        centre,
        0,
        camera.pitch,
        Cartesian3.distance(camera.position, centre),
        0.6,
      )
    },
    destroy() {
      removePreRender()
      removePostRender()
      handler.destroy()
      viewer.destroy()
    },
  }
}

// Google Earth mapping: left-drag pans the globe, wheel/pinch zooms toward the cursor,
// right-drag, middle-drag or Ctrl+left-drag tilts and rotates.
function configureGoogleEarthControls(viewer: Viewer) {
  const controller = viewer.scene.screenSpaceCameraController
  controller.zoomEventTypes = [CameraEventType.WHEEL, CameraEventType.PINCH]
  controller.tiltEventTypes = [
    CameraEventType.RIGHT_DRAG,
    CameraEventType.MIDDLE_DRAG,
    CameraEventType.PINCH,
    {
      eventType: CameraEventType.LEFT_DRAG,
      modifier: KeyboardEventModifier.CTRL,
    },
  ]
  controller.minimumZoomDistance = MIN_ZOOM_DISTANCE_M
  controller.maximumZoomDistance = MAX_ZOOM_DISTANCE_M
  controller.enableCollisionDetection = true

  // Viewer's default double-click tracks entities; we replace it with fly-to-point.
  viewer.cesiumWidget.screenSpaceEventHandler.removeInputAction(
    ScreenSpaceEventType.LEFT_DOUBLE_CLICK,
  )
}
