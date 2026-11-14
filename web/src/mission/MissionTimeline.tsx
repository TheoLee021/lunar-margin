import { useId, useState } from 'react'
import type { Timeline } from './types'

function timeLabel(day: number) {
  const minutes = Math.round(day * 1440)
  return `D+${Math.floor(minutes / 1440)} ${String(Math.floor((minutes % 1440) / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
}
const degrees = (value: number) =>
  `${value < 0 ? '−' : ''}${Math.abs(value).toFixed(1)}°`

export function MissionTimeline({
  timeline: tl,
  duration,
  hour,
}: {
  timeline: Timeline
  duration: number
  hour: number
}) {
  const [inspection, setInspection] = useState<number | null>(null)
  const patternId = useId()
  if (tl.t.length === 0)
    return <p className="hint">선택한 기간의 분석 표본이 없습니다.</p>
  const current = Math.max(
    0,
    tl.t.findLastIndex((t) => t <= hour / 24),
  )
  const selected = Math.min(tl.t.length - 1, inspection ?? current)
  const width = 580,
    left = 43,
    plotWidth = 523,
    plotTop = 68,
    plotHeight = 145
  const X = (time: number) => left + (time / duration) * plotWidth
  const Y = (value: number) =>
    plotTop + (1 - (Math.max(-10, Math.min(12, value)) + 10) / 22) * plotHeight
  const series = [
    {
      key: 'sun',
      title: '태양',
      header: 20,
      bar: 245,
      color: 'var(--sun)',
      values: tl.sunEl,
      cutoff: tl.sunHz,
      visible: tl.sunVis,
      yes: '햇빛 있음',
      no: '햇빛 없음',
      barTitle: '햇빛',
    },
    {
      key: 'earth',
      title: '지구',
      header: 42,
      bar: 292,
      color: 'var(--earth)',
      values: tl.earthEl,
      cutoff: tl.earthHz.map((value) => value + 2),
      visible: tl.earthVis,
      yes: '지구 가시',
      no: '지구 차폐',
      barTitle: '지구 가시성',
    },
  ]
  return (
    <>
      <div className="mission-timeline-guide">
        <span>색 막대 = 가시 구간</span>
        <span className="timeline-blocked-key">빗금 = 차폐 구간</span>
      </div>
      <svg
        className="unified-timeline"
        viewBox={`0 0 ${width} 345`}
        role="img"
        aria-label="고도각과 햇빛·지구 가시성을 함께 표시하는 타임라인"
        onPointerDown={(event) => {
          const bounds = event.currentTarget.getBoundingClientRect()
          const time = Math.min(
            duration,
            Math.max(
              0,
              ((((event.clientX - bounds.left) / bounds.width) * width - left) /
                plotWidth) *
                duration,
            ),
          )
          setInspection(
            tl.t.reduce(
              (best, value, index) =>
                Math.abs(value - time) < Math.abs(tl.t[best] - time)
                  ? index
                  : best,
              0,
            ),
          )
        }}
      >
        <defs>
          <pattern
            id={patternId}
            width="6"
            height="6"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <line
              x1="0"
              y1="0"
              x2="0"
              y2="6"
              stroke="var(--muted)"
              strokeOpacity=".35"
              strokeWidth="2"
            />
          </pattern>
        </defs>
        <text x="0" y="61" fill="var(--muted)" fontSize="9">
          고도각 (°)
        </text>
        {[-8, -4, 0, 4, 8, 12].map((value) => (
          <g key={value}>
            <line
              x1={left}
              x2={left + plotWidth}
              y1={Y(value)}
              y2={Y(value)}
              stroke={value === 0 ? 'var(--muted)' : 'var(--line)'}
              strokeOpacity={value === 0 ? 0.5 : 1}
            />
            <text
              x={left - 8}
              y={Y(value) + 3}
              textAnchor="end"
              fill="var(--muted)"
              fontSize="10"
            >
              {value}
            </text>
          </g>
        ))}
        {series.map((s) => {
          const segments: { start: number; end: number; on: boolean }[] = []
          tl.t.slice(0, -1).forEach((start, index) => {
            const on = s.visible[index],
              last = segments[segments.length - 1]
            if (last && last.on === on) last.end = tl.t[index + 1]
            else segments.push({ start, end: tl.t[index + 1], on })
          })
          return (
            <g key={s.key}>
              <text
                x="0"
                y={s.header}
                fill={s.color}
                fontSize="13"
                fontWeight="500"
              >
                {s.title} {degrees(s.values[selected])} ·{' '}
                {s.visible[selected] ? s.yes : s.no}
              </text>
              <text
                x={width - 14}
                y={s.header}
                fill="var(--muted)"
                fontSize="9"
                textAnchor="end"
              >
                {s.key === 'sun'
                  ? '실선: 태양 / 점선: 지형 지평선'
                  : '실선: 지구 / 점선: 지평선 + 2°'}
              </text>
              <polyline
                points={tl.t
                  .map((t, i) => `${X(t)},${Y(s.cutoff[i])}`)
                  .join(' ')}
                fill="none"
                stroke={s.color}
                strokeOpacity=".5"
                strokeWidth="1.3"
                strokeDasharray="4 3"
              />
              <polyline
                points={tl.t
                  .map((t, i) => `${X(t)},${Y(s.values[i])}`)
                  .join(' ')}
                fill="none"
                stroke={s.color}
                strokeWidth="2.4"
              />
              <circle
                cx={X(tl.t[selected])}
                cy={Y(s.values[selected])}
                r="4"
                fill={s.color}
                stroke="var(--fg)"
                strokeWidth="1.4"
              />
              <text x={left} y={s.bar - 7} fill="var(--fg)" fontSize="11">
                {s.barTitle}
              </text>
              {segments.map((segment) => {
                const w = X(segment.end) - X(segment.start)
                return (
                  <g key={segment.start}>
                    <rect
                      x={X(segment.start)}
                      y={s.bar}
                      width={w}
                      height="24"
                      fill={segment.on ? s.color : `url(#${patternId})`}
                      stroke={segment.on ? s.color : 'var(--muted)'}
                      strokeWidth=".6"
                    />
                    <text
                      x={X(segment.start) + w / 2}
                      y={s.bar + 16}
                      textAnchor="middle"
                      fill={segment.on ? 'var(--bg)' : 'var(--fg)'}
                      fontSize="11"
                    >
                      {w > 64
                        ? segment.on
                          ? s.yes
                          : s.no
                        : segment.on
                          ? '●'
                          : '×'}
                    </text>
                  </g>
                )
              })}
            </g>
          )
        })}
        <line
          x1={X(tl.t[selected])}
          x2={X(tl.t[selected])}
          y1="65"
          y2="317"
          stroke="var(--fg)"
          strokeOpacity=".7"
          strokeDasharray="2 3"
        />
        {Array.from({ length: 8 }, (_, i) => (duration * i) / 7).map((t) => (
          <text
            key={t}
            x={X(t)}
            y="340"
            textAnchor="middle"
            fill="var(--muted)"
            fontSize="10"
          >
            D+{Number(t.toFixed(1))}
          </text>
        ))}
      </svg>
      <div className="timeline-inspection">
        <label htmlFor="timeline-inspection">검토 시점</label>
        <output htmlFor="timeline-inspection">
          {timeLabel(tl.t[selected])}
        </output>
        <input
          id="timeline-inspection"
          type="range"
          min={0}
          max={tl.t.length - 1}
          step={1}
          value={selected}
          aria-label="타임라인 검토 시점"
          onChange={(event) => setInspection(Number(event.target.value))}
        />
      </div>
      <p className="hint">
        그래프를 클릭하거나 시점을 이동해 확인하세요. 가로축은 착륙 후 경과
        시간입니다. 곡선과 상태는 예시이며 지구 가시성이 실제 통신 품질을
        뜻하지는 않습니다.
      </p>
    </>
  )
}
