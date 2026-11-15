import type { Candidate, SearchConfig } from '../api/candidates'
import { marginSummary, requirementMargins } from './requirementMargins'

function numberText(value: number | null, unit: string): string {
  if (value === null) return 'Unknown'
  return `${value.toFixed(2)} ${unit}`
}

function marginText(value: number | null, unit: string): string {
  if (value === null) return 'Unknown'
  const sign = value >= 0 ? '+' : ''
  return `${sign}${numberText(value, unit)}`
}

export function MissionEngineering({
  candidate,
  config,
  runId,
}: {
  candidate: Candidate
  config: SearchConfig
  runId: string
}) {
  const rows = requirementMargins(candidate, config)
  const status = marginSummary(rows)
  return (
    <section
      aria-label="Mission Engineering margins"
      className="mt-4 border-t border-white/10 pt-3 text-xs"
    >
      <h3 className="font-semibold">Mission Engineering · Margins</h3>
      <p className="mt-2 text-neutral-400">Requirement status: {status}</p>
      <p className="mt-1 text-neutral-400">
        Positive margin meets the selected threshold.
      </p>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr>
              <th>Requirement</th>
              <th>Value</th>
              <th>Margin</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} title={row.interpretation}>
                <th className="font-normal">{row.label}</th>
                <td>{numberText(row.value, row.unit)}</td>
                <td>{marginText(row.margin, row.unit)}</td>
                <td>{row.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-neutral-400">
        Source run: {runId}; candidate: {candidate.id}.
      </p>
      <p className="mt-1 text-neutral-400">
        Screening only. Not a certified landing or mission success result.
      </p>
    </section>
  )
}
