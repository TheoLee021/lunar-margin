import { compact, dayOf, exampleCost } from './missionDates'
import type { Schedule } from './types'

export function TransferOrbit({ schedule }: { schedule: Schedule }) {
  const flight = dayOf(schedule.landing) - dayOf(schedule.departure)
  const bend = Math.max(-10, 24 - flight * 4)
  const price = exampleCost(dayOf(schedule.departure), dayOf(schedule.landing))
  return (
    <section className="transfer-section">
      <div className="window-toolbar">
        <div>
          <div className="section-kicker">EARTH → MOON</div>
          <h3>지구–달 비행 궤도</h3>
        </div>
        <span className="example-label">개념도 · 축척 없음</span>
      </div>
      <svg
        viewBox="0 0 760 235"
        role="img"
        aria-label={`선택한 ${flight}일 비행의 지구에서 달까지 개념 궤도`}
      >
        <defs>
          <radialGradient id="earthShade" cx="30%" cy="25%">
            <stop stopColor="#9bd3ed" />
            <stop offset=".5" stopColor="#39799b" />
            <stop offset="1" stopColor="#112936" />
          </radialGradient>
          <radialGradient id="moonShade" cx="30%" cy="25%">
            <stop stopColor="#e9e5dc" />
            <stop offset="1" stopColor="#585b60" />
          </radialGradient>
        </defs>
        <g stroke="#a3b2c4" strokeOpacity=".09">
          {[60, 100, 140, 180].map((y) => (
            <path key={y} d={`M25 ${y}H735`} />
          ))}
          {[80, 180, 280, 380, 480, 580, 680].map((x) => (
            <path key={x} d={`M${x} 20V210`} />
          ))}
        </g>
        <ellipse
          cx="115"
          cy="133"
          rx="66"
          ry="23"
          fill="none"
          stroke="#6c9ab4"
          strokeDasharray="3 5"
          transform="rotate(-22 115 133)"
        />
        <path
          d={`M153 108 C270 ${bend}, 499 ${bend}, 624 104`}
          fill="none"
          stroke="#edb969"
          strokeWidth="2.5"
        />
        <ellipse
          cx="641"
          cy="126"
          rx="32"
          ry="47"
          transform="rotate(35 641 126)"
          fill="none"
          stroke="#edb969"
          strokeOpacity=".65"
        />
        <path
          d="M179 150 C320 208 510 208 625 150"
          fill="none"
          stroke="#728596"
          strokeDasharray="4 6"
          opacity=".4"
        />
        <circle cx="115" cy="133" r="39" fill="url(#earthShade)" />
        <path
          d="M91 105l13 4 5 12-9 11 13 8-3 17-12-10-9-21zM123 100l14 10-2 10-11-4-6-9"
          fill="#a4c0a6"
          opacity=".6"
        />
        <circle cx="641" cy="126" r="22" fill="url(#moonShade)" />
        <g fill="#787b80" opacity=".4">
          <circle cx="637" cy="120" r="6" />
          <circle cx="649" cy="133" r="4" />
        </g>
        <circle cx="153" cy="108" r="4" fill="#b6d9ea" />
        <circle cx="624" cy="104" r="4" fill="#edb969" />
        <g transform={`translate(383 ${26.5 + bend * 0.75}) rotate(5)`}>
          <path d="M-9 0L8 -4 16 0 8 4z" fill="#f2e6cd" />
          <path d="M-11 -2l-10 2 10 2" fill="#edb969" />
        </g>
        <g fontFamily="var(--f-mono)">
          <text
            x="115"
            y="201"
            textAnchor="middle"
            fill="#a7b5c3"
            fontSize="11"
            letterSpacing="2"
          >
            EARTH
          </text>
          <text
            x="641"
            y="201"
            textAnchor="middle"
            fill="#a7b5c3"
            fontSize="11"
            letterSpacing="2"
          >
            MOON
          </text>
          <text
            x="380"
            y="137"
            textAnchor="middle"
            fill="#edb969"
            fontSize="13"
          >
            {flight} DAY TRANSFER
          </text>
          <text
            x="380"
            y="157"
            textAnchor="middle"
            fill="#83919e"
            fontSize="10"
          >
            Illustrative flight path · not to scale
          </text>
        </g>
      </svg>
      <div className="transfer-stats">
        <div>
          <span>지구 출발 · UTC</span>
          <strong>{compact(schedule.departure)}</strong>
        </div>
        <div>
          <span>달 착륙 · UTC</span>
          <strong>{compact(schedule.landing)}</strong>
        </div>
        <div>
          <span>비행 시간</span>
          <strong>
            {flight * 24} <small>h</small>
          </strong>
        </div>
        <div>
          <span>예시 비용</span>
          <strong className="cost-accent">
            ${price?.toFixed(1)} <small>M</small>
          </strong>
        </div>
      </div>
    </section>
  )
}
