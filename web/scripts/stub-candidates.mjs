// 스텁 API 의 /candidates 엔드포인트 (docs/api.md "후보지 탐색 결과" 계약). 의존성 없음.
//   CANDIDATES_DIR=<dir> 이면 <dir>/<run_id>/{candidates.json,summary.json,map.json,layers/*.png} 를 읽어
//   계약대로 돌려주고, 없으면 결정적인 합성 실행 하나("synthetic")를 메모리에서 만든다.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { crc32, deflateSync } from 'node:zlib'

const R = 1_737_400
const RUN_ID = /^[A-Za-z0-9_-]{1,64}$/
const LAYER_NAMES = [
  'coarse_sun',
  'coarse_earth',
  'coarse_promoted',
  'sun',
  'earth',
  'stage',
  'eligibility',
  'regions',
  'quality',
]

// ---------- PNG (8비트 RGBA) ----------

function chunk(type, body) {
  const out = Buffer.alloc(12 + body.length)
  out.writeUInt32BE(body.length, 0)
  out.write(type, 4, 'ascii')
  body.copy(out, 8)
  out.writeUInt32BE(
    crc32(Buffer.concat([Buffer.from(type, 'ascii'), body])),
    8 + body.length,
  )
  return out
}

function encodePng(rgba, size) {
  const raw = Buffer.alloc(size * (1 + size * 4))
  for (let row = 0; row < size; row += 1) {
    rgba.copy(
      raw,
      row * (1 + size * 4) + 1,
      row * size * 4,
      (row + 1) * size * 4,
    )
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header[8] = 8
  header[9] = 6
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

const STOPS = [
  [68, 1, 84],
  [59, 82, 139],
  [33, 145, 140],
  [94, 201, 98],
  [253, 231, 37],
]

function ramp(value) {
  const t = Math.min(Math.max(value, 0), 1) * (STOPS.length - 1)
  const i = Math.min(Math.floor(t), STOPS.length - 2)
  const f = t - i
  return STOPS[i].map((c, k) => Math.round(c * (1 - f) + STOPS[i + 1][k] * f))
}

// ---------- 합성 실행 ----------

const PIXEL = 500
const RHO_MAX = 40_000
const HALF = Math.ceil(RHO_MAX / PIXEL) + 1
const SIZE = 2 * HALF + 1
const COARSE = 2000
const BLOCK = COARSE / PIXEL

function clamp01(v) {
  return Math.min(Math.max(v, 0), 1)
}

// 합성 지형: 영구 음영 분화구 몇 개와 부드러운 능선
const CRATERS = [
  [-12_000, 8_000, 6_000],
  [14_000, -6_000, 5_000],
  [3_000, 21_000, 4_500],
  [-20_000, -15_000, 5_500],
]

function sunAt(x, y) {
  for (const [cx, cy, r] of CRATERS)
    if (Math.hypot(x - cx, y - cy) < r) return 0
  const ang = Math.atan2(x, y)
  return clamp01(
    0.28 +
      0.22 * Math.sin(x / 7_500 + 0.6) * Math.cos(y / 6_000) +
      0.16 * Math.sin(ang * 3 + 1) +
      0.1 * Math.cos(Math.hypot(x, y) / 5_000),
  )
}

function earthAt(x, y) {
  const ang = Math.atan2(x, y)
  return clamp01(
    0.4 +
      0.3 * Math.sin(ang + 0.4) * (0.4 + Math.hypot(x, y) / RHO_MAX) +
      0.12 * Math.cos(x / 9_000) * Math.sin(y / 8_000),
  )
}

function lonLat(x, y) {
  const rho = Math.hypot(x, y)
  const lat = -90 + (2 * Math.atan(rho / (2 * R)) * 180) / Math.PI
  const lon = ((((Math.atan2(x, y) * 180) / Math.PI) % 360) + 360) % 360
  return { lat, lon }
}

function percentile(sorted, q) {
  if (sorted.length === 0) return 0
  return sorted[
    Math.min(Math.floor(q * (sorted.length - 1) + 0.5), sorted.length - 1)
  ]
}

function dist(values) {
  const s = values.toSorted((a, b) => a - b)
  const round = (v) => Number(v.toFixed(4))
  return {
    min: round(s[0] ?? 0),
    p10: round(percentile(s, 0.1)),
    p25: round(percentile(s, 0.25)),
    p50: round(percentile(s, 0.5)),
    p75: round(percentile(s, 0.75)),
    p90: round(percentile(s, 0.9)),
    max: round(s[s.length - 1] ?? 0),
  }
}

function buildSynthetic() {
  const threshold = 0.05
  const inside = (ix, iy, spacing) =>
    Math.hypot(ix * spacing, iy * spacing) <= RHO_MAX
  const key = (ix, iy) => `${ix},${iy}`

  const coarse = []
  const nC = Math.floor(RHO_MAX / COARSE)
  for (let iy = -nC; iy <= nC; iy += 1)
    for (let ix = -nC; ix <= nC; ix += 1)
      if (inside(ix, iy, COARSE)) {
        const x = ix * COARSE
        const y = iy * COARSE
        coarse.push({ ix, iy, sun: sunAt(x, y), earth: earthAt(x, y) })
      }
  const eligibleCoarse = coarse.filter((p) => p.sun >= threshold)
  const scores = eligibleCoarse
    .map((p) => 0.5 * (p.sun + p.earth))
    .sort((a, b) => a - b)
  const cutoff = percentile(scores, 0.75)
  const promoted = eligibleCoarse.filter(
    (p) => 0.5 * (p.sun + p.earth) >= cutoff,
  )

  const fineKeys = new Map()
  for (const p of promoted)
    for (let dy = -BLOCK; dy <= BLOCK; dy += 1)
      for (let dx = -BLOCK; dx <= BLOCK; dx += 1) {
        const ix = p.ix * BLOCK + dx
        const iy = p.iy * BLOCK + dy
        if (inside(ix, iy, PIXEL) && !fineKeys.has(key(ix, iy)))
          fineKeys.set(key(ix, iy), { ix, iy })
      }
  const fine = [...fineKeys.values()]
    .sort((a, b) => a.iy - b.iy || a.ix - b.ix)
    .map((p) => {
      const x = p.ix * PIXEL
      const y = p.iy * PIXEL
      const sun = sunAt(x, y)
      const earth = earthAt(x, y)
      return { ...p, x, y, sun, earth, eligible: sun >= threshold, region: 0 }
    })

  // 연결 영역 (8방향)
  const byKey = new Map(fine.map((p) => [key(p.ix, p.iy), p]))
  let regions = 0
  for (const start of fine) {
    if (!start.eligible || start.region) continue
    regions += 1
    start.region = regions
    const queue = [start]
    while (queue.length) {
      const p = queue.pop()
      for (let dy = -1; dy <= 1; dy += 1)
        for (let dx = -1; dx <= 1; dx += 1) {
          const q = byKey.get(key(p.ix + dx, p.iy + dy))
          if (q?.eligible && !q.region) {
            q.region = regions
            queue.push(q)
          }
        }
    }
  }

  // 선정: 구역 대표 먼저, 그다음 점수 순. 최소 간격 2 km, 최대 20곳
  const topK = 20
  const minSep = 2000
  const score = (p) => 0.5 * (p.sun + p.earth)
  const ordered = fine
    .filter((p) => p.eligible)
    .sort((a, b) => score(b) - score(a) || a.y - b.y || a.x - b.x)
  const chosen = []
  const far = (p) =>
    chosen.every((c) => Math.hypot(c.x - p.x, c.y - p.y) >= minSep)
  const firstOfRegion = new Set()
  for (const p of ordered) {
    if (chosen.length >= topK) break
    if (firstOfRegion.has(p.region)) continue
    if (far(p)) {
      chosen.push({ ...p, pickedAs: 'region_best' })
      firstOfRegion.add(p.region)
    }
  }
  for (const p of ordered) {
    if (chosen.length >= topK) break
    if (!chosen.some((c) => c.ix === p.ix && c.iy === p.iy) && far(p))
      chosen.push({ ...p, pickedAs: 'fill' })
  }
  chosen.sort((a, b) => score(b) - score(a) || a.y - b.y || a.x - b.x)

  const incomplete = (x, y) => Math.hypot(x, y) > 28_000
  const candidates = chosen.map((p, i) => {
    const { lat, lon } = lonLat(p.x, p.y)
    return {
      id: `SP500_${p.ix >= 0 ? '+' : ''}${p.ix}_${p.iy >= 0 ? '+' : ''}${p.iy}`,
      rank: i + 1,
      lat_deg: Number(lat.toFixed(6)),
      lon_deg: Number(lon.toFixed(6)),
      x_m: p.x,
      y_m: p.y,
      grid_spacing_m: PIXEL,
      sun: {
        fraction: Number(p.sun.toFixed(4)),
        longest_dark_hours: Number((24 * 40 * (1 - p.sun)).toFixed(2)),
        windows_per_24h: Number((0.02 + 0.08 * p.sun).toFixed(4)),
        mean_elevation_deg: Number((0.3 + 1.2 * p.sun).toFixed(3)),
      },
      earth: {
        fraction: Number(p.earth.toFixed(4)),
        longest_blackout_hours: Number((24 * 30 * (1 - p.earth)).toFixed(2)),
        windows_per_24h: Number((0.02 + 0.06 * p.earth).toFixed(4)),
        mean_elevation_deg: Number((1 + 5 * p.earth).toFixed(3)),
      },
      eligibility: { status: 'eligible', failed: [], not_applied: [] },
      score: {
        total: Number(score(p).toFixed(6)),
        sun_component: Number(p.sun.toFixed(4)),
        earth_component: Number(p.earth.toFixed(4)),
        components_used: 2,
      },
      region_id: p.region,
      data_quality: {
        horizon_complete: !incomplete(p.x, p.y),
        horizon_max_deg: Number((1.5 + 3 * (1 - p.sun)).toFixed(3)),
        missing_metrics: [],
        stage: 'fine',
      },
      selection: { picked_as: p.pickedAs, note: '' },
    }
  })

  // 레이어 래스터
  const layers = Object.fromEntries(
    LAYER_NAMES.map((name) => [name, Buffer.alloc(SIZE * SIZE * 4)]),
  )
  function paint(name, ix, iy, block, [r, g, b, a = 255]) {
    const buf = layers[name]
    const col = ix * block + HALF
    const row = HALF - iy * block
    for (
      let dr = -Math.floor(block / 2);
      dr < block - Math.floor(block / 2);
      dr += 1
    )
      for (
        let dc = -Math.floor(block / 2);
        dc < block - Math.floor(block / 2);
        dc += 1
      ) {
        const rr = row + dr
        const cc = col + dc
        if (rr < 0 || rr >= SIZE || cc < 0 || cc >= SIZE) continue
        const o = (rr * SIZE + cc) * 4
        buf[o] = r
        buf[o + 1] = g
        buf[o + 2] = b
        buf[o + 3] = a
      }
  }
  const promotedKeys = new Set(promoted.map((p) => key(p.ix, p.iy)))
  for (const p of coarse) {
    paint('coarse_sun', p.ix, p.iy, BLOCK, ramp(p.sun))
    paint('coarse_earth', p.ix, p.iy, BLOCK, ramp(p.earth))
    if (promotedKeys.has(key(p.ix, p.iy)))
      paint('coarse_promoted', p.ix, p.iy, BLOCK, [243, 156, 18])
    // 최종 레이어: 세밀화되지 않은 거친 점은 거친 값으로 남는다
    if (!promotedKeys.has(key(p.ix, p.iy))) {
      paint('sun', p.ix, p.iy, BLOCK, ramp(p.sun))
      paint('earth', p.ix, p.iy, BLOCK, ramp(p.earth))
      paint('stage', p.ix, p.iy, BLOCK, [127, 140, 160])
      paint(
        'eligibility',
        p.ix,
        p.iy,
        BLOCK,
        p.sun >= threshold ? [46, 204, 113] : [231, 76, 60],
      )
      if (incomplete(p.ix * COARSE, p.iy * COARSE))
        paint('quality', p.ix, p.iy, BLOCK, [243, 156, 18])
    }
  }
  const palette = [
    [230, 25, 75],
    [60, 180, 75],
    [255, 225, 25],
    [0, 130, 200],
    [245, 130, 48],
    [145, 30, 180],
    [70, 240, 240],
    [240, 50, 230],
  ]
  for (const p of fine) {
    paint('sun', p.ix, p.iy, 1, ramp(p.sun))
    paint('earth', p.ix, p.iy, 1, ramp(p.earth))
    paint('stage', p.ix, p.iy, 1, [26, 188, 156])
    paint(
      'eligibility',
      p.ix,
      p.iy,
      1,
      p.eligible ? [46, 204, 113] : [231, 76, 60],
    )
    if (p.region)
      paint('regions', p.ix, p.iy, 1, palette[p.region % palette.length])
    if (incomplete(p.x, p.y)) paint('quality', p.ix, p.iy, 1, [243, 156, 18])
  }
  const pngs = Object.fromEntries(
    LAYER_NAMES.map((name) => [name, encodePng(layers[name], SIZE)]),
  )

  const all = [
    ...coarse.filter((p) => !promotedKeys.has(key(p.ix, p.iy))),
    ...fine,
  ]
  const excluded = all.filter((p) => !(p.eligible ?? p.sun >= threshold)).length
  const eligible = all.length - excluded
  const notRefined = coarse.filter(
    (p) => !promotedKeys.has(key(p.ix, p.iy)) && p.sun >= threshold,
  ).length
  const fineEligible = fine.filter((p) => p.eligible).length
  const incompleteCount = all.filter((p) =>
    incomplete(p.x ?? p.ix * COARSE, p.y ?? p.iy * COARSE),
  ).length
  const window = {
    start: '2027-01-01T00:00:00Z',
    end: '2046-01-01T00:00:00Z',
    step_minutes: 60,
  }
  const config = {
    roi: { min_lat_deg: -90, max_lat_deg: lonLat(RHO_MAX, 0).lat },
    grid_spacing_m: PIXEL,
    coarse_spacing_m: COARSE,
    refine_fraction: 0.25,
    min_separation_m: minSep,
    top_k: topK,
    thresholds: {
      min_sun_fraction: threshold,
      max_sun_dark_hours: null,
      min_earth_fraction: null,
      max_earth_blackout_hours: null,
    },
    weights: { sun: 0.5, earth: 0.5 },
    window,
    dem: '80s_80m',
    observer_height_m: 0,
    max_range_m: 200_000,
    workers: null,
  }
  const summary = {
    counts: {
      coarse_sampled: coarse.length,
      promoted_coarse: promoted.length,
      refined: fine.length,
      coarse_only: all.length - fine.length,
      sampled_total: all.length,
      computed: all.length,
      missing_all_metrics: 0,
      eligible,
      excluded,
      unevaluated: 0,
      horizon_incomplete: incompleteCount,
      regions,
      selected: candidates.length,
    },
    reasons: {
      sun_fraction_below_min: excluded,
      not_refined: notRefined,
      within_min_separation:
        (Math.max(fineEligible - candidates.length, 0) * 0.6) | 0,
      beyond_top_k: (Math.max(fineEligible - candidates.length, 0) * 0.4) | 0,
    },
    distributions: {
      sun_fraction: dist(all.map((p) => p.sun)),
      earth_fraction: dist(all.map((p) => p.earth)),
      sun_longest_dark_h: dist(all.map((p) => 24 * 40 * (1 - p.sun))),
      earth_longest_blackout_h: dist(all.map((p) => 24 * 30 * (1 - p.earth))),
    },
    warnings: [
      '[합성 데이터] 이 화면은 스텁 서버가 만든 가짜 결과입니다. 실제 계산 결과가 아닙니다.',
      '격자 간격 500 m는 DEM 해상도 80 m의 6.25배로 더 거칩니다. 수십 m 폭의 좁은 일조 지점은 놓칠 수 있습니다.',
      `${incompleteCount}개 지점(${Math.round((100 * incompleteCount) / all.length)}%)의 수평선이 DEM 범위 밖으로 나갑니다. DEM 밖 지형은 알 수 없어 수평선이 낮게 계산됐을 수 있습니다(data_quality.horizon_complete=false).`,
    ],
  }
  const source = {
    dem: {
      name: '80s_80m',
      file: 'ldem_80s_80m_float.img',
      sha256:
        '42a643ef7fea0000000000000000000000000000000000000000000000000000',
      resolution_m: 80,
    },
    spice_kernels: [
      {
        name: 'de440s.bsp',
        sha256:
          'c1c7feeab8820000000000000000000000000000000000000000000000000000',
      },
    ],
    window,
    projection: 'polar stereographic (stub)',
    plan_id: 'south_polar_dense',
  }
  const run = {
    generated_at: '2026-11-14T20:01:12+00:00',
    elapsed_seconds: 812.4,
    workers: 14,
  }
  const map = {
    size_px: SIZE,
    center_px: HALF,
    pixel_size_m: PIXEL,
    rho_max_m: RHO_MAX,
    layers: LAYER_NAMES,
  }
  return {
    id: 'synthetic',
    source,
    config,
    summary,
    run,
    map,
    candidates,
    pngs,
  }
}

let syntheticCache = null
function synthetic() {
  syntheticCache ??= buildSynthetic()
  return syntheticCache
}

// ---------- 실제 실행 디렉터리 ----------

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function realRunIds(dir) {
  return readdirSync(dir)
    .filter(
      (name) =>
        RUN_ID.test(name) && existsSync(join(dir, name, 'candidates.json')),
    )
    .sort()
}

function fallbackMap(config, layersDir) {
  const rho = 2 * R * Math.tan(((90 + config.roi.max_lat_deg) * Math.PI) / 360)
  const half = Math.ceil(rho / config.grid_spacing_m) + 1
  const layers = existsSync(layersDir)
    ? readdirSync(layersDir)
        .filter((f) => f.endsWith('.png'))
        .map((f) => f.slice(0, -4))
    : []
  return {
    size_px: 2 * half + 1,
    center_px: half,
    pixel_size_m: config.grid_spacing_m,
    rho_max_m: rho,
    layers,
  }
}

function realDetail(dir, id) {
  const base = join(dir, id)
  const doc = readJson(join(base, 'candidates.json'))
  const sumPath = join(base, 'summary.json')
  const sum = existsSync(sumPath) ? readJson(sumPath) : {}
  const mapPath = join(base, 'map.json')
  const map = existsSync(mapPath)
    ? readJson(mapPath)
    : fallbackMap(doc.config, join(base, 'layers'))
  return {
    id,
    source: doc.source,
    config: doc.config,
    summary: {
      ...doc.summary,
      reasons: doc.summary.reasons ?? sum.reasons ?? {},
    },
    run: sum.run ?? {
      generated_at: statSync(join(base, 'candidates.json')).mtime.toISOString(),
      elapsed_seconds: 0,
      workers: 0,
    },
    map,
    candidates: doc.candidates,
  }
}

// ---------- 라우팅 ----------

function sendJson(res, status, body) {
  res.writeHead(status, {
    'content-type': 'application/json',
    'access-control-allow-origin': '*',
  })
  res.end(JSON.stringify(body))
}

function sendPng(res, buf) {
  res.writeHead(200, {
    'content-type': 'image/png',
    'access-control-allow-origin': '*',
    'cache-control': 'no-cache',
  })
  res.end(buf)
}

/** /candidates/* 요청이면 처리하고 true, 아니면 false. */
export function handleCandidates(pathname, res) {
  if (!pathname.startsWith('/candidates')) return false
  const dir = process.env.CANDIDATES_DIR
  const real = dir !== undefined && dir !== '' && existsSync(dir)

  if (pathname === '/candidates/runs') {
    if (!real) {
      const s = synthetic()
      sendJson(res, 200, {
        runs: [
          {
            id: s.id,
            generated_at: s.run.generated_at,
            dem: s.config.dem,
            window: s.config.window,
            selected: s.candidates.length,
            sampled_total: s.summary.counts.sampled_total,
          },
        ],
      })
      return true
    }
    const runs = realRunIds(dir).map((id) => {
      const d = realDetail(dir, id)
      return {
        id,
        generated_at: d.run.generated_at,
        dem: d.source.dem.name,
        window: d.source.window,
        selected: d.summary.counts.selected ?? d.candidates.length,
        sampled_total: d.summary.counts.sampled_total ?? 0,
      }
    })
    sendJson(res, 200, { runs })
    return true
  }

  const detail = /^\/candidates\/runs\/([^/]+)$/.exec(pathname)
  const layer = /^\/candidates\/runs\/([^/]+)\/layers\/([a-z_]+)\.png$/.exec(
    pathname,
  )
  const id = (detail ?? layer)?.[1]
  if (id === undefined) {
    sendJson(res, 404, { detail: 'Not Found' })
    return true
  }
  if (!RUN_ID.test(id)) {
    sendJson(res, 422, { detail: 'invalid run id' })
    return true
  }
  if (id === 'boom') {
    sendJson(res, 500, { detail: 'stub: simulated server error' })
    return true
  }
  if (!real) {
    const s = synthetic()
    if (id !== s.id) {
      sendJson(res, 404, { detail: 'run not found' })
      return true
    }
    if (detail) {
      const { pngs: _pngs, ...body } = s
      sendJson(res, 200, body)
    } else if (layer && s.pngs[layer[2]]) sendPng(res, s.pngs[layer[2]])
    else sendJson(res, 404, { detail: 'layer not found' })
    return true
  }
  if (!existsSync(join(dir, id, 'candidates.json'))) {
    sendJson(res, 404, { detail: 'run not found' })
    return true
  }
  if (detail) {
    sendJson(res, 200, realDetail(dir, id))
    return true
  }
  const file = join(dir, id, 'layers', `${layer[2]}.png`)
  if (!existsSync(file)) sendJson(res, 404, { detail: 'layer not found' })
  else sendPng(res, readFileSync(file))
  return true
}
