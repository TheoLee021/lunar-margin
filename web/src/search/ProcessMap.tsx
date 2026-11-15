import { useState, type KeyboardEvent, type MouseEvent } from 'react'
import { layerUrl, type Candidate, type RunDetail } from '../api/candidates'
import {
  LAYER_LABELS,
  fractionText,
  imageToXy,
  layerStackOrder,
  xyToImage,
  type LayerStates,
} from './derive'

interface Props {
  runId: string
  map: RunDetail['map']
  layers: LayerStates
  candidates: readonly Candidate[]
  showCandidates: boolean
  highlightedId: string | null
  selectedId: string | null
  selectedPoint: { x_m: number; y_m: number } | null
  /**
   * 후보 마커 반지름(지도 이미지 픽셀 단위). 후보끼리의 최소 간격보다 작아야
   * 이웃 후보의 마커가 서로를 가리지 않는다. SearchView 가 최소 간격에서 정한다.
   */
  markerRadius: number
  onHover: (id: string | null) => void
  onSelectCandidate: (id: string) => void
  onSelectPoint: (x_m: number, y_m: number) => void
}

const COMPASS = [
  { text: '경도 0°', x: 0.5, y: 0.03, anchor: 'middle' },
  { text: '90°E', x: 0.985, y: 0.5, anchor: 'end' },
  { text: '180°', x: 0.5, y: 0.985, anchor: 'middle' },
  { text: '270°E', x: 0.015, y: 0.5, anchor: 'start' },
] as const

export function ProcessMap({
  runId,
  map,
  layers,
  candidates,
  showCandidates,
  highlightedId,
  selectedId,
  selectedPoint,
  markerRadius,
  onHover,
  onSelectCandidate,
  onSelectPoint,
}: Props) {
  const size = map.size_px
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set())
  const stack = layerStackOrder(
    (Object.keys(layers) as (keyof typeof layers)[]).filter(
      (name) => layers[name].on,
    ),
  )
  const hovered =
    candidates.find((c) => c.id === (highlightedId ?? selectedId)) ?? null
  const marker = markerRadius
  const font = size / 38

  function handleClick(event: MouseEvent<SVGSVGElement>) {
    const rect = event.currentTarget.getBoundingClientRect()
    const u = ((event.clientX - rect.left) / rect.width) * size
    const v = ((event.clientY - rect.top) / rect.height) * size
    const { x_m, y_m } = imageToXy(u, v, map)
    onSelectPoint(x_m, y_m)
  }

  function handleMarkerKey(event: KeyboardEvent, id: string) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onSelectCandidate(id)
    }
  }

  const tip = hovered ? xyToImage(hovered.x_m, hovered.y_m, map) : null

  return (
    <div className="flex flex-col gap-2">
      <div
        role="group"
        aria-label="남극 탐색 지도. 경도 0도가 위쪽, 동쪽이 오른쪽입니다. 지도를 누르면 그 지점을 자세히 볼 수 있습니다."
        className="relative mx-auto aspect-square w-full max-w-[44rem] overflow-hidden rounded-xl border border-white/10 bg-black"
      >
        {stack.map((name) => (
          <img
            key={name}
            src={layerUrl(runId, name)}
            alt=""
            aria-hidden
            draggable={false}
            onError={() => setFailed((prev) => new Set(prev).add(name))}
            className="absolute inset-0 size-full select-none [image-rendering:pixelated]"
            style={{ opacity: layers[name].opacity }}
          />
        ))}
        <svg
          viewBox={`0 0 ${size} ${size}`}
          className="absolute inset-0 size-full cursor-crosshair"
          onClick={handleClick}
        >
          <circle
            cx={map.center_px + 0.5}
            cy={map.center_px + 0.5}
            r={map.rho_max_m / map.pixel_size_m}
            fill="none"
            stroke="white"
            strokeOpacity={0.55}
            strokeDasharray={`${size / 150} ${size / 150}`}
            strokeWidth={size / 600}
          />
          {COMPASS.map((item) => (
            <text
              key={item.text}
              x={item.x * size}
              y={item.y * size}
              textAnchor={item.anchor}
              dominantBaseline="middle"
              fontSize={font}
              fill="white"
              fillOpacity={0.8}
              stroke="black"
              strokeWidth={font / 6}
              paintOrder="stroke"
              pointerEvents="none"
            >
              {item.text}
            </text>
          ))}
          {selectedPoint ? (
            <PointMarker map={map} point={selectedPoint} radius={marker} />
          ) : null}
          {showCandidates
            ? candidates.map((c) => {
                const { u, v } = xyToImage(c.x_m, c.y_m, map)
                const active = c.id === highlightedId || c.id === selectedId
                return (
                  <g
                    key={c.id}
                    role="button"
                    tabIndex={0}
                    aria-label={`후보 ${c.rank}번 ${c.id}, 일조율 ${fractionText(c.sun.fraction)}, 지구 가시율 ${fractionText(c.earth.fraction)}`}
                    className="cursor-pointer outline-none"
                    onMouseEnter={() => onHover(c.id)}
                    onMouseLeave={() => onHover(null)}
                    onFocus={() => onHover(c.id)}
                    onBlur={() => onHover(null)}
                    onKeyDown={(event) => handleMarkerKey(event, c.id)}
                    onClick={(event) => {
                      event.stopPropagation()
                      onSelectCandidate(c.id)
                    }}
                  >
                    <circle
                      cx={u}
                      cy={v}
                      r={marker * (active ? 2.2 : 1)}
                      fill="black"
                      fillOpacity={0.35}
                      stroke={active ? '#f5c518' : 'white'}
                      strokeWidth={Math.max(marker / 3, size / 700)}
                    />
                    {c.rank <= 10 || active ? (
                      <text
                        x={u}
                        y={v - marker * 2.8}
                        textAnchor="middle"
                        fontSize={font * 0.75}
                        fill="white"
                        stroke="black"
                        strokeWidth={font / 6}
                        paintOrder="stroke"
                        pointerEvents="none"
                      >
                        {c.rank}
                      </text>
                    ) : null}
                  </g>
                )
              })
            : null}
        </svg>
        {hovered && tip ? (
          <div
            role="tooltip"
            className="pointer-events-none absolute z-10 w-max max-w-56 -translate-x-1/2 rounded-md border border-white/20 bg-[#0f1217]/95 px-2.5 py-1.5 text-[11px] leading-snug text-neutral-100 shadow-lg"
            style={{
              left: `${(tip.u / size) * 100}%`,
              top: `${(tip.v / size) * 100}%`,
              transform: `translate(-50%, ${tip.v / size > 0.5 ? '-130%' : '40%'})`,
            }}
          >
            <p className="font-semibold">
              #{hovered.rank} · {hovered.id}
            </p>
            <p>
              일조 {fractionText(hovered.sun.fraction)} · 지구{' '}
              {fractionText(hovered.earth.fraction)}
            </p>
            <p className="text-neutral-400">
              위도 {hovered.lat_deg.toFixed(3)}° · 경도{' '}
              {hovered.lon_deg.toFixed(2)}°E
            </p>
          </div>
        ) : null}
      </div>
      {failed.size > 0 ? (
        <p role="alert" className="text-xs text-red-300">
          일부 레이어를 불러오지 못했습니다:{' '}
          {[...failed]
            .map((name) =>
              name in LAYER_LABELS
                ? LAYER_LABELS[name as keyof typeof LAYER_LABELS]
                : name,
            )
            .join(', ')}
        </p>
      ) : null}
    </div>
  )
}

function PointMarker({
  map,
  point,
  radius,
}: {
  map: RunDetail['map']
  point: { x_m: number; y_m: number }
  radius: number
}) {
  const { u, v } = xyToImage(point.x_m, point.y_m, map)
  return (
    <g pointerEvents="none">
      <circle
        cx={u}
        cy={v}
        r={radius * 1.6}
        fill="none"
        stroke="#38bdf8"
        strokeWidth={map.size_px / 350}
        strokeDasharray={`${radius} ${radius * 0.8}`}
      />
      <circle cx={u} cy={v} r={radius * 0.35} fill="#38bdf8" />
    </g>
  )
}
