import type { LayerName } from '../api/candidates'
import { LAYER_NAMES } from '../api/candidates'
import {
  LAYER_LABELS,
  layerStackOrder,
  type LayerState,
  type LayerStates,
} from './derive'

// 백엔드가 칠하는 색과 같다 (docs/api.md 레이어 표).
const RAMP =
  'linear-gradient(90deg, rgb(68,1,84), rgb(59,82,139), rgb(33,145,140), rgb(94,201,98), rgb(253,231,37))'

function Swatch({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        aria-hidden
        className="inline-block size-3 rounded-sm"
        style={{ background: color }}
      />
      {label}
    </span>
  )
}

function Ramp({ title }: { title: string }) {
  return (
    <div className="min-w-48">
      <p className="mb-1">{title}</p>
      <div
        aria-hidden
        className="h-2.5 rounded-full"
        style={{ background: RAMP }}
      />
      <div className="mt-0.5 flex justify-between text-[10px] text-neutral-500">
        <span>0%</span>
        <span>50%</span>
        <span>100%</span>
      </div>
    </div>
  )
}

/** 켜진 레이어에 해당하는 범례만 보여 준다. 투명한 곳은 결측(값 없음)이다. */
export function MapLegend({ layers }: { layers: LayerStates }) {
  const on = layerStackOrder(LAYER_NAMES.filter((name) => layers[name].on))
  if (on.length === 0)
    return (
      <p className="text-xs text-neutral-500">
        켜진 레이어가 없습니다. 아래 &lsquo;레이어&rsquo;에서 선택하세요.
      </p>
    )
  return (
    <div
      aria-label="범례"
      className="flex flex-wrap items-start gap-x-6 gap-y-3 rounded-lg border border-neutral-800 bg-neutral-900/40 px-4 py-3 text-xs text-neutral-300"
    >
      {on.map((name) => {
        switch (name) {
          case 'coarse_sun':
          case 'sun':
            return (
              <Ramp key={name} title={`${LAYER_LABELS[name]} (낮음 → 높음)`} />
            )
          case 'coarse_earth':
          case 'earth':
            return (
              <Ramp key={name} title={`${LAYER_LABELS[name]} (낮음 → 높음)`} />
            )
          case 'coarse_promoted':
            return (
              <Swatch
                key={name}
                color="rgb(243,156,18)"
                label="세밀화로 고른 영역"
              />
            )
          case 'stage':
            return (
              <div key={name} className="flex flex-col gap-1">
                <Swatch color="rgb(26,188,156)" label="세밀하게 계산한 곳" />
                <Swatch color="rgb(127,140,160)" label="거친 값만 있는 곳" />
              </div>
            )
          case 'eligibility':
            return (
              <div key={name} className="flex flex-col gap-1">
                <Swatch color="rgb(46,204,113)" label="적격" />
                <Swatch color="rgb(231,76,60)" label="제외" />
                <Swatch color="rgb(127,140,141)" label="판정 불가" />
              </div>
            )
          case 'regions':
            return (
              <span key={name} className="self-center">
                연결 영역마다 다른 색
              </span>
            )
          case 'quality':
            return (
              <Swatch
                key={name}
                color="rgb(243,156,18)"
                label="수평선이 높이 지도 밖으로 나감"
              />
            )
        }
      })}
      <p className="basis-full text-[11px] text-neutral-500">
        투명한 곳은 값이 없다는 뜻입니다(0이 아닙니다).
      </p>
    </div>
  )
}

interface ControlsProps {
  available: readonly string[]
  layers: LayerStates
  showCandidates: boolean
  onLayerChange: (name: LayerName, patch: Partial<LayerState>) => void
  onShowCandidates: (value: boolean) => void
}

/** 레이어를 직접 켜고 끄고 투명도를 바꾼다. 단계를 바꾸면 기본 설정으로 돌아간다. */
export function LayerControls({
  available,
  layers,
  showCandidates,
  onLayerChange,
  onShowCandidates,
}: ControlsProps) {
  const names = LAYER_NAMES.filter((name) => available.includes(name))
  return (
    <details className="rounded-lg border border-neutral-800 bg-neutral-900/40 px-4 py-3 text-sm">
      <summary className="cursor-pointer text-neutral-200">
        레이어 직접 조절
      </summary>
      <ul className="mt-3 flex flex-col gap-2">
        {names.map((name) => (
          <li key={name} className="flex items-center gap-3">
            <label className="flex min-w-0 flex-1 items-center gap-2 text-neutral-300">
              <input
                type="checkbox"
                checked={layers[name].on}
                onChange={(event) =>
                  onLayerChange(name, { on: event.target.checked })
                }
              />
              <span className="truncate">{LAYER_LABELS[name]}</span>
            </label>
            <label className="flex items-center gap-2 text-xs text-neutral-500">
              <span className="sr-only">{LAYER_LABELS[name]} 투명도</span>
              <input
                type="range"
                min={0.1}
                max={1}
                step={0.05}
                value={layers[name].opacity}
                onChange={(event) =>
                  onLayerChange(name, { opacity: Number(event.target.value) })
                }
                className="w-24"
              />
              <span className="w-8 text-right tabular-nums">
                {Math.round(layers[name].opacity * 100)}%
              </span>
            </label>
          </li>
        ))}
        <li>
          <label className="flex items-center gap-2 text-neutral-300">
            <input
              type="checkbox"
              checked={showCandidates}
              onChange={(event) => onShowCandidates(event.target.checked)}
            />
            선정 후보 번호 표시
          </label>
        </li>
      </ul>
    </details>
  )
}
