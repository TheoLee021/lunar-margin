// 백엔드 없이 프론트를 띄우기 위한 스텁 API (의존성 없음). docs/api.md 계약을 따른다.
//   node scripts/stub-api.mjs          → http://localhost:8000
// 값은 물리 계산이 아니라 그럴듯한 합성 데이터다.
//   lat=-88.888 → 500,  lat=-87.777 → 항상 암흑(windows 비어 있음)
import { createServer } from 'node:http'

const PORT = Number(process.env.PORT ?? 8000)
const DAY_MS = 86_400_000

function json(res, status, body) {
  res.writeHead(status, {
    'content-type': 'application/json',
    'access-control-allow-origin': '*',
  })
  res.end(JSON.stringify(body))
}

function parseUtc(raw) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(Z|\+00:00)$/.test(raw ?? ''))
    return null
  const ms = Date.parse(raw)
  return Number.isNaN(ms) ? null : ms
}

function iso(ms) {
  return new Date(ms).toISOString().replace('.000Z', 'Z')
}

function validate(q) {
  const lat = Number(q.get('lat'))
  const lon = Number(q.get('lon'))
  const step = Number(q.get('step_minutes') ?? 30)
  const height = Number(q.get('observer_height_m') ?? 0)
  const start = parseUtc(q.get('start'))
  const end = parseUtc(q.get('end'))
  if (!Number.isFinite(lat) || lat < -90 || lat > -80)
    return 'lat must be in [-90, -80]'
  if (!Number.isFinite(lon)) return 'lon must be a number'
  if (!Number.isInteger(step) || step < 5 || step > 360)
    return 'step_minutes must be in [5, 360]'
  if (!Number.isFinite(height) || height < 0 || height > 100)
    return 'observer_height_m must be in [0, 100]'
  if (start === null || end === null)
    return 'start and end must be UTC ISO 8601 with timezone'
  if (end <= start) return 'end must be after start'
  if ((end - start) / DAY_MS > 3 * 366) return 'range must be at most 3 years'
  return { lat, lon, step, height, start, end }
}

function horizonProfile(lat, lon, height) {
  const azimuth = []
  const elevation = []
  const seed = Math.abs(lat * 7 + lon)
  for (let az = 0; az < 360; az += 1) {
    const rad = (az * Math.PI) / 180
    const base =
      0.9 +
      0.7 * Math.sin(rad * 2 + seed) +
      0.35 * Math.sin(rad * 5 + seed * 0.3) +
      0.2 * Math.sin(rad * 11)
    azimuth.push(az)
    elevation.push(Number((base - height * 0.004).toFixed(3)))
  }
  return { azimuth_deg: azimuth, elevation_deg: elevation }
}

function horizonAt(h, az) {
  const a = ((az % 360) + 360) % 360
  const i = Math.floor(a)
  const j = (i + 1) % 360
  const f = a - i
  return h.elevation_deg[i] * (1 - f) + h.elevation_deg[j] * f
}

function periodsOf(times, visible, wanted, stepMs) {
  const out = []
  let from = -1
  for (let i = 0; i <= visible.length; i += 1) {
    const on = i < visible.length && visible[i] === wanted
    if (on && from < 0) from = i
    if (!on && from >= 0) {
      out.push({ start: iso(times[from]), end: iso(times[i - 1] + stepMs) })
      from = -1
    }
  }
  return out
}

function analyze(kind, v, alwaysDark) {
  const stepMs = v.step * 60_000
  const horizon = horizonProfile(v.lat, v.lon, v.height)
  const times = []
  for (let t = v.start; t < v.end; t += stepMs) times.push(t)

  const azs = []
  const els = []
  const visible = []
  for (const t of times) {
    const days = (t - v.start) / DAY_MS
    let az
    let el
    if (kind === 'illumination') {
      az = (days * 360) / 29.53 + (v.lon % 360)
      el =
        1.5 * Math.sin((days * 2 * Math.PI) / 29.53 + 0.4) +
        0.2 * Math.sin(days * 2.1)
    } else {
      az = 200 + 25 * Math.sin((days * 2 * Math.PI) / 27.3) + (v.lon % 40)
      el =
        4.5 * Math.sin((days * 2 * Math.PI) / 27.3 + 1.1) +
        1.5 * Math.sin((days * 2 * Math.PI) / 365)
    }
    if (alwaysDark) el = -Math.abs(el) - 3
    az = ((az % 360) + 360) % 360
    azs.push(Number(az.toFixed(2)))
    els.push(Number(el.toFixed(3)))
    visible.push(el > horizonAt(horizon, az))
  }

  const windows = periodsOf(times, visible, true, stepMs)
  const darkPeriods = periodsOf(times, visible, false, stepMs)
  const visibleCount = visible.filter(Boolean).length
  const longestDark = darkPeriods.reduce(
    (max, p) =>
      Math.max(max, (Date.parse(p.end) - Date.parse(p.start)) / 3_600_000),
    0,
  )
  const spanDays = (v.end - v.start) / DAY_MS
  const visibleEls = els.filter((_, i) => visible[i])
  return {
    lat: v.lat,
    lon: v.lon,
    start: iso(v.start),
    end: iso(v.end),
    step_minutes: v.step,
    observer_height_m: v.height,
    metrics: {
      visible_fraction: Number((visibleCount / times.length).toFixed(4)),
      longest_dark_hours: Number(longestDark.toFixed(2)),
      windows_per_24h: Number((windows.length / spanDays).toFixed(3)),
      mean_elevation_deg: visibleEls.length
        ? Number(
            (visibleEls.reduce((a, b) => a + b, 0) / visibleEls.length).toFixed(
              3,
            ),
          )
        : null,
    },
    horizon,
    series: {
      times: times.map(iso),
      body_azimuth_deg: azs,
      body_elevation_deg: els,
      visible,
    },
    windows,
    dark_periods: darkPeriods,
  }
}

createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`)
  if (req.method === 'OPTIONS') return json(res, 204, {})
  if (url.pathname === '/health') return json(res, 200, { status: 'ok' })
  const match = /^\/analysis\/(illumination|earth-visibility)$/.exec(
    url.pathname,
  )
  if (!match) return json(res, 404, { detail: 'Not Found' })

  const checked = validate(url.searchParams)
  if (typeof checked === 'string') return json(res, 422, { detail: checked })
  if (checked.lat === -88.888)
    return json(res, 500, { detail: 'stub: simulated server error' })
  const kind = match[1] === 'illumination' ? 'illumination' : 'earth-visibility'
  return json(res, 200, analyze(kind, checked, checked.lat === -87.777))
}).listen(PORT, () => {
  console.log(`stub API listening on http://localhost:${PORT}`)
})
