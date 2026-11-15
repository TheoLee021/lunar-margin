import {
  ArcType,
  CallbackPositionProperty,
  CallbackProperty,
  Cartesian2,
  Cartesian3,
  Color,
  ColorMaterialProperty,
  ConstantProperty,
  DistanceDisplayCondition,
  Ellipsoid,
  Entity,
  HeightReference,
  Matrix4,
  Transforms,
  VerticalOrigin,
  type Viewer,
} from 'cesium'
import { assetSymbolImage, type AssetSymbol } from './assetSymbol'
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
  /** Badge above the unit saying what it is, since metre-scale shapes read alike. */
  symbol?: AssetSymbol
  /** The Earth in this asset's sky at the mission instant, or null when not evaluated. */
  earth: SkyDirection | null
}

/** Drawn length of a line of sight. A display choice, not the distance to the Earth. */
const SIGHT_LENGTH_M = 40_000

/**
 * Camera distance where a badge hands over to the equipment itself, metres.
 * Equipment is 2-10 m, so past this it covers only a few pixels.
 */
const BODY_VISIBLE_WITHIN_M = 1_500
const NEAR_BODY = new DistanceDisplayCondition(0, BODY_VISIBLE_WITHIN_M)
/**
 * The badge stands in for the equipment at any distance up to the overview, where it
 * would only clutter the whole-pole view. A dark square with the unit's glyph,
 * deliberately unlike the orange dot that marks a candidate site.
 */
const BADGE_RANGE = new DistanceDisplayCondition(0, 50_000)

/** The mast that carries the line of sight, drawn so its height is visible, not implied. */
const MAST_RADIUS_M = 0.12
const MAST_MIN_M = 1

const MAST_COLOR = Color.fromCssColorString('#94a3b8')
const BODY_COLOR = Color.fromCssColorString('#cbd5e1').withAlpha(0.95)
const BODY_OUTLINE = Color.fromCssColorString('#0f172a')
const SIGHT_CLEAR = Color.fromCssColorString('#4ade80')
const SIGHT_BLOCKED = Color.fromCssColorString('#f87171')
const LABEL_BACKGROUND = Color.fromCssColorString('#15191ee6')
/**
 * The Earth sits about 4 degrees up at the pole, so close to the ground the ray spends
 * its first kilometres inside the terrain. The buried stretch is drawn faint instead of
 * being swallowed: that is the ridge doing the blocking, which is the point of the demo.
 */
const BEHIND_TERRAIN_ALPHA = 0.55

export interface AssetLayer {
  /**
   * Replaces the drawn set. Assets keep their entities across calls with the same id,
   * so calling this on every animation frame moves them instead of rebuilding them.
   */
  setAssets(assets: readonly MoonAsset[]): void
}

/**
 * What changes as an asset moves. The body and mast read it through callback properties
 * rather than being handed a fresh property object each frame, because that churn makes
 * Cesium rebuild their geometry on every tick of a traverse.
 */
interface Live {
  body: Cartesian3
  mast: Cartesian3
  color: Color
  label: string
  /** Last drawn ray, so an unchanged one is never handed a fresh property object. */
  sight: Cartesian3[]
  /** Last ground point that sampled cleanly, so a streaming tileset cannot drop the ray. */
  ground?: Cartesian3
}

interface Drawn {
  body: Entity
  mast: Entity
  sight: Entity
  live: Live
}

export function createAssetLayer(viewer: Viewer): AssetLayer {
  const drawn = new Map<string, Drawn>()

  const positionAt = (location: LunarLocation, heightM: number): Cartesian3 =>
    Cartesian3.fromDegrees(location.lon, location.lat, heightM, Ellipsoid.MOON)

  /**
   * Surface point under a location. `clampToHeight` is a scene pick, so it answers
   * differently while tiles stream in; the last clean answer is kept per asset and the
   * ellipsoid is only the first-frame fallback.
   */
  const groundAt = (location: LunarLocation, live: Live): Cartesian3 => {
    const onEllipsoid = positionAt(location, 0)
    const clamped = viewer.scene.clampToHeight(onEllipsoid)
    if (clamped && Number.isFinite(clamped.x)) {
      live.ground = clamped
      return clamped
    }
    return live.ground ?? onEllipsoid
  }

  const sightPositions = (asset: MoonAsset, live: Live): Cartesian3[] => {
    if (!asset.earth) return []
    const frame = Transforms.eastNorthUpToFixedFrame(
      groundAt(asset.location, live),
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
    const { shape, symbol } = asset
    const live: Live = {
      body: positionAt(asset.location, shape.heightM / 2),
      mast: positionAt(asset.location, asset.observerHeightM / 2),
      color: SIGHT_CLEAR,
      label: asset.label,
      sight: [],
    }

    const body = viewer.entities.add({
      position: new CallbackPositionProperty(() => live.body, false),
      label: {
        text: new CallbackProperty(() => live.label, false),
        font: '600 13px monospace',
        showBackground: true,
        backgroundColor: LABEL_BACKGROUND,
        // The ray itself can be buried in terrain; the name always shows, so it
        // carries the verdict too.
        fillColor: new CallbackProperty(() => live.color, false),
        heightReference: HeightReference.RELATIVE_TO_3D_TILE,
        pixelOffset: new Cartesian2(0, -18),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        distanceDisplayCondition: NEAR_BODY,
      },
      ...(symbol
        ? {
            billboard: {
              image: new CallbackProperty(
                () => assetSymbolImage(symbol, live.color.toCssHexString()),
                false,
              ),
              verticalOrigin: VerticalOrigin.BOTTOM,
              heightReference: HeightReference.RELATIVE_TO_3D_TILE,
              pixelOffset: new Cartesian2(0, -32),
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
              distanceDisplayCondition: BADGE_RANGE,
            },
          }
        : {}),
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

    const mast = viewer.entities.add({
      position: new CallbackPositionProperty(() => live.mast, false),
      show: asset.observerHeightM >= MAST_MIN_M,
      cylinder: {
        length: asset.observerHeightM,
        topRadius: MAST_RADIUS_M,
        bottomRadius: MAST_RADIUS_M,
        material: MAST_COLOR,
        heightReference: HeightReference.RELATIVE_TO_3D_TILE,
        distanceDisplayCondition: NEAR_BODY,
      },
    })

    const sight = viewer.entities.add({
      show: false,
      polyline: {
        positions: new ConstantProperty(live.sight),
        // A line of sight runs straight through space; the default geodesic would bend
        // it along the surface.
        arcType: ArcType.NONE,
        width: 2,
        material: new ColorMaterialProperty(live.color),
        depthFailMaterial: new ColorMaterialProperty(
          live.color.withAlpha(BEHIND_TERRAIN_ALPHA),
        ),
      },
    })

    return { body, mast, sight, live }
  }

  const paint = (asset: MoonAsset, entities: Drawn): void => {
    const { live, sight } = entities
    live.label = asset.label
    live.body = positionAt(asset.location, asset.shape.heightM / 2)
    live.mast = positionAt(asset.location, asset.observerHeightM / 2)
    if (entities.mast.cylinder)
      entities.mast.cylinder.length = new ConstantProperty(
        asset.observerHeightM,
      )
    entities.mast.show = asset.observerHeightM >= MAST_MIN_M

    const { polyline } = sight
    if (!polyline) return
    const positions = sightPositions(asset, live)
    // Only hand Cesium a new property when the ray actually moved. Replacing these
    // every frame rebuilds the geometry for assets that are standing still.
    if (!samePositions(positions, live.sight)) {
      live.sight = positions
      polyline.positions = new ConstantProperty(positions)
    }
    sight.show = positions.length > 0

    const color = asset.earth?.visible ? SIGHT_CLEAR : SIGHT_BLOCKED
    if (!Color.equals(color, live.color)) {
      live.color = color
      polyline.material = new ColorMaterialProperty(color)
      polyline.depthFailMaterial = new ColorMaterialProperty(
        color.withAlpha(BEHIND_TERRAIN_ALPHA),
      )
    }
  }

  return {
    setAssets(assets) {
      const keep = new Set(assets.map((asset) => asset.id))
      for (const [id, entities] of drawn) {
        if (keep.has(id)) continue
        viewer.entities.remove(entities.body)
        viewer.entities.remove(entities.mast)
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

function samePositions(
  next: readonly Cartesian3[],
  previous: readonly Cartesian3[],
): boolean {
  return (
    next.length === previous.length &&
    next.every((point, index) => Cartesian3.equals(point, previous[index]))
  )
}
