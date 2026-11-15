import type { Candidate, SearchConfig } from '../api/candidates'
import { marginSummary, requirementMargins } from './requirementMargins'

function numeric(value: number | null, unit: string): string {
  if (value === null) return '미산정'
  return `${value.toFixed(unit === '%' ? 1 : 2)} ${unit}`
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
  const summary = marginSummary(rows)
  const statusStyle: Record<string, string> = {
    PASS: 'text-emerald-300',
    FAIL: 'text-rose-300',
    UNKNOWN: 'text-amber-300',
    NOT_ASSESSED: 'text-neutral-400',
  }
  return (
    <section
      aria-label="Mission Engineering — 요구조건과 여유"
      className="mt-4 border-t border-white/10 pt-3 text-xs"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold text-neutral-100">
          Mission Engineering · Margins
        </h3>
        <strong className={statusStyle[summary]}>
          {summary === 'NOT_ASSESSED' ? 'NO THRESHOLDS' : summary}
        </strong>
      </div>
      <p className="mt-1 text-[11px] text-neutral-400">
        저장된 탐색의 필수 조건을 재표시합니다. 양(+)의 여유는 한도 충족, 음(-)의 여유는
        위반입니다. 결측은 통과로 처리하지 않습니다.
      </p>
      {rows.length === 0 ? (
        <p className="mt-2 text-neutral-400">
          설정된 정량 한도가 없어 적격 판정을 요약할 수 없습니다.
        </p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-[11px]">
            <thead className="text-neutral-400">
              <tr>
                <th scope="col" className="pb-2 pr-2 font-medium">
                  Requirement
                </th>
                <th scope="col" className="pb-2 pr-2 font-medium">
                  Measured
                </th>
                <th scope="col" className="pb-2 pr-2 font-medium">
                  Margin
                </th>
                <th scope="col" className="pb-2 font-medium">
                  State
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.key}
                  className="border-t border-white/10"
                  title={row.interpretation}
                >
                  <th
                    scope="row"
                    className="py-2 pr-2 font-normal text-neutral-200"
                  >
                    {row.label}
                  </th>
                  <td className="py-2 pr-2 font-mono">
                    {numeric(row.value, row.unit)}
                  </td>
                  <td className="py-2 pr-2 font-mono">
                    {row.margin === null
                      ? '—'
                      : `${row.margin >= 0 ? '+' : ''}${numeric(row.margin, row.unit)}`}
                  </td>
                  <td className={`py-2 font-mono ${statusStyle[row.status]}`}>
                    {row.status}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-2 text-[10px] text-neutral-500">
        판단 근거: run {runId} · {candidate.id} · 저장된 후보 지표.
        이 표는 임무 요구조건 충족 여부의 스크리닝이며 NASA 인증,
        전력·열 모델, 지형 착륙 안전 또는 불확실성 검증은 아닙니다.
      </p>
    </section>
  )
}
