import { useState } from 'react'
import {
  horizonsReferenceUrl,
  MOON_TREK_URL,
  MOON_TREK_WMTS_DOCS,
  siteCoordinates,
  type ReferenceSite,
} from './referenceLinks'

export function ReferenceTools({ site }: { site: ReferenceSite }) {
  const [copyStatus, setCopyStatus] = useState('')
  const coordinates = siteCoordinates(site)
  function copyCoordinates() {
    void navigator.clipboard
      .writeText(coordinates)
      .then(() => setCopyStatus('좌표 복사 완료'))
      .catch(() => setCopyStatus('복사할 수 없습니다. 위의 좌표를 직접 사용하세요.'))
  }
  return (
    <section aria-label="NASA 참고 도구" className="mt-4 border-t border-white/10 pt-3">
      <h3 className="text-xs font-semibold text-neutral-200">NASA Reference Tools</h3>
      <p className="mt-1 text-[11px] leading-relaxed text-neutral-400">
        선택한 위치와 착륙일의 천체 위치를 JPL에서 조회하거나, Moon Trek에서 지형을
        별도로 확인합니다. 자동 검증이나 NASA 착륙 승인 결과는 아닙니다.
      </p>
      <p className="mt-2 font-mono text-[11px] text-neutral-300">{coordinates}</p>
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
        <a
          className="hud-button"
          href={MOON_TREK_URL}
          target="_blank"
          rel="noopener noreferrer"
        >
          Moon Trek ↗
        </a>
        <button className="hud-button" type="button" onClick={copyCoordinates}>
          좌표 복사
        </button>
      </div>
      {copyStatus ? (
        <p role="status" className="mt-1 text-[10px] text-neutral-300">
          {copyStatus}
        </p>
      ) : null}
      <p className="mt-2 text-[10px] leading-relaxed text-neutral-500">
        Horizons: 24시간, 2시간 간격의 공기 없는 기하 수평선 대비 방위각/고도각.
        인근 지형 차폐는 포함하지 않습니다. Moon Trek은 별도 지도이며 좌표를 수동으로
        찾아야 합니다.{' '}
        <a
          className="underline underline-offset-2 hover:text-neutral-200"
          href={MOON_TREK_WMTS_DOCS}
          target="_blank"
          rel="noopener noreferrer"
        >
          WMTS 설명
        </a>
        .
      </p>
    </section>
  )
}
