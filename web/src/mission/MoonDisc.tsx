export function MoonDisc({
  x,
  y,
  radius,
  id,
}: {
  x: number
  y: number
  radius: number
  id: string
}) {
  const craters = [
    { x: 67, y: 54, r: 17 },
    { x: 46, y: 102, r: 11 },
    { x: 116, y: 129, r: 14 },
    { x: 145, y: 68, r: 9 },
    { x: 88, y: 163, r: 7 },
    { x: 158, y: 121, r: 6 },
  ]
  return (
    <g
      transform={`translate(${x - radius} ${y - radius}) scale(${radius / 100})`}
      className="orbit-moon-disc"
    >
      <title>달 · 반지름 1,737.4 km. 표면 음영과 크레이터는 도식입니다.</title>
      <defs>
        <radialGradient id={`${id}-surface`} cx="30%" cy="25%" r="80%">
          <stop stopColor="#e3e2dc" />
          <stop offset="0.42" stopColor="#b5b6b4" />
          <stop offset="0.76" stopColor="#747c81" />
          <stop offset="1" stopColor="#303c46" />
        </radialGradient>
        <radialGradient id={`${id}-crater`} cx="65%" cy="75%" r="80%">
          <stop stopColor="#c8c9c5" stopOpacity="0.1" />
          <stop offset="1" stopColor="#35414a" stopOpacity="0.55" />
        </radialGradient>
        <clipPath id={`${id}-clip`}>
          <circle cx="100" cy="100" r="100" />
        </clipPath>
      </defs>
      <circle
        cx="100"
        cy="100"
        r="100"
        fill={`url(#${id}-surface)`}
        className="orbit-lunar-limb"
      />
      <g clipPath={`url(#${id}-clip)`}>
        <path
          d="M27 77Q48 52 77 77T118 82Q132 104 111 113T76 136Q59 146 43 121T27 77Z"
          fill="#4e5b64"
          opacity="0.16"
        />
        <path
          d="M109 22Q148 23 165 45T163 80Q141 85 129 64T109 22Z"
          fill="#4e5b64"
          opacity="0.13"
        />
        {craters.map((c) => (
          <g key={`${c.x}-${c.y}`}>
            <circle cx={c.x} cy={c.y} r={c.r} fill={`url(#${id}-crater)`} />
            <path
              d={`M${c.x - c.r * 0.75} ${c.y + c.r * 0.66} A${c.r} ${c.r} 0 0 0 ${c.x + c.r * 0.85} ${c.y - c.r * 0.5}`}
              fill="none"
              stroke="#e4e5df"
              strokeOpacity="0.24"
              strokeWidth="1.3"
            />
          </g>
        ))}
      </g>
    </g>
  )
}
