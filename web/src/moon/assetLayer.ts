import {
  CallbackPositionProperty,
  CallbackProperty,
  Cartesian2,
  Cartesian3,
  Cartographic,
  Color,
  ConstantProperty,
  DistanceDisplayCondition,
  Ellipsoid,
  Entity,
  HeadingPitchRoll,
  HorizontalOrigin,
  Math as CesiumMath,
  Matrix4,
  Quaternion,
  Transforms,
  VerticalOrigin,
  type Viewer,
} from 'cesium'
import { assetCardText } from './assetCard'
import { assetSymbolImage, type AssetSymbol } from './assetSymbol'
import type { LunarLocation } from './location'
import type { SkyDirection } from './lineOfSight'

/**
 * One piece of a built-up unit, placed in the unit's own frame: `alongM` runs the way
 * it faces, `acrossM` to its right, `upM` off the ground, each to the piece's centre.
 * A machine made of a chassis, a boom and wheels reads as a machine; one box does not.
 */
export interface ShapePart {
  kind: 'box' | 'cylinder'
  /** Across the unit, metres. A cylinder uses it as its diameter. */
  widthM: number
  /** Along the unit, metres. Ignored for a cylinder. */
  depthM: number
  heightM: number
  acrossM?: number
  alongM?: number
  upM?: number
  /** Overrides the default body colour. */
  cssColor?: string
}

/** A piece of surface equipment, sized from its real stowed/deployed dimensions. */
export interface AssetShape {
  kind: 'box' | 'cylinder'
  /** Footprint across, metres. A cylinder uses it as its diameter. */
  widthM: number
  /** Footprint along, metres. Ignored for a cylinder. */
  depthM: number
  /** Height above the surface, metres. */
  heightM: number
  /** Drawn instead of the single shape. The dimensions above stay the real envelope. */
  parts?: readonly ShapePart[]
}

/**
 * A glTF model standing in for the plain shape. Every number is measured from the
 * file's own bounding box, because a downloaded model arrives in whatever units and
 * origin its author used: ours is 12.7 m tall in its own units with the origin 4.2 m
 * up inside the body.
 */
export interface AssetModel {
  uri: string
  /** Multiplier that brings the file's height to the asset's `shape.heightM`. */
  scale: number
  /** Metres to raise the origin so the model's lowest point rests on the surface. */
  baseLiftM: number
  /** Degrees to turn the model so its nose points along its heading. */
  headingOffsetDeg?: number
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
  /** Drawn instead of `shape` when given. `shape` still carries the real dimensions. */
  model?: AssetModel
  /** Degrees clockwise from north the unit faces. */
  headingDeg?: number
  /** Badge above the unit saying what it is, since metre-scale shapes read alike. */
  symbol?: AssetSymbol
  /** The Earth in this asset's sky at the mission instant, or null when not evaluated. */
  earth: SkyDirection | null
}

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

/**
 * The mast that carries the Earth link, drawn so its height is visible rather than
 * implied. Units that bring their own geometry already have one, and a second would
 * stand straight through the body.
 */
const MAST_RADIUS_M = 0.12
const MAST_MIN_M = 1
const builtUp = (asset: MoonAsset): boolean =>
  Boolean(asset.model ?? asset.shape.parts)
const wantsMast = (asset: MoonAsset): boolean =>
  !builtUp(asset) && asset.observerHeightM >= MAST_MIN_M

const MAST_COLOR = Color.fromCssColorString('#94a3b8')
const BODY_COLOR = Color.fromCssColorString('#cbd5e1').withAlpha(0.95)
const BODY_OUTLINE = Color.fromCssColorString('#0f172a')
/** The Earth verdict, carried by the card beside each unit. */
const EARTH_CLEAR = Color.fromCssColorString('#4ade80')
const EARTH_BLOCKED = Color.fromCssColorString('#f87171')
/** Translucent so the card reads as an overlay on the surface, not a sticker on it. */
const LABEL_BACKGROUND = Color.fromCssColorString('#15191eb3')

export interface AssetLayer {
  /**
   * Replaces the drawn set. Assets keep their entities across calls with the same id,
   * so calling this on every animation frame moves them instead of rebuilding them.
   */
  setAssets(assets: readonly MoonAsset[]): void
}

/**
 * What changes as an asset moves. Entities read it through callback properties rather
 * than being handed a fresh property object each frame, because that churn makes
 * Cesium rebuild their geometry on every tick of a drive.
 */
interface Live {
  anchor: Cartesian3
  /** One per drawn piece, already placed in the unit's own heading frame. */
  pieces: Cartesian3[]
  orientation: Quaternion
  mast: Cartesian3
  color: Color
  /** The lines drawn beside the unit, rebuilt whenever its verdict changes. */
  card: string
  /**
   * Terrain height under the unit, metres above the reference sphere, re-read every
   * frame from whatever tiles have streamed in. The last clean reading is kept so a
   * tile that has not arrived yet cannot throw the unit to the sphere.
   */
  ground: number
}

interface Drawn {
  /** Carries the card and the badge; the geometry hangs off `pieces`. */
  anchor: Entity
  pieces: Entity[]
  mast: Entity
  live: Live
}

export function createAssetLayer(viewer: Viewer): AssetLayer {
  const drawn = new Map<string, Drawn>()

  const positionAt = (location: LunarLocation, heightM: number): Cartesian3 =>
    Cartesian3.fromDegrees(location.lon, location.lat, heightM, Ellipsoid.MOON)

  /**
   * Terrain height under a location, metres above the reference sphere.
   *
   * Cesium's own height references latch onto the first tile they see, so as the
   * viewer zooms and the tileset refines, the terrain moves and anything placed that
   * way is left buried or hovering. Reading the height every frame instead means the
   * unit follows the terrain down to the finest tile that has loaded.
   */
  const groundAt = (location: LunarLocation, live: Live): number => {
    const clamped = viewer.scene.clampToHeight(positionAt(location, 0))
    if (clamped && Number.isFinite(clamped.x))
      live.ground = Cartographic.fromCartesian(clamped, Ellipsoid.MOON).height
    return live.ground
  }

  const headingRad = (asset: MoonAsset): number =>
    CesiumMath.toRadians(
      (asset.headingDeg ?? 0) + (asset.model?.headingOffsetDeg ?? 0),
    )

  /** The unit's own frame on the ground: x to its right, y the way it faces, z up. */
  const unitFrame = (asset: MoonAsset, ground: number): Matrix4 =>
    Transforms.headingPitchRollToFixedFrame(
      positionAt(asset.location, ground),
      new HeadingPitchRoll(headingRad(asset), 0, 0),
      Ellipsoid.MOON,
    )

  /** Where each drawn piece sits, in order: the model, or the parts, or the one shape. */
  const piecePositions = (asset: MoonAsset, ground: number): Cartesian3[] => {
    const frame = unitFrame(asset, ground)
    const at = (across: number, along: number, up: number) =>
      Matrix4.multiplyByPoint(
        frame,
        new Cartesian3(across, along, up),
        new Cartesian3(),
      )
    if (asset.model) return [at(0, 0, asset.model.baseLiftM)]
    const { parts } = asset.shape
    if (parts)
      return parts.map((part) =>
        at(part.acrossM ?? 0, part.alongM ?? 0, part.upM ?? 0),
      )
    return [at(0, 0, asset.shape.heightM / 2)]
  }

  const partGraphics = (part: ShapePart) => {
    const material = part.cssColor
      ? Color.fromCssColorString(part.cssColor)
      : BODY_COLOR
    return part.kind === 'box'
      ? {
          box: {
            dimensions: new Cartesian3(part.widthM, part.depthM, part.heightM),
            material,
            outline: true,
            outlineColor: BODY_OUTLINE,
            distanceDisplayCondition: NEAR_BODY,
          },
        }
      : {
          cylinder: {
            length: part.heightM,
            topRadius: part.widthM / 2,
            bottomRadius: part.widthM / 2,
            material,
            outline: true,
            outlineColor: BODY_OUTLINE,
            distanceDisplayCondition: NEAR_BODY,
          },
        }
  }

  const create = (asset: MoonAsset): Drawn => {
    const { shape, symbol } = asset
    const live: Live = {
      anchor: positionAt(asset.location, shape.heightM / 2),
      pieces: piecePositions(asset, 0),
      orientation: Quaternion.IDENTITY,
      mast: positionAt(asset.location, asset.observerHeightM / 2),
      color: EARTH_CLEAR,
      card: assetCardText(asset),
      ground: 0,
    }

    const anchor = viewer.entities.add({
      position: new CallbackPositionProperty(() => live.anchor, false),
      label: {
        // A card beside the unit, not just a name: whether the Earth is up, by how
        // much, the two angles that decided it, and the height it was measured from.
        text: new CallbackProperty(() => live.card, false),
        font: '500 12px monospace',
        showBackground: true,
        backgroundColor: LABEL_BACKGROUND,
        backgroundPadding: new Cartesian2(8, 6),
        fillColor: new CallbackProperty(() => live.color, false),
        horizontalOrigin: HorizontalOrigin.LEFT,
        pixelOffset: new Cartesian2(16, 0),
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
              pixelOffset: new Cartesian2(0, -32),
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
              distanceDisplayCondition: BADGE_RANGE,
            },
          }
        : {}),
    })

    const graphics = asset.model
      ? [
          {
            model: {
              uri: asset.model.uri,
              scale: asset.model.scale,
              distanceDisplayCondition: NEAR_BODY,
            },
          },
        ]
      : (shape.parts ?? [shape]).map((part) => partGraphics(part))

    const pieces = graphics.map((graphic, index) =>
      viewer.entities.add({
        position: new CallbackPositionProperty(
          () => live.pieces[index] ?? live.anchor,
          false,
        ),
        orientation: new CallbackProperty(() => live.orientation, false),
        ...graphic,
      }),
    )

    const mast = viewer.entities.add({
      position: new CallbackPositionProperty(() => live.mast, false),
      show: wantsMast(asset),
      cylinder: {
        length: asset.observerHeightM,
        topRadius: MAST_RADIUS_M,
        bottomRadius: MAST_RADIUS_M,
        material: MAST_COLOR,
        distanceDisplayCondition: NEAR_BODY,
      },
    })

    return { anchor, pieces, mast, live }
  }

  const paint = (asset: MoonAsset, entities: Drawn): void => {
    const { live } = entities
    live.card = assetCardText(asset)
    const ground = groundAt(asset.location, live)
    live.anchor = positionAt(asset.location, ground + asset.shape.heightM / 2)
    live.orientation = Transforms.headingPitchRollQuaternion(
      live.anchor,
      new HeadingPitchRoll(headingRad(asset), 0, 0),
    )
    live.pieces = piecePositions(asset, ground)
    live.mast = positionAt(asset.location, ground + asset.observerHeightM / 2)
    if (entities.mast.cylinder)
      entities.mast.cylinder.length = new ConstantProperty(
        asset.observerHeightM,
      )
    entities.mast.show = wantsMast(asset)

    const color = asset.earth?.visible ? EARTH_CLEAR : EARTH_BLOCKED
    if (!Color.equals(color, live.color)) live.color = color
  }

  return {
    setAssets(assets) {
      const keep = new Set(assets.map((asset) => asset.id))
      for (const [id, entities] of drawn) {
        if (keep.has(id)) continue
        viewer.entities.remove(entities.anchor)
        viewer.entities.remove(entities.mast)
        for (const piece of entities.pieces) viewer.entities.remove(piece)
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
