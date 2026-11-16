export const defaultApproach = { latitude: -89, longitude: 30, durationS: 720 }

export function approachFromUrl(params: URLSearchParams) {
  function number(key: string, fallback: number, min: number, max: number) {
    const raw = params.get(key)
    const value = raw?.trim() ? Number(raw) : NaN
    return Number.isFinite(value) && value >= min && value <= max
      ? value
      : fallback
  }
  return {
    latitude: number('lat', defaultApproach.latitude, -90, -80),
    longitude: number('lon', defaultApproach.longitude, -360, 360),
    durationS: number('descent_s', defaultApproach.durationS, 300, 1500),
  }
}
