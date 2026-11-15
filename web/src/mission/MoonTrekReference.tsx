const MOON_TREK_URL = 'https://trek.nasa.gov/moon/'

export function MoonTrekReference({
  latitude,
  longitude,
}: {
  latitude: number
  longitude: number
}) {
  const east = ((longitude % 360) + 360) % 360
  return (
    <section aria-label="NASA Moon Trek" className="mt-4 border-t pt-3">
      <h3>NASA Moon Trek · External Map</h3>
      <p className="text-xs">
        {latitude.toFixed(5)}° latitude · {east.toFixed(5)}° E longitude
      </p>
      <a
        className="hud-button mt-2 inline-flex"
        href={MOON_TREK_URL}
        target="_blank"
        rel="noopener noreferrer"
      >
        Open Moon Trek ↗
      </a>
      <p className="mt-2 text-xs text-neutral-400">
        Manual reference only. No WMTS overlay or automatic validation.
      </p>
    </section>
  )
}
