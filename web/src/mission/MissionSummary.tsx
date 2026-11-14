import type { MissionSelection } from './types'

export function MissionSummary({ selection }: { selection: MissionSelection }) {
  return (
    <div className="space-y-3 text-left">
      <div className="flex items-center justify-between">
        <span className="text-xs text-neutral-400">출발일</span>
        <strong className="font-mono text-base">
          {selection.departure.replaceAll('-', '.')}
        </strong>
      </div>
      <div className="text-xs text-amber-400">↓ 지구 → 달</div>
      <div className="flex items-center justify-between">
        <span className="text-xs text-neutral-400">착륙일</span>
        <strong className="font-mono text-base">
          {selection.landing.replaceAll('-', '.')}
        </strong>
      </div>
      <div className="border-t border-white/10 pt-3 text-xs text-neutral-400">
        표면 임무{' '}
        <span className="text-neutral-100">{selection.duration}일</span>
      </div>
    </div>
  )
}
