import type { Candidate, SearchConfig } from '../api/candidates'
import {
  formatAmount,
  formatMargin,
  requirementMargins,
} from './requirementMargins'

/** 선택한 후보의 저장된 지표가 탐색 한도에서 얼마나 여유 있는지 보여준다. 적격 판정은 하지 않는다. */
export function RequirementMarginPanel({
  candidate,
  config,
}: {
  candidate: Candidate
  config: SearchConfig
}) {
  const rows = requirementMargins(candidate, config)
  if (rows.length === 0) return null
  return (
    <section
      aria-label="Margin against search conditions"
      className="mt-3 text-xs"
    >
      <h3 className="font-semibold">
        Margin against search conditions · saved search result
      </h3>
      <table className="mt-2 w-full">
        <thead className="text-neutral-400">
          <tr>
            <th scope="col" className="text-left font-normal">
              Condition
            </th>
            <th scope="col" className="text-right font-normal">
              Value
            </th>
            <th scope="col" className="text-right font-normal">
              Limit
            </th>
            <th scope="col" className="text-right font-normal">
              Margin
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className="border-t border-white/5">
              <th scope="row" className="py-1 text-left font-normal">
                {row.label}
              </th>
              <td className="whitespace-nowrap py-1 pl-2 text-right font-mono">
                {row.value === null ? '—' : formatAmount(row.value, row.unit)}
              </td>
              <td className="whitespace-nowrap py-1 pl-2 text-right font-mono text-neutral-400">
                {row.bound === 'max' ? '≤' : '≥'}{' '}
                {formatAmount(row.limit, row.unit)}
              </td>
              <td
                className={`whitespace-nowrap py-1 pl-2 text-right font-mono ${
                  row.margin !== null && row.margin < 0 ? 'text-red-300' : ''
                }`}
              >
                {row.margin === null ? '—' : formatMargin(row.margin, row.unit)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-1 text-[10px] text-neutral-400">
        Difference between the saved value and its limit. Positive means inside
        the limit.
      </p>
    </section>
  )
}
