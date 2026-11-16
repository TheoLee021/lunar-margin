import type { Viewshed } from '../api/viewshed'
// Imperative Cesium scene for the Moon. Loaded lazily by MoonViewer; React never holds Cesium state.
import {
  ArcType,
  Color,
  Entity,
  BoundingSphere,
  Cartesian2,
  Cartesian3,
  Cartographic,
  Cartesian4,
  CameraEventType,
  Cesium3DTileset,
  CustomShader,
  Ellipsoid,
  HeadingPitchRange,
  Ion,
  KeyboardEventModifier,
  Math as CesiumMath,
  PixelFormat,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  TextureMagnificationFilter,
  TextureMinificationFilter,
  TextureUniform,
  UniformType,
  Viewer,
} from 'cesium'
import 'cesium/Build/Cesium/Widgets/widgets.css'
import { shouldFreeCameraAxis } from './camera'
import { createFlightLayer } from './flightLayer'
import type { FlightPoint } from '../flight/flightData'
import { toLunarLocation, type LunarLocation } from './location'
import { createMarkerLayer, type MoonMarker } from './markerLayer'
import {
  createNormalWindows,
  polarXY,
  WINDOW_TILES,
  type NormalWindows,
} from './normalWindows'
import { DEFAULT_BASE_URL } from '../api/client'
import {
  fetchTile,
  loadTerrainOverlays,
  loadWideMeta,
  type NormalWideMeta,
  type RgbaImage,
} from './overlayTiles'
import { parseSunDirection, type Vector3 } from './sun'
import { loadSunlightMap, type SunlightMap } from './sunlightMap'
import { sunlitNearby, type SunlitNearby } from './sunlitNearby'
import { createSunlightWindows, type SunlightWindows } from './sunlightWindows'
import type { TileLevel } from './overlayTiles'

/** Cesium Moon Terrain (3D Tiles). The ion account must have it under My Assets, or it 404s. */
const CESIUM_MOON_ASSET_ID = 2684829

// Start straight above the south pole, framing the 85.5°S high-resolution disc with its surroundings,
// with 0° longitude at the top of the screen as on south-polar maps.
const START_HEIGHT_M = 800_000
const SITE_RANGE_M = 30_000
const OBLIQUE_PITCH = CesiumMath.toRadians(-45)
const MIN_ZOOM_DISTANCE_M = 150
const MAX_ZOOM_DISTANCE_M = 20_000_000

// Tiles ship as KHR_materials_unlit with no normals, so scene.light has no effect on them, and their
// photo texture (LROC mosaic) has the shadows of the moment it was taken baked in. The photo is the
// base everywhere: at low and middle latitudes it was taken under a high Sun and reads as the real Moon.
// Near the pole it is mostly shadow from one arbitrary moment, so with a Sun set the overlay
// (85°S and poleward) replaces it with a uniform albedo lit from that Sun: slopes from the normal
// tiles, and cast shadows from the backend's sunlight map for that Sun direction (docs/api.md,
// Sunlight). While that map is on its way, or if it cannot be had, shadows come from the precomputed
// horizon tiles instead: the same physics on a 500 m grid, so blunter edges. Close to the ground in
// a region with a 5 m DEM, a sunlight window on that level's grid sharpens the shadows to match.
// Neither the photo nor the tiles' triangles feed that lighting: the photo's shading belongs to
// another Sun, and the triangles are tens of pixels wide at every zoom, so their faces show as facets.
// The overlay fades into the photo over its outer OVERLAY_FADE_M.
// Where the backend holds a DEM out to 60°S, the same lighting goes on around that overlay out to
// 60°S (the wide zone), from one image of coarser slopes and a coarser sunlight map (docs/api.md,
// normal-wide), so that the first screen has no edge between computed light and photo. The wide
// zone fades into the photo over its outer WIDE_FADE_M.
// Outside both the photo still follows the Sun, but only as day and night: it dims towards
// the terminator and is black beyond it, by the Sun's height over a smooth sphere.
// The mosaic is darker than the Moon is usually shown; PHOTO_EXPOSURE is the gain in the darks,
// rolling off so that white stays white. It puts sunlit highlands at about half of display white, as
// in photographs of the Moon under a high Sun.
const PHOTO_EXPOSURE = 4.5
// The photo is shown as it is where the Sun stands at least this high. Below that it dims as flat
// ground does in the overlay's reflectance model.
const PHOTO_FULL_SUN_DEG = 8
// Sunlit brightness is a reflectance (lunar regolith: mostly Lommel-Seeliger, part Lambert) times an
// exposure, through a filmic curve. Nothing is clamped before the curve, so under a 1.5° Sun flat
// ground is dim and slopes turn brighter the more they face the Sun, as in orbital photos; clamping
// here is what flattens the picture into two tones.
const LAMBERT_SHARE = 0.3
const SUN_EXPOSURE = 1.4
// Above this Sun height the exposure comes down as fast as flat ground brightens, as a camera would
// be stopped down away from the terminator: flat ground then stays at the photo's brightness instead
// of burning out. Near the pole the Sun never stands this high, so nothing changes there.
const EXPOSURE_SUN_DEG = 3.5
// The view term is taken as if looking straight down, so brightness does not change as the camera
// tilts; on near-vertical slopes it is held at this cosine, where Lommel-Seeliger would blow up.
const MIN_VIEW_COS = 0.2
// Light reaching shadowed ground (sunlight scattered off sunlit terrain), as a reflectance.
// Seen from afar it is SHADOW_FILL without shape, so shadows read as black, as in orbital photos.
// Where the screen spans no more than FILL_NEAR_SPAN_M of ground it is SHADOW_FILL_NEAR and shows
// the terrain: it falls on the slopes as a light from the side away from the Sun, FILL_LIGHT_DEG
// above the horizon (the slopes that scatter sunlight face the Sun, so their light travels back
// towards it), except for the share FILL_AMBIENT, which reaches every slope alike. The two blend
// out to FILL_FAR_SPAN_M. Both levels are brighter than the scattered light is at the exposure of
// sunlit ground: the fill is an eye adapting to the shadow it looks into, not a measurement.
const SHADOW_FILL = 0.005
const SHADOW_FILL_NEAR = 0.01
const FILL_LIGHT_DEG = 10
const FILL_AMBIENT = 0.15
const FILL_NEAR_SPAN_M = 70_000
const FILL_FAR_SPAN_M = 200_000
// The fill needs sunlit ground nearby, wherever the Sun stands: it follows the sunlit share of the
// surroundings (sunlitNearby.ts, worked out from the wide sunlight map when it arrives) and is
// whole from FILL_REACH_SHARE up. Ground with no sunlit terrain around it stays black, by day or
// night. Until that map has arrived, and on backends without one, the fill instead fades out to
// where the Sun is FILL_GONE_DEG below the horizon of a smooth sphere.
const FILL_REACH_SHARE = 0.08
const FILL_GONE_DEG = 3
const SUN_RADIUS_DEG = 0.2665
const OVERLAY_FADE_M = 10_000
const WIDE_FADE_M = 300_000
// The tiles have holes at their coarser levels: triangles that are missing, through which black
// space shows as sharp wedges, plain to see on sunlit ground. So back faces are drawn too: through a
// hole the inside of the Moon's far side is seen, and the shader lights that pixel as the point of
// the reference sphere in front of it, the ground that should be there. The lighting depends only on
// where on the Moon a pixel is, so the patch matches its surroundings (displaced a little when seen
// at a slant, by the height of the ground). Nearly all back faces lie hidden behind the near side
// but are shaded all the same, so a patch gets the cheap parts of the lighting only: the wide zone's
// slopes and sunlight map, and where there is no wide zone HOLE_GREY by day and night.
// HOLE_GREY is the base colour that PHOTO_EXPOSURE brings to the photo's median.
const HOLE_GREY = 0.056
// Finer normal levels reach the shader as one window of tiles each, around the point the camera
// looks at (normalWindows.ts). The shader has this many window slots, used for the finest levels.
// A level is used where one of its texels covers at least FINE_FULL_PX screen pixels and fades out
// by FINE_GONE_PX: below that it would alias, and the next coarser level takes over.
const FINE_SLOTS = 4
const FINE_FULL_PX = 1
const FINE_GONE_PX = 0.5
// A window also fades in over this many of its texels from its edge.
const FINE_FADE_PX = 64
// Sunlight windows (sunlightWindows.ts) for the finest detail levels: the shader has this many slots.
const SUN_WINDOW_SLOTS = 2
// A sunlight window is asked for once the camera has rested over it this long: the backend computes
// each for about a second and cannot be called off, so the ones a flight passes over are skipped.
const SUN_WINDOW_SETTLE_MS = 400
const FOCUS_CHECK_MS = 150
// Cesium by default draws one canvas pixel per CSS pixel and lets the browser stretch it, which
// blurs the terrain on high-density displays. Draw at the display's own density instead, up to this
// many canvas pixels per CSS pixel (beyond 2 the extra fill cost buys nothing visible).
const MAX_PIXEL_RATIO = 2

function placeholderTexture(): TextureUniform {
  return new TextureUniform({
    typedArray: new Uint8Array(4),
    width: 1,
    height: 1,
  })
}

function dataTexture(image: RgbaImage): TextureUniform {
  // Encoded values must be read texel by texel (texelFetch), never filtered.
  return new TextureUniform({
    typedArray: image.data,
    width: image.width,
    height: image.height,
    minificationFilter: TextureMinificationFilter.NEAREST,
    magnificationFilter: TextureMagnificationFilter.NEAREST,
  })
}

function sunlightTexture(map: SunlightMap): TextureUniform {
  // One byte per pixel, so the GPU can filter and mipmap it directly.
  return new TextureUniform({
    typedArray: map.data,
    width: map.width,
    height: map.height,
    pixelFormat: PixelFormat.LUMINANCE,
    repeat: false,
    minificationFilter: TextureMinificationFilter.LINEAR_MIPMAP_LINEAR,
    magnificationFilter: TextureMagnificationFilter.LINEAR,
  })
}

function sunlitNearbyTexture(nearby: SunlitNearby): TextureUniform {
  // Coarse cells of a smooth quantity: the GPU's own filtering between them is enough.
  return new TextureUniform({
    typedArray: nearby.data,
    width: nearby.width,
    height: nearby.height,
    pixelFormat: PixelFormat.LUMINANCE,
    repeat: false,
    minificationFilter: TextureMinificationFilter.LINEAR,
    magnificationFilter: TextureMagnificationFilter.LINEAR,
  })
}

/** Reflectance of level ground under a Sun this high; the shader's flatGround is the same model. */
function flatGround(sunHeightDeg: number): number {
  const mu0 = Math.sin(CesiumMath.toRadians(sunHeightDeg))
  return (1 - LAMBERT_SHARE) * ((2 * mu0) / (mu0 + 1)) + LAMBERT_SHARE * mu0
}

const fineSlots = Array.from({ length: FINE_SLOTS }, (_, slot) => slot)
const sunWindowSlots = Array.from(
  { length: SUN_WINDOW_SLOTS },
  (_, slot) => slot,
)

function createMoonShader(): CustomShader {
  return new CustomShader({
    uniforms: {
      u_sunDirectionWC: {
        type: UniformType.VEC3,
        value: new Cartesian3(0, 0, 1),
      },
      u_viewshed: { type: UniformType.SAMPLER_2D, value: placeholderTexture() },
      u_viewshedGrid: { type: UniformType.VEC3, value: new Cartesian3() },
      u_sunLit: { type: UniformType.FLOAT, value: 0 },
      u_overlayReady: { type: UniformType.FLOAT, value: 0 },
      u_horizon: { type: UniformType.SAMPLER_2D, value: placeholderTexture() },
      u_normal: { type: UniformType.SAMPLER_2D, value: placeholderTexture() },
      // (pixel_size_m, center_px, tile_px, unused)
      u_overlayGrid: {
        type: UniformType.VEC4,
        value: new Cartesian4(1, 0, 1, 0),
      },
      // (azimuth_step_deg, offset_deg, step_deg, atlas_cols)
      u_horizonEncoding: {
        type: UniformType.VEC4,
        value: new Cartesian4(5, -5, 0.05, 6),
      },
      // (bias, scale)
      u_normalEncoding: {
        type: UniformType.VEC2,
        value: new Cartesian2(32768, 16384),
      },
      // Fraction of the solar disc visible from each point, for the current Sun (sunlightMap.ts).
      u_sunlight: { type: UniformType.SAMPLER_2D, value: placeholderTexture() },
      // (pixel_size_m, center_px, size_px); size 0 while there is no map for the current Sun.
      u_sunlightGrid: {
        type: UniformType.VEC3,
        value: new Cartesian3(1, 0, 0),
      },
      // The wide zone: slopes out to 60°S in one image, in the encoding of u_normal.
      u_wideNormal: {
        type: UniformType.SAMPLER_2D,
        value: placeholderTexture(),
      },
      // (pixel_size_m, center_px, size_px); size 0 while there is no such image.
      u_wideGrid: { type: UniformType.VEC3, value: new Cartesian3(1, 0, 0) },
      // The sunlight map of the wide zone and its grid, as u_sunlight and u_sunlightGrid.
      u_wideSunlight: {
        type: UniformType.SAMPLER_2D,
        value: placeholderTexture(),
      },
      u_wideSunlightGrid: {
        type: UniformType.VEC3,
        value: new Cartesian3(1, 0, 0),
      },
      // The sunlit share of the surroundings, over the same ground as u_wideSunlight (sunlitNearby.ts).
      u_sunlitNearby: {
        type: UniformType.SAMPLER_2D,
        value: placeholderTexture(),
      },
      // From texture coordinates of u_wideSunlight to those of u_sunlitNearby, whose last cells
      // reach past the edge of the map.
      u_sunlitNearbyScale: {
        type: UniformType.VEC2,
        value: new Cartesian2(1, 1),
      },
      ...Object.fromEntries(
        fineSlots.flatMap((slot) => [
          [
            `u_fine${slot}`,
            { type: UniformType.SAMPLER_2D, value: placeholderTexture() },
          ],
          // (pixel_size_m, center_px, window origin col, window origin row)
          [
            `u_fineGrid${slot}`,
            { type: UniformType.VEC4, value: new Cartesian4(1, 0, 0, 0) },
          ],
          // Window side in texels; 0 while the slot has no window.
          [`u_fineSize${slot}`, { type: UniformType.FLOAT, value: 0 }],
        ]),
      ),
      // Sunlight windows: the same three per slot as the fine windows above.
      ...Object.fromEntries(
        sunWindowSlots.flatMap((slot) => [
          [
            `u_sunWindow${slot}`,
            { type: UniformType.SAMPLER_2D, value: placeholderTexture() },
          ],
          [
            `u_sunWindowGrid${slot}`,
            { type: UniformType.VEC4, value: new Cartesian4(1, 0, 0, 0) },
          ],
          [`u_sunWindowSize${slot}`, { type: UniformType.FLOAT, value: 0 }],
        ]),
      ),
    },
    fragmentShaderText: /* glsl */ `
    const float MOON_RADIUS_M = ${CesiumMath.LUNAR_RADIUS.toFixed(1)};
    const float DEG = ${CesiumMath.RADIANS_PER_DEGREE};

    // Horizon elevation (deg) of bin k at texel px; negative-infinity-like sentinel when missing.
    float horizonBin(ivec2 px, int k) {
      int tilePx = int(u_overlayGrid.z);
      int cols = int(u_horizonEncoding.w);
      int cell = k / 4;
      ivec2 origin = ivec2(cell % cols, cell / cols) * tilePx;
      float code = floor(texelFetch(u_horizon, origin + px, 0)[k % 4] * 255.0 + 0.5);
      return code < 0.5 ? -1000.0 : u_horizonEncoding.y + code * u_horizonEncoding.z;
    }

    // Horizon towards azimuthDeg at texel px, interpolated between neighbouring bins.
    float horizonAt(ivec2 px, float azimuthDeg) {
      float bins = 360.0 / u_horizonEncoding.x;
      float i = azimuthDeg / u_horizonEncoding.x;
      int k0 = int(mod(floor(i), bins));
      int k1 = int(mod(floor(i) + 1.0, bins));
      return mix(horizonBin(px, k0), horizonBin(px, k1), fract(i));
    }

    // Tiles store slopes and horizons in each texel's own east/north frame, and that frame turns with
    // longitude: next to the pole, neighbouring texels face in entirely different directions. Values
    // from different texels are therefore combined in the tile plane (x towards longitude 90°E,
    // y towards longitude 0°), where east = (cos lon, -sin lon) and north = (sin lon, cos lon).
    // (sin lon, cos lon) of a point of the tile plane; longitude 0° at the pole itself, as in the tiles.
    vec2 lonDir(vec2 xy) {
      float r = length(xy);
      return r > 0.0 ? xy / r : vec2(0.0, 1.0);
    }
    vec2 planeFromLocal(vec2 eastNorth, vec2 dir) {
      return eastNorth.x * vec2(dir.y, -dir.x) + eastNorth.y * dir;
    }
    vec2 localFromPlane(vec2 v, vec2 dir) {
      return vec2(dot(v, vec2(dir.y, -dir.x)), dot(v, dir));
    }

    // (east slope, north slope) as tan; x is NaN-free, z = 1 when present.
    vec3 slopesAt(ivec2 px) {
      vec4 b = floor(texelFetch(u_normal, px, 0) * 255.0 + 0.5);
      if (b.x + b.y + b.z + b.w < 0.5) return vec3(0.0);
      vec2 words = vec2(b.x * 256.0 + b.y, b.z * 256.0 + b.w);
      return vec3((words - u_normalEncoding.x) / u_normalEncoding.y, 1.0);
    }

    // Fraction of the solar disc above a straight horizon, from (sun - horizon) in degrees.
    float discFraction(float aboveDeg) {
      float d = clamp(aboveDeg / ${SUN_RADIUS_DEG.toFixed(4)}, -1.0, 1.0);
      return 1.0 - (acos(d) - d * sqrt(1.0 - d * d)) / czm_pi;
    }

    // Slope at a texel of a fine window, as a gradient in the tile plane; z = 1 when the texel has data.
    vec3 fineSlopeAt(sampler2D window, vec4 grid, ivec2 px) {
      vec4 b = floor(texelFetch(window, px, 0) * 255.0 + 0.5);
      if (b.r + b.g + b.b + b.a < 0.5) return vec3(0.0);
      vec2 eastNorth = (vec2(b.r * 256.0 + b.g, b.b * 256.0 + b.a) - u_normalEncoding.x) / u_normalEncoding.y;
      vec2 fromPole = (grid.zw + vec2(px) - grid.y) * vec2(1.0, -1.0);
      return vec3(planeFromLocal(eastNorth, lonDir(fromPole)), 1.0);
    }

    // Blends the slope of a fine window over slope (both tile-plane gradients), at xy
    // (polar-stereographic metres) drawn at footprint metres per screen pixel. Texels are read one by
    // one and interpolated here: the slopes are 16-bit words split over two bytes, and the GPU rounds
    // its own filtering to 8 bits per byte. Texels without data (outside a sparse level's regions)
    // are left out, so the coarser slope shows through there.
    vec2 withFineWindow(vec2 slope, sampler2D window, vec4 grid, float size, vec2 xy, float footprint) {
      if (size < 0.5) return slope;
      vec2 local = vec2(grid.y + xy.x / grid.x, grid.y - xy.y / grid.x) - grid.zw;
      vec2 fromEdge = min(local, size - 1.0 - local);
      float use = smoothstep(0.0, ${FINE_FADE_PX.toFixed(1)}, min(fromEdge.x, fromEdge.y))
        * smoothstep(${FINE_GONE_PX.toFixed(2)}, ${FINE_FULL_PX.toFixed(2)}, grid.x / footprint);
      if (use <= 0.0) return slope;
      ivec2 last = ivec2(size) - 1;
      ivec2 p0 = clamp(ivec2(floor(local)), ivec2(0), last);
      ivec2 p1 = min(p0 + 1, last);
      vec2 f = fract(local);
      vec3 sum = (1.0 - f.x) * (1.0 - f.y) * fineSlopeAt(window, grid, p0)
        + f.x * (1.0 - f.y) * fineSlopeAt(window, grid, ivec2(p1.x, p0.y))
        + (1.0 - f.x) * f.y * fineSlopeAt(window, grid, ivec2(p0.x, p1.y))
        + f.x * f.y * fineSlopeAt(window, grid, p1);
      if (sum.z <= 0.0) return slope;
      return mix(slope, sum.xy / sum.z, use * sum.z);
    }

    // Slope of the wide zone at xy as a tile-plane gradient, times the weight of the texels with
    // data in z (0 outside the image).
    vec3 wideSlopeAt(vec2 xy) {
      vec4 grid = vec4(u_wideGrid.xy, 0.0, 0.0);
      vec2 pixel = vec2(grid.y + xy.x / grid.x, grid.y - xy.y / grid.x);
      vec2 base = floor(pixel);
      vec2 f = pixel - base;
      float last = u_wideGrid.z - 1.0;
      vec3 sum = vec3(0.0);
      for (int j = 0; j < 4; j++) {
        vec2 corner = base + vec2(float(j % 2), float(j / 2));
        if (any(lessThan(corner, vec2(0.0))) || any(greaterThan(corner, vec2(last)))) continue;
        vec2 w2 = mix(1.0 - f, f, corner - base);
        sum += w2.x * w2.y * fineSlopeAt(u_wideNormal, grid, ivec2(corner));
      }
      return sum;
    }

    // Blends a sunlight window over visible (the fraction of the solar disc in view), where the
    // window lies and by the same rule as the slopes of its level, so that shadow edges sharpen
    // together with the shading. The window is one byte per texel, so the GPU filters it.
    float withSunlightWindow(float visible, sampler2D window, vec4 grid, float size, vec2 xy, float footprint, vec2 dxyDx, vec2 dxyDy) {
      if (size < 0.5) return visible;
      vec2 local = vec2(grid.y + xy.x / grid.x, grid.y - xy.y / grid.x) - grid.zw;
      vec2 fromEdge = min(local, size - 1.0 - local);
      float use = smoothstep(0.0, ${FINE_FADE_PX.toFixed(1)}, min(fromEdge.x, fromEdge.y))
        * smoothstep(${FINE_GONE_PX.toFixed(2)}, ${FINE_FULL_PX.toFixed(2)}, grid.x / footprint);
      if (use <= 0.0) return visible;
      vec2 toUv = vec2(1.0, -1.0) / (grid.x * size);
      return mix(visible, textureGrad(window, (local + 0.5) / size, dxyDx * toUv, dxyDy * toUv).r, use);
    }

    // Narkowicz's fit of the ACES filmic curve: linear scene value in, linear display value out.
    vec3 filmic(vec3 v) {
      return clamp(v * (2.51 * v + 0.03) / (v * (2.43 * v + 0.59) + 0.14), 0.0, 1.0);
    }

    // Reflectance of level ground under a Sun whose height has this sine.
    float flatGround(float sunSin) {
      float mu0 = max(sunSin, 0.0);
      return mix(2.0 * mu0 / (mu0 + 1.0), mu0, ${LAMBERT_SHARE.toFixed(2)});
    }

    void shadeTerrain(FragmentInput fsInput, inout czm_modelMaterial material) {
      vec3 p = fsInput.attributes.positionWC;
      // Seen from behind: the far side through a hole in the near side (see HOLE_GREY).
      bool hole = !gl_FrontFacing;
      if (hole) {
        vec3 ray = normalize(p - czm_viewerPositionWC);
        float along = dot(czm_viewerPositionWC, ray);
        float reach = along * along - dot(czm_viewerPositionWC, czm_viewerPositionWC) + MOON_RADIUS_M * MOON_RADIUS_M;
        if (reach > 0.0) p = czm_viewerPositionWC - (along + sqrt(reach)) * ray;
        material.diffuse = vec3(${HOLE_GREY.toFixed(3)});
      }
      vec3 photo = material.diffuse * ${PHOTO_EXPOSURE.toFixed(2)} / (1.0 + material.diffuse * ${(PHOTO_EXPOSURE - 1).toFixed(2)});
      material.diffuse = photo;
      if (u_sunLit < 0.5) return;
      vec3 sun = normalize(u_sunDirectionWC);

      vec3 up = normalize(p);
      // Day and night on the photo: night begins where the Sun's upper limb sets on a smooth sphere.
      float sunSin = dot(sun, up);
      photo *= clamp(flatGround(sunSin + ${Math.sin(CesiumMath.toRadians(SUN_RADIUS_DEG)).toFixed(6)}) / ${flatGround(PHOTO_FULL_SUN_DEG).toFixed(6)}, 0.0, 1.0);
      material.diffuse = photo;

      float pixelSize = u_overlayGrid.x;
      float center = u_overlayGrid.y;
      // South-polar stereographic metres, as in the tiles: x towards longitude 90°E, y towards
      // longitude 0°. Written without latitude: asin(up.z) loses all precision next to the pole,
      // where up.z is within rounding of -1, and scatters texel lookups by tens of metres.
      // The projection is only used south of the equator; north of it the denominator is held.
      float south = step(up.z, 0.0);
      vec2 xy = 2.0 * MOON_RADIUS_M * up.yx / (1.0 - min(up.z, 0.0));
      float rho = length(xy);
      float rhoMax = center * pixelSize;
      float inner = south * u_overlayReady * (1.0 - smoothstep(rhoMax - ${OVERLAY_FADE_M.toFixed(1)}, rhoMax, rho));
      float wideMax = u_wideGrid.y * u_wideGrid.x;
      float wide = south * step(0.5, u_wideGrid.z) * (1.0 - smoothstep(wideMax - ${WIDE_FADE_M.toFixed(1)}, wideMax, rho));
      // Screen-space derivatives must be taken before the per-fragment returns.
      vec2 dxyDx = dFdx(xy);
      vec2 dxyDy = dFdy(xy);
      // Ground metres per screen pixel.
      float footprint = max(length(dxyDx), length(dxyDy));
      if (inner <= 0.0 && wide <= 0.0) return;

      vec2 dir = lonDir(xy);
      vec3 east = vec3(-dir.x, dir.y, 0.0);
      vec3 north = cross(up, east);
      // The Sun's horizontal direction in the tile plane: the same for every texel around here.
      vec2 sunPlane = planeFromLocal(vec2(dot(sun, east), dot(sun, north)), dir);
      float sunEl = asin(clamp(sunSin, -1.0, 1.0)) / DEG;

      float total = 0.0;
      float horizonSum = 0.0;
      vec2 slopeSum = vec2(0.0);
      if (inner > 0.0 && !hole) {
        vec2 pixel = vec2(center + xy.x / pixelSize, center - xy.y / pixelSize);
        vec2 base = floor(pixel);
        vec2 f = pixel - base;
        float last = u_overlayGrid.z - 1.0;
        for (int j = 0; j < 4; j++) {
          vec2 corner = base + vec2(float(j % 2), float(j / 2));
          if (any(lessThan(corner, vec2(0.0))) || any(greaterThan(corner, vec2(last)))) continue;
          ivec2 px = ivec2(corner);
          vec2 cornerDir = lonDir((corner - center) * vec2(1.0, -1.0));
          vec2 sunAtCorner = localFromPlane(sunPlane, cornerDir);
          float horizon = horizonAt(px, mod(atan(sunAtCorner.x, sunAtCorner.y) / DEG + 360.0, 360.0));
          vec3 slopes = slopesAt(px);
          if (horizon < -999.0 || slopes.z < 0.5) continue;
          vec2 w2 = mix(1.0 - f, f, corner - base);
          float w = w2.x * w2.y;
          total += w;
          horizonSum += w * horizon;
          slopeSum += w * planeFromLocal(slopes.xy, cornerDir);
        }
      }
      float innerUse = total > 1e-4 ? inner : 0.0;
      vec3 wideSlope = wide > 0.0 ? wideSlopeAt(xy) : vec3(0.0);
      float wideUse = wideSlope.z > 1e-4 ? wide : 0.0;
      float weight = max(innerUse, wideUse);
      // No overlay data here: keep the photo.
      if (weight <= 0.0) return;
      // Where both have data the 85°S overlay lies over the wide zone, fading in over its own edge.
      float top = wideUse > 0.0 ? innerUse : 1.0;
      vec2 slope = mix(
        wideUse > 0.0 ? wideSlope.xy / wideSlope.z : vec2(0.0),
        innerUse > 0.0 ? slopeSum / total : vec2(0.0),
        top);
      if (!hole) {
${fineSlots
  .map(
    (slot) =>
      `        slope = withFineWindow(slope, u_fine${slot}, u_fineGrid${slot}, u_fineSize${slot}, xy, footprint);`,
  )
  .join('\n')}
      }
      vec2 eastNorth = localFromPlane(slope, dir);
      vec3 normalWC = normalize(up - eastNorth.x * east - eastNorth.y * north);
      // Cast shadows of the wide zone: its sunlight map, and until that has arrived only the Sun
      // setting behind a smooth sphere.
      float visible = discFraction(sunEl);
      vec2 wideUv = vec2(0.0);
      if (u_wideSunlightGrid.z > 0.5) {
        vec2 mapPixel = vec2(u_wideSunlightGrid.y + xy.x / u_wideSunlightGrid.x, u_wideSunlightGrid.y - xy.y / u_wideSunlightGrid.x);
        vec2 toUv = vec2(1.0, -1.0) / (u_wideSunlightGrid.x * u_wideSunlightGrid.z);
        wideUv = (mapPixel + 0.5) / u_wideSunlightGrid.z;
        visible = textureGrad(u_wideSunlight, wideUv, dxyDx * toUv, dxyDy * toUv).r;
      }
      if (top > 0.0) {
        // Interpolate the horizon first, then take the disc fraction once: shadow edges follow
        // smooth contours instead of 500 m steps.
        // In the 85°S overlay: the backend's sunlight map for this Sun (80 m, terrain out to
        // 200 km) once it has arrived, and until then the coarser estimate from the precomputed horizon.
        float innerVisible;
        if (u_sunlightGrid.z > 0.5) {
          vec2 mapPixel = vec2(u_sunlightGrid.y + xy.x / u_sunlightGrid.x, u_sunlightGrid.y - xy.y / u_sunlightGrid.x);
          vec2 toUv = vec2(1.0, -1.0) / (u_sunlightGrid.x * u_sunlightGrid.z);
          innerVisible = textureGrad(u_sunlight, (mapPixel + 0.5) / u_sunlightGrid.z, dxyDx * toUv, dxyDy * toUv).r;
        } else {
          innerVisible = discFraction(sunEl - horizonSum / total);
        }
        visible = mix(visible, innerVisible, top);
      }
      if (!hole) {
${sunWindowSlots
  .map(
    (slot) =>
      `        visible = withSunlightWindow(visible, u_sunWindow${slot}, u_sunWindowGrid${slot}, u_sunWindowSize${slot}, xy, footprint, dxyDx, dxyDy);`,
  )
  .join('\n')}
      }

      float mu0 = max(dot(normalWC, sun), 0.0);
      float mu = max(dot(normalWC, up), ${MIN_VIEW_COS.toFixed(2)});
      float lommelSeeliger = 2.0 * mu0 / (mu0 + mu);
      // How much of the fill light reaches here (see FILL_REACH_SHARE). Ground that sees the whole
      // Sun has sunlit ground around it, and is spared the lookup.
      float fillReach = 1.0;
      if (visible < 0.999) {
        if (u_wideSunlightGrid.z > 0.5) {
          // Level 0 by name: inside a branch the GPU cannot work out a level of its own.
          float sunlitNearby = textureLod(u_sunlitNearby, wideUv * u_sunlitNearbyScale, 0.0).r;
          fillReach = smoothstep(0.0, ${FILL_REACH_SHARE.toFixed(3)}, sunlitNearby);
        } else {
          fillReach = smoothstep(${(-Math.sin(CesiumMath.toRadians(FILL_GONE_DEG))).toFixed(6)}, 0.0, sunSin);
        }
      }
      // The fill light (see SHADOW_FILL): shapeless from afar, lighting the slopes close in.
      float fillNear = 1.0 - smoothstep(${FILL_NEAR_SPAN_M.toFixed(1)}, ${FILL_FAR_SPAN_M.toFixed(1)}, footprint * czm_viewport.z);
      vec3 sunLevel = sun - sunSin * up;
      float sunLevelLength = length(sunLevel);
      vec3 fillFrom = ${Math.sin(CesiumMath.toRadians(FILL_LIGHT_DEG)).toFixed(6)} * up
        - ${Math.cos(CesiumMath.toRadians(FILL_LIGHT_DEG)).toFixed(6)} * (sunLevelLength > 1e-4 ? sunLevel / sunLevelLength : east);
      // Level ground gets the same from the light as from the ambient share.
      float fillShape = mix(max(dot(normalWC, fillFrom), 0.0) / ${Math.sin(CesiumMath.toRadians(FILL_LIGHT_DEG)).toFixed(6)}, 1.0, ${FILL_AMBIENT.toFixed(2)});
      float fill = fillReach * mix(${SHADOW_FILL.toFixed(3)}, ${SHADOW_FILL_NEAR.toFixed(3)} * fillShape, fillNear);
      float reflectance = visible * mix(lommelSeeliger, mu0, ${LAMBERT_SHARE.toFixed(2)}) + fill;
      float exposure = ${SUN_EXPOSURE.toFixed(2)} * min(1.0, ${flatGround(EXPOSURE_SUN_DEG).toFixed(6)} / max(flatGround(sunSin), 1e-6));
      vec3 sunlit = filmic(vec3(exposure * reflectance));
      material.diffuse = mix(photo, sunlit, weight);
    }
    void fragmentMain(FragmentInput fsInput, inout czm_modelMaterial material) {
      shadeTerrain(fsInput, material);
      if (u_viewshedGrid.z < 0.5 || !gl_FrontFacing) return;
      vec3 up = normalize(fsInput.attributes.positionWC);
      if (up.z >= 0.0) return;
      vec2 xy = 2.0 * 1737400.0 * up.yx / (1.0 - up.z);
      vec2 offset = xy - u_viewshedGrid.xy;
      // Draw the observer on the very same tile fragment and projection as the mask.
      float pixelM = clamp(max(length(dFdx(offset)), length(dFdy(offset))), 0.1, 35.0);
      float markerDistance = length(offset) / pixelM;
      if (markerDistance < 5.5) {
        material.diffuse = markerDistance < 3.5 ? vec3(1.0, 0.55, 0.02) : vec3(1.0);
        return;
      }
      if (length(offset) > 5000.0) return;
      ivec2 cell = clamp(ivec2(floor(offset / 80.0 + 62.5)), ivec2(0), ivec2(124));
      int code = int(round(texelFetch(u_viewshed, cell, 0).r * 255.0));
      if (code == 0) return;
      vec3 tint = code == 2 ? vec3(0.10, 0.78, 0.40) : vec3(0.88, 0.25, 0.20);
      material.diffuse = mix(material.diffuse, tint, code == 2 ? 0.055 : 0.14);
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
  /** The terrain shadow overlay could not be loaded; the Moon keeps showing the photo. */
  onOverlayError: (message: string) => void
}

export interface MoonScene {
  setFlightPath(points: readonly FlightPoint[]): void
  setFlightFrame(index: number): void
  setViewshed(map: Viewshed | null): void
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

  viewer.useBrowserRecommendedResolution = false
  viewer.resolutionScale = Math.min(
    1,
    MAX_PIXEL_RATIO / window.devicePixelRatio,
  )

  const flightLayer = createFlightLayer(viewer)
  const moonShader = createMoonShader()
  let normalWindows: NormalWindows | undefined
  let sunlightWindows: SunlightWindows | undefined
  // The sunlight map shares the grid of the finest full-coverage normal level (docs/api.md, Sunlight).
  let sunlightLevel: TileLevel | undefined
  // The grid of the wide sunlight map, once the backend has said that it holds the wide zone.
  let wideSunlight: NormalWideMeta['sunlight'] | undefined
  let sun: Vector3 | null = null
  // One of the two whole sunlight maps: asks the backend for the map of the current Sun and hands
  // it to the shader when it arrives. Without it the shader's coarser shadows keep showing.
  const sunlightMapSlot = (
    wide: boolean,
    textureUniform: string,
    gridUniform: string,
    // Whatever else the shader needs from the map, set before the map itself is switched on.
    prepare?: (map: SunlightMap) => void,
  ) => {
    let pending: AbortController | undefined
    const clear = () => {
      pending?.abort()
      moonShader.setUniform(gridUniform, new Cartesian3(1, 0, 0))
    }
    const load = (
      grid:
        | { pixel_size_m: number; center_px: number; size_px: number }
        | undefined,
    ): Promise<void> => {
      clear()
      if (!sun || !grid) return Promise.resolve()
      const request = new AbortController()
      pending = request
      options.signal.addEventListener('abort', () => request.abort(), {
        signal: request.signal,
      })
      return loadSunlightMap(sun, DEFAULT_BASE_URL, request.signal, { wide })
        .then((map) => {
          if (request.signal.aborted) return
          if (map.width !== grid.size_px || map.height !== grid.size_px) return
          prepare?.(map)
          moonShader.setUniform(textureUniform, sunlightTexture(map))
          moonShader.setUniform(
            gridUniform,
            new Cartesian3(grid.pixel_size_m, grid.center_px, grid.size_px),
          )
        })
        .catch(() => undefined)
    }
    return { clear, load }
  }
  const sunlightMap = sunlightMapSlot(false, 'u_sunlight', 'u_sunlightGrid')
  const wideSunlightMap = sunlightMapSlot(
    true,
    'u_wideSunlight',
    'u_wideSunlightGrid',
    (map) => {
      const nearby = sunlitNearby(map)
      moonShader.setUniform('u_sunlitNearby', sunlitNearbyTexture(nearby))
      moonShader.setUniform(
        'u_sunlitNearbyScale',
        new Cartesian2(
          map.width / (nearby.width * nearby.cellPx),
          map.height / (nearby.height * nearby.cellPx),
        ),
      )
    },
  )
  // For a new Sun the wide map is asked for first: the backend computes one map at a time, and this
  // one is quick and covers the whole first screen. The 80 m map then sharpens the middle.
  const refreshSunlightMaps = () => {
    sunlightMap.clear()
    void wideSunlightMap
      .load(wideSunlight)
      .then(() => sunlightMap.load(sunlightLevel))
  }
  // The wide zone is there only on backends that hold a DEM out to 60°S. Without it the Moon keeps
  // the 85°S overlay alone, so a failure here is not reported.
  loadWideMeta(options.signal)
    .then(async (meta) => {
      if (options.signal.aborted) return
      wideSunlight = meta.sunlight
      void wideSunlightMap.load(wideSunlight)
      const level = meta.levels[0]!
      const image = await fetchTile(
        'normal-wide',
        { z: 0, x: 0, y: 0 },
        DEFAULT_BASE_URL,
        options.signal,
      )
      if (options.signal.aborted) return
      if (image.width !== level.size_px || image.height !== level.size_px)
        return
      moonShader.setUniform('u_wideNormal', dataTexture(image))
      moonShader.setUniform(
        'u_wideGrid',
        new Cartesian3(level.pixel_size_m, level.center_px, level.size_px),
      )
    })
    .catch(() => undefined)
  // Overlays come from our API and are independent of the ion tileset, so both load in parallel.
  loadTerrainOverlays(options.signal)
    .then(({ horizon, normal }) => {
      if (options.signal.aborted) return
      // The finest level that covers the whole area; sparse levels (tile_ranges) only cover regions.
      sunlightLevel = normal.meta.levels.findLast(
        (level) => level.tile_ranges === undefined,
      )
      void sunlightMap.load(sunlightLevel)
      sunlightWindows = createSunlightWindows({
        // The detail levels (sparse: only where a 5 m DEM is), coarse to fine as for the slopes.
        levels: normal.meta.levels
          .filter((level) => level.tile_ranges !== undefined)
          .slice(-SUN_WINDOW_SLOTS),
        minTexelPx: FINE_GONE_PX,
        settleMs: SUN_WINDOW_SETTLE_MS,
        signal: options.signal,
        load: (window, direction, signal) =>
          loadSunlightMap(direction, DEFAULT_BASE_URL, signal, { window }),
        onWindow: (slot, window) => {
          if (!window) {
            moonShader.setUniform(`u_sunWindowSize${slot}`, 0)
            return
          }
          const { level, origin, map } = window
          moonShader.setUniform(`u_sunWindow${slot}`, sunlightTexture(map))
          moonShader.setUniform(
            `u_sunWindowGrid${slot}`,
            new Cartesian4(
              level.pixel_size_m,
              level.center_px,
              origin.tileX * level.tile_px,
              origin.tileY * level.tile_px,
            ),
          )
          moonShader.setUniform(`u_sunWindowSize${slot}`, map.width)
        },
      })
      normalWindows = createNormalWindows({
        // Coarse to fine, so a finer window is blended over a coarser one.
        levels: normal.meta.levels.slice(1).slice(-FINE_SLOTS),
        baseUrl: DEFAULT_BASE_URL,
        signal: options.signal,
        onWindow: (slot, { level, origin, image }) => {
          moonShader.setUniform(`u_fine${slot}`, dataTexture(image))
          moonShader.setUniform(
            `u_fineGrid${slot}`,
            new Cartesian4(
              level.pixel_size_m,
              level.center_px,
              origin.tileX * level.tile_px,
              origin.tileY * level.tile_px,
            ),
          )
          moonShader.setUniform(
            `u_fineSize${slot}`,
            WINDOW_TILES * level.tile_px,
          )
        },
      })
      const level = horizon.meta.levels[0]!
      const enc = horizon.meta.encoding
      moonShader.setUniform('u_horizon', dataTexture(horizon.image))
      moonShader.setUniform('u_normal', dataTexture(normal.image))
      moonShader.setUniform(
        'u_overlayGrid',
        new Cartesian4(level.pixel_size_m, level.center_px, level.tile_px, 0),
      )
      moonShader.setUniform(
        'u_horizonEncoding',
        new Cartesian4(
          enc.azimuth_step_deg,
          enc.offset_deg,
          enc.step_deg,
          enc.atlas_cols,
        ),
      )
      moonShader.setUniform(
        'u_normalEncoding',
        new Cartesian2(normal.meta.encoding.bias, normal.meta.encoding.scale),
      )
      moonShader.setUniform('u_overlayReady', 1)
    })
    .catch((error: unknown) => {
      if (options.signal.aborted) return
      options.onOverlayError(
        error instanceof Error ? error.message : String(error),
      )
    })
  try {
    const tileset = await Cesium3DTileset.fromIonAssetId(CESIUM_MOON_ASSET_ID)
    options.signal.throwIfAborted()
    tileset.customShader = moonShader
    // Back faces fill the holes of the tiles: see HOLE_GREY.
    tileset.backFaceCulling = false
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
  // Moves the windows of fine slopes and shadows to where the camera looks.
  const pixelDimensions = new Cartesian2()
  const followFocus = () => {
    // The ground at the centre of the screen, or under the camera when that is the sky.
    const centre = camera.pickEllipsoid(
      new Cartesian2(
        scene.canvas.clientWidth / 2,
        scene.canvas.clientHeight / 2,
      ),
      Ellipsoid.MOON,
    )
    const focus = polarXY(
      toLunarLocation(
        centre
          ? Cartographic.fromCartesian(centre, Ellipsoid.MOON)
          : camera.positionCartographic,
      ),
    )
    normalWindows?.update(focus)
    // Metres of ground one drawn pixel covers there, seen face-on.
    const pixel = camera.frustum.getPixelDimensions(
      scene.drawingBufferWidth,
      scene.drawingBufferHeight,
      centre
        ? Cartesian3.distance(camera.position, centre)
        : camera.positionCartographic.height,
      1,
      pixelDimensions,
    )
    sunlightWindows?.update(focus, Math.max(pixel.x, pixel.y), sun)
  }
  let lastFocusCheck = 0
  const removePostRender = scene.postRender.addEventListener(() => {
    const now = performance.now()
    if (now - lastFocusCheck >= FOCUS_CHECK_MS) {
      lastFocusCheck = now
      followFocus()
    }
    if (Math.abs(camera.heading - lastHeading) < 1e-3) return
    lastHeading = camera.heading
    options.onHeadingChange(camera.heading)
  })

  const towardsPick = new Cartesian3()
  const pickSurface = (windowPosition: Cartesian2): Cartesian3 | undefined => {
    const position = scene.pickPosition(windowPosition)
    if (!position || !Number.isFinite(position.x)) return undefined
    // Through a hole of the tiles the pick lands on the inside of the far side: not a place to pick.
    Cartesian3.subtract(position, camera.positionWC, towardsPick)
    return Cartesian3.dot(towardsPick, position) > 0 ? undefined : position
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
      const ground = Cartographic.fromCartesian(surface, Ellipsoid.MOON)
      const request = ++flight
      const location = toLunarLocation(ground)
      const publish = (height: number) => {
        if (request === flight && !viewer.isDestroyed())
          options.onPick({ ...location, surfaceHeightM: height })
      }
      if (scene.sampleHeightSupported) {
        // An overview tile can be kilometres off the detailed terrain inside a crater.
        const fallback = ground.height
        void scene
          .sampleHeightMostDetailed([ground])
          .then(([sample]) => {
            publish(
              sample && Number.isFinite(sample.height)
                ? sample.height
                : fallback,
            )
          })
          .catch(() => publish(fallback))
      } else publish(ground.height)
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

  let rayGeneration = 0
  const rayEntities: Entity[] = []
  return {
    setFlightPath(points) {
      flightLayer.setPath(points)
    },
    setFlightFrame(index) {
      flightLayer.setFrame(index)
    },
    setViewshed(map) {
      const generation = ++rayGeneration
      for (const entity of rayEntities) viewer.entities.remove(entity)
      rayEntities.length = 0
      if (map) {
        const draw = (heightShift: number) => {
          if (viewer.isDestroyed() || generation !== rayGeneration) return
          const position = ([lon, lat, height]: [number, number, number]) =>
            Cartesian3.fromDegrees(
              lon,
              lat,
              height + heightShift,
              Ellipsoid.MOON,
            )
          for (const [target, hit] of map.targets) {
            const end = position(target)
            rayEntities.push(
              viewer.entities.add({
                position: end,
                point: {
                  pixelSize: 4,
                  color: hit === null ? Color.AQUAMARINE : Color.SALMON,
                  disableDepthTestDistance: Infinity,
                },
              }),
            )
            if (hit === null) continue
            const first = position(hit)
            rayEntities.push(
              viewer.entities.add({
                position: first,
                point: {
                  pixelSize: 6,
                  color: Color.ORANGERED,
                  outlineColor: Color.WHITE,
                  outlineWidth: 1,
                  disableDepthTestDistance: Infinity,
                },
                polyline: {
                  positions: [first, end],
                  arcType: ArcType.NONE,
                  width: 1.4,
                  material: Color.SALMON,
                  depthFailMaterial: Color.SALMON,
                },
              }),
            )
          }
        }
        // Register all DEM points to the rendered surface at the observer, preserving line geometry.
        if (scene.sampleHeightSupported)
          void scene
            .sampleHeightMostDetailed([
              Cartographic.fromDegrees(map.lon, map.lat),
            ])
            .then(([ground]) => {
              draw(
                ground && Number.isFinite(ground.height)
                  ? ground.height + map.observer_height_m - map.eye_height_m
                  : 0,
              )
            })
            .catch(() => draw(0))
        else draw(0)
      }
      if (!map) {
        moonShader.setUniform('u_viewshedGrid', new Cartesian3())
        return
      }
      const data = new Uint8Array(map.cells.length * 4)
      for (let i = 0; i < map.cells.length; i++)
        data[i * 4] = map.cells.charCodeAt(i) - 48
      moonShader.setUniform(
        'u_viewshed',
        dataTexture({ width: 125, height: 125, data }),
      )
      moonShader.setUniform(
        'u_viewshedGrid',
        new Cartesian3(map.center_x_m, map.center_y_m, 1),
      )
    },
    flyTo(location, rangeM = SITE_RANGE_M) {
      const request = ++flight
      const position = Cartesian3.fromDegrees(
        location.lon,
        location.lat,
        location.surfaceHeightM ?? 0,
        Ellipsoid.MOON,
      )
      const arrive = (surface: Cartesian3) => {
        if (viewer.isDestroyed() || request !== flight) return
        flyAround(surface, 0, OBLIQUE_PITCH, rangeM, 2)
      }
      if (location.surfaceHeightM !== undefined) arrive(position)
      else if (scene.clampToHeightSupported) {
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
        sun = null
        moonShader.setUniform('u_sunLit', 0)
        refreshSunlightMaps()
        followFocus()
        return
      }
      const next = parseSunDirection(direction)
      const previous = sun
      sun = next
      const changed =
        !previous || next.some((value, i) => value !== previous[i])
      moonShader.setUniform('u_sunDirectionWC', new Cartesian3(...next))
      moonShader.setUniform('u_sunLit', 1)
      if (changed) {
        refreshSunlightMaps()
        // Windows computed for the previous Sun come down at once, not at the next focus check.
        followFocus()
      }
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
      flightLayer.destroy()
      markers.destroy()
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
