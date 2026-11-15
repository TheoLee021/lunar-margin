import {
  horizonsReferenceUrl,
  siteCoordinates,
  type ReferenceSite,
} from './referenceLinks'

export function ReferenceTools({ site }: { site: ReferenceSite }) {
  return (
    <section
      aria-label="JPL Horizons reference ephemeris"
      className="mt-4 border-t border-white/10 pt-3"
    >
      <h3 className="text-xs font-semibold text-neutral-200">
        JPL Horizons · Reference Ephemeris
      </h3>
      <p className="mt-1 text-[11px] leading-relaxed text-neutral-400">
        선택한 착륙지와 날짜에서 태양·지구의 방위각 및 고도각을 JPL Horizons로
        별도 조회합니다. 자동 비교 또는 검증 완료를 의미하지 않습니다.
      </p>
      <p className="mt-2 font-mono text-[11px] text-neutral-300">
        {siteCoordinates(site)}
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <a
          className="hud-button"
          href={horizonsReferenceUrl(site, 'sun')}
          target="_blank"
          rel="noopener noreferrer"
        >
          Horizons · Sun ↗
        </a>
        <a
          className="hud-button"
          href={horizonsReferenceUrl(site, 'earth')}
          target="_blank"
          rel="noopener noreferrer"
        >
          Horizons · Earth ↗
        </a>
      </div>
      <p className="mt-2 text-[10px] leading-relaxed text-neutral-500">
        24시간·2시간 간격의 참고 천체 위치입니다. 주변 지형 차폐 및 실제 RF
        링크는 반영하지 않으며, Lunar Margin의 MOON_ME 좌표계와 기준 고도는 별도
        대조가 필요합니다.
      </p>
    </section>
  )
}
