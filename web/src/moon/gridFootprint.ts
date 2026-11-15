import {
  Cartesian3,
  ClassificationPrimitive,
  ClassificationType,
  Color,
  ColorGeometryInstanceAttribute,
  Ellipsoid,
  GeometryInstance,
  PerInstanceColorAppearance,
  PolygonGeometry,
  PolygonHierarchy,
  type Entity,
  type Viewer,
} from 'cesium'

/** Classify the Moon tiles directly; ground primitives use Earth's height table. */
export function createGridFootprint(
  viewer: Viewer,
  entity: Entity,
  corners: readonly Cartesian3[],
  initialColor: Color,
) {
  // Render volumes only: the visible color still follows the actual 3D tile surface.
  const volume = {
    ellipsoid: Ellipsoid.MOON,
    height: 20_000,
    extrudedHeight: -20_000,
    vertexFormat: PerInstanceColorAppearance.VERTEX_FORMAT,
  }
  const create = (geometry: PolygonGeometry, color: Color) =>
    viewer.scene.primitives.add(
      new ClassificationPrimitive({
        geometryInstances: new GeometryInstance({
          id: entity,
          geometry,
          attributes: {
            color: ColorGeometryInstanceAttribute.fromColor(color),
          },
        }),
        classificationType: ClassificationType.CESIUM_3D_TILE,
      }),
    ) as ClassificationPrimitive
  const fill = create(
    PolygonGeometry.fromPositions({ ...volume, positions: [...corners] }),
    initialColor.withAlpha(0.25),
  )
  const center = Cartesian3.divideByScalar(
    corners.reduce(
      (sum, corner) => Cartesian3.add(sum, corner, sum),
      new Cartesian3(),
    ),
    corners.length,
    new Cartesian3(),
  )
  const borderWidthM = 12
  const inset =
    (2 * borderWidthM) / Cartesian3.distance(corners[0]!, corners[1]!)
  const outline = create(
    new PolygonGeometry({
      ...volume,
      polygonHierarchy: new PolygonHierarchy(
        [...corners],
        [
          new PolygonHierarchy(
            corners.map((corner) =>
              Cartesian3.lerp(corner, center, inset, new Cartesian3()),
            ),
          ),
        ],
      ),
    }),
    initialColor,
  )
  let color = initialColor
  let alpha = 0.25
  let dirty = true
  return {
    setStyle(nextColor: Color, nextAlpha: number) {
      if (Color.equals(color, nextColor) && alpha === nextAlpha) return
      color = nextColor
      alpha = nextAlpha
      dirty = true
    },
    update() {
      if (!dirty || !fill.ready || !outline.ready) return
      const fillAttributes: { color: Uint8Array } =
        fill.getGeometryInstanceAttributes(entity)
      const outlineAttributes: { color: Uint8Array } =
        outline.getGeometryInstanceAttributes(entity)
      fillAttributes.color = ColorGeometryInstanceAttribute.toValue(
        color.withAlpha(alpha),
      )
      outlineAttributes.color = ColorGeometryInstanceAttribute.toValue(color)
      dirty = false
    },
    destroy() {
      viewer.scene.primitives.remove(fill)
      viewer.scene.primitives.remove(outline)
    },
  }
}
