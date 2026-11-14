import * as Cesium from 'cesium'
import 'cesium/Build/Cesium/Widgets/widgets.css'
import type { CandidateSite } from './types'

export function createMoonViewer(
  container: HTMLElement,
  sites: readonly CandidateSite[],
  onSelect: (id: string) => void,
) {
  Cesium.Ellipsoid.default = Cesium.Ellipsoid.MOON
  Cesium.Ion.defaultAccessToken = import.meta.env.VITE_CESIUM_ION_TOKEN ?? ''
  const viewer = new Cesium.Viewer(container, {
    baseLayer: false,
    baseLayerPicker: false,
    geocoder: false,
    timeline: false,
    animation: false,
    sceneModePicker: false,
    homeButton: false,
    navigationHelpButton: false,
    fullscreenButton: false,
    infoBox: false,
    selectionIndicator: false,
    skyBox: false,
    skyAtmosphere: false,
  })
  viewer.scene.backgroundColor = Cesium.Color.fromCssColorString('#050607')
  viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString('#53565a')
  let selected = sites[0]
  const markers = new Map<string, Cesium.Entity>()
  for (const [index, site] of sites.entries()) {
    const entity = viewer.entities.add({
      id: site.id,
      position: Cesium.Cartesian3.fromDegrees(
        site.longitude,
        site.latitude,
        6000,
      ),
      label: {
        text: String(index + 1),
        font: '600 15px monospace',
        showBackground: true,
        backgroundColor: Cesium.Color.fromCssColorString('#15191ee6'),
        fillColor: Cesium.Color.WHITE,
        disableDepthTestDistance: Infinity,
        pixelOffset: new Cesium.Cartesian2(0, -12),
      },
      point: {
        pixelSize: 7,
        color: Cesium.Color.fromCssColorString('#f0a43c'),
        disableDepthTestDistance: Infinity,
      },
    })
    markers.set(site.id, entity)
  }
  function select(site: CandidateSite) {
    selected = site
    for (const [id, marker] of markers) {
      marker.label!.backgroundColor = new Cesium.ConstantProperty(
        Cesium.Color.fromCssColorString(
          id === site.id ? '#5aaee3' : '#15191ee6',
        ),
      )
    }
  }
  function flyTo(mode: 'top' | 'site') {
    if (mode === 'top' || !selected) {
      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(0, -90, 780000),
        orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 },
        duration: 0.8,
      })
    } else {
      viewer.camera.flyToBoundingSphere(
        new Cesium.BoundingSphere(
          Cesium.Cartesian3.fromDegrees(
            selected.longitude,
            selected.latitude,
            1500,
          ),
          12000,
        ),
        {
          offset: new Cesium.HeadingPitchRange(
            Math.PI,
            Cesium.Math.toRadians(-22),
            55000,
          ),
          duration: 0.8,
        },
      )
    }
  }
  viewer.camera.setView({
    destination: Cesium.Cartesian3.fromDegrees(0, -90, 780000),
    orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 },
  })
  const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas)
  handler.setInputAction((event: { position: Cesium.Cartesian2 }) => {
    const picked: unknown = viewer.scene.pick(event.position)
    if (typeof picked !== 'object' || picked === null || !('id' in picked))
      return
    const entity = picked.id
    if (entity instanceof Cesium.Entity && markers.has(entity.id))
      onSelect(entity.id)
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK)
  return {
    controls: {
      flyTo,
      select,
      destroy() {
        handler.destroy()
        if (!viewer.isDestroyed()) viewer.destroy()
      },
    },
    async loadTerrain() {
      if (!Cesium.Ion.defaultAccessToken)
        throw new Error(
          'Cesium ion 토큰이 없습니다. VITE_CESIUM_ION_TOKEN을 설정하세요.',
        )
      const tiles = await Cesium.Cesium3DTileset.fromIonAssetId(2684829)
      if (viewer.isDestroyed()) {
        tiles.destroy()
        return
      }
      viewer.scene.primitives.add(tiles)
      viewer.scene.globe.show = false
    },
  }
}
