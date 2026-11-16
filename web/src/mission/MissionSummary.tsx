import type { MissionSelection } from './types'

export function MissionSummary({ selection }: { selection: MissionSelection }) {
  return (
    <div className="space-y-3 text-left">
      <div className="flex items-center justify-between">
        <span className="text-xs text-neutral-400">Departure</span>
        <strong className="font-mono text-base">
          {selection.departure.replaceAll('-', '.')}
        </strong>
      </div>
      <div className="text-xs text-amber-400">↓ Earth → Moon</div>
      <div className="flex items-center justify-between">
        <span className="text-xs text-neutral-400">Landing</span>
        <strong className="font-mono text-base">
          {selection.landing.replaceAll('-', '.')}
        </strong>
      </div>
      <div className="border-t border-white/10 pt-3 text-xs text-neutral-400">
        Surface mission{' '}
        <span className="text-neutral-100">{selection.duration} days</span>
      </div>
    </div>
  )
}
