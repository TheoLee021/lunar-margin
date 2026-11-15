import {
  Cartesian2,
  Cartesian3,
  Color,
  ColorMaterialProperty,
  ConstantPositionProperty,
  ConstantProperty,
  DistanceDisplayCondition,
  Ellipsoid,
  Entity,
  HeightReference,
  Matrix4,
  Transforms,
  type Viewer,
} from 'cesium'
import type { LunarLocation } from './location'
import { rayOffsetEnu, type SkyDirection } from './lineOfSight'

/** A piece of surface equipment, sized from its real stowed/deployed dimensions. */
export interface AssetShape {
  kind: 'box' | 'cylinder'
  /** Footprint across, metres. A cylinder uses it as its diameter. */
  widthM: number
  /** Footprint along, metres. Ignored for a cylinder. */
  depthM: number
  /** Height above the surface, metres. */
  heightM: number
}

export interface MoonAsset {
  id: string
  label: string
  location: LunarLocation
  /**
   * Height of the point that has to see the Earth, metres above the surface
   * (an antenna's phase centre, a camera mast). The analysis API's `observer_height_m`.
   */
  observerHeightM: number
  shape: AssetShape
  /** The Earth in this asset's sky at the mission instant, or null when not evaluated. */
  earth: SkyDirection | null
}

/** Drawn length of a line of sight. A display choice, not the distance to the Earth. */
const SIGHT_LENGTH_M = 40_000

/**
 * Camera distance where a marker hands over to the equipment itself, metres.
 * Equipment is 2-10 m, so past this it covers only a few pixels: beyond it a marker
 * shows where the asset is, and within it the asset is drawn at its real size.
 */
const BODY_VISIBLE_WITHIN_M = 1_500

const FAR_MARKER = new DistanceDisplayCondition(
  BODY_VISIBLE_WITHIN_M,
  Number.MAX_VALUE,
)
const NEAR_BODY = new DistanceDisplayCondition(0, BODY_VISIBLE_WITHIN_M)

const MARKER_COLOR = Color.fromCssColorString('#f0a43c')
const BODY_COLOR = Color.fromCssColorString('#cbd5e1').withAlpha(0.95)
const BODY_OUTLINE = Color.fromCssColorString('#0f172a')
const SIGHT_CLEAR = Color.fromCssColorString('#4ade80')
const SIGHT_BLOCKED = Color.fromCssColorString('#f87171')
const LABEL_BACKGROUND = Color.fromCssColorString('#15191ee6')

export interface AssetLayer {
  /**
   * Replaces the drawn set. Assets keep their entities across calls with the same id,
   * so calling this on every animation frame moves them instead of rebuilding them.
   */
  setAssets(assets: readonly MoonAsset[]): void
}

interface Drawn {
  body: Entity
  sight: Entity
}

export function createAssetLayer(viewer: Viewer): AssetLayer {
  const drawn = new Map<string, Drawn>()

  /** Surface point under a location: the loaded tileset when it can be sampled, else the ellipsoid. */
  const groundAt = (location: LunarLocation): Cartesian3 => {
    const onEllipsoid = Cartesian3.fromDegrees(
      location.lon,
      location.lat,
      0,
      Ellipsoid.MOON,
    )
    return viewer.scene.clampToHeight(onEllipsoid) ?? onEllipsoid
  }

  const sightPositions = (asset: MoonAsset): Cartesian3[] => {
    if (!asset.earth) return []
    const frame = Transforms.eastNorthUpToFixedFrame(
      groundAt(asset.location),
      Ellipsoid.MOON,
    )
    const eye = Matrix4.multiplyByPoint(
      frame,
      new Cartesian3(0, 0, asset.observerHeightM),
      new Cartesian3(),
    )
    const [east, north, up] = rayOffsetEnu(asset.earth, SIGHT_LENGTH_M)
    const tip = Matrix4.multiplyByPoint(
      frame,
      new Cartesian3(east, north, asset.observerHeightM + up),
      new Cartesian3(),
    )
    return [eye, tip]
  }

  const create = (asset: MoonAsset): Drawn => {
    const { shape } = asset
    const body = viewer.entities.add({
      position: Cartesian3.fromDegrees(
        asset.location.lon,
        asset.location.lat,
        shape.heightM / 2,
      ),
      point: {
        pixelSize: 8,
        color: MARKER_COLOR,
        heightReference: HeightReference.CLAMP_TO_3D_TILE,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        distanceDisplayCondition: FAR_MARKER,
      },
      label: {
        text: asset.label,
        font: '600 13px monospace',
        showBackground: true,
        backgroundColor: LABEL_BACKGROUND,
        fillColor: Color.WHITE,
        heightReference: HeightReference.RELATIVE_TO_3D_TILE,
        pixelOffset: new Cartesian2(0, -18),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      ...(shape.kind === 'box'
        ? {
            box: {
              dimensions: new Cartesian3(
                shape.widthM,
                shape.depthM,
                shape.heightM,
              ),
              material: BODY_COLOR,
              outline: true,
              outlineColor: BODY_OUTLINE,
              heightReference: HeightReference.RELATIVE_TO_3D_TILE,
              distanceDisplayCondition: NEAR_BODY,
            },
          }
        : {
            cylinder: {
              length: shape.heightM,
              topRadius: shape.widthM / 2,
              bottomRadius: shape.widthM / 2,
              material: BODY_COLOR,
              outline: true,
              outlineColor: BODY_OUTLINE,
              heightReference: HeightReference.RELATIVE_TO_3D_TILE,
              distanceDisplayCondition: NEAR_BODY,
            },
          }),
    })

    const sight = viewer.entities.add({
      polyline: {
        positions: [],
        width: 2,
        material: SIGHT_CLEAR,
      },
    })

    return { body, sight }
  }

  const paint = (asset: MoonAsset, entities: Drawn): void => {
    entities.body.position = new ConstantPositionProperty(
      Cartesian3.fromDegrees(
        asset.location.lon,
        asset.location.lat,
        asset.shape.heightM / 2,
      ),
    )
    if (entities.body.label)
      entities.body.label.text = new ConstantProperty(asset.label)

    const { polyline } = entities.sight
    if (!polyline) return
    const positions = sightPositions(asset)
    polyline.positions = new ConstantProperty(positions)
    polyline.material = new ColorMaterialProperty(
      asset.earth?.visible ? SIGHT_CLEAR : SIGHT_BLOCKED,
    )
    entities.sight.show = positions.length > 0
  }

  return {
    setAssets(assets) {
      const keep = new Set(assets.map((asset) => asset.id))
      for (const [id, entities] of drawn) {
        if (keep.has(id)) continue
        viewer.entities.remove(entities.body)
        viewer.entities.remove(entities.sight)
        drawn.delete(id)
      }
      for (const asset of assets) {
        let entities = drawn.get(asset.id)
        if (!entities) {
          entities = create(asset)
          drawn.set(asset.id, entities)
        }
        paint(asset, entities)
      }
    },
  }
}
