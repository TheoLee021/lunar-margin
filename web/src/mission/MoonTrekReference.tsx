/** Standalone reference viewer; not a NASA Moon Trek imagery overlay. */
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
    <section
      className="mt-4 border-t border-white/10 pt-3 text-xs"
      aria-label="NASA Moon Trek external map"
    >
      <h3 className="font-semibold text-neutral-200">
        NASA Moon Trek · Map Reference
      </h3>
      <p className="mt-1 text-[11px] text-neutral-400">
        NASA Moon Trek에서 지형 레이어를 별도로 확인할 수 있습니다. 선택한 좌표를
        참고해 지도에서 직접 찾으세요.
      </p>
      <p className="mt-2 font-mono text-[11px] text-neutral-300">
        {latitude.toFixed(5)}° latitude · {east.toFixed(5)}° E longitude
      </p>
      <a
        className="hud-button mt-2 inline-flex"
        href={MOON_TREK_URL}
        target="_blank"
        rel="noopener noreferrer"
      >
        Open NASA Moon Trek ↗
      </a>
      <p className="mt-2 text-[10px] text-neutral-500">
        외부 참고 지도입니다. 자동 좌표 이동, WMTS 오버레이 또는 독립 검증은
        포함되지 않습니다.
      </p>
    </section>
  )
}
