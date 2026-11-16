import type { Candidate, SearchConfig } from '../api/candidates'
import {
  requirementMargins,
  type RequirementMargin,
} from './requirementMargins'

type Unit = RequirementMargin['unit']

const DIGITS: Record<Unit, number> = { '%': 1, 시간: 1, '°': 1, m: 2 }
const SUFFIX: Record<Unit, string> = {
  '%': '%',
  시간: ' 시간',
  '°': '°',
  m: ' m',
}

function amount(value: number, unit: Unit): string {
  return `${value.toFixed(DIGITS[unit])}${SUFFIX[unit]}`
}

function marginText(margin: number, unit: Unit): string {
  // 비율끼리의 차이는 퍼센트가 아니라 퍼센트포인트다.
  const text = `${margin.toFixed(DIGITS[unit])}${unit === '%' ? '%p' : SUFFIX[unit]}`
  return margin < 0 ? text : `+${text}`
}

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
      aria-label="탐색 조건 대비 여유"
      className="mt-3 border-t border-white/10 pt-3 text-xs"
    >
      <h3 className="font-semibold">탐색 조건 대비 여유 · 저장된 탐색 결과</h3>
      <table className="mt-2 w-full">
        <thead className="text-neutral-400">
          <tr>
            <th scope="col" className="text-left font-normal">
              조건
            </th>
            <th scope="col" className="text-right font-normal">
              값
            </th>
            <th scope="col" className="text-right font-normal">
              한도
            </th>
            <th scope="col" className="text-right font-normal">
              여유
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
                {row.value === null ? '—' : amount(row.value, row.unit)}
              </td>
              <td className="whitespace-nowrap py-1 pl-2 text-right font-mono text-neutral-400">
                {row.bound === 'max' ? '≤' : '≥'} {amount(row.limit, row.unit)}
              </td>
              <td
                className={`whitespace-nowrap py-1 pl-2 text-right font-mono ${
                  row.margin !== null && row.margin < 0 ? 'text-red-300' : ''
                }`}
              >
                {row.margin === null ? '—' : marginText(row.margin, row.unit)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-1 text-[10px] text-neutral-400">
        저장된 탐색 결과의 값과 한도의 차이입니다. 양수면 한도 안쪽입니다.
      </p>
    </section>
  )
}
