import { useMemo, useState } from 'react'
import type { Analysis, AnalysisKind } from '../api/analysis'
import {
  formatDuration,
  formatUtc,
  sortPeriodRows,
  toPeriodRows,
  type PeriodRow,
  type SortDir,
  type SortKey,
} from './derive'
import { KIND_COPY, subject } from './kinds'

type Filter = 'all' | PeriodRow['kind']

const PAGE = 100

export function PeriodsTable({
  kind,
  data,
}: {
  kind: AnalysisKind
  data: Analysis
}) {
  const copy = KIND_COPY[kind]
  const [filter, setFilter] = useState<Filter>('all')
  const [sortKey, setSortKey] = useState<SortKey>('start')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [shown, setShown] = useState(PAGE)

  const allRows = useMemo(
    () => [
      ...toPeriodRows(data.windows, 'window'),
      ...toPeriodRows(data.dark_periods, 'dark'),
    ],
    [data.windows, data.dark_periods],
  )
  const longestDarkHours = useMemo(
    () =>
      allRows.reduce(
        (max, row) => (row.kind === 'dark' ? Math.max(max, row.hours) : max),
        0,
      ),
    [allRows],
  )
  const rows = useMemo(() => {
    const filtered =
      filter === 'all' ? allRows : allRows.filter((row) => row.kind === filter)
    return sortPeriodRows(filtered, sortKey, sortDir)
  }, [allRows, filter, sortKey, sortDir])

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortDir(key === 'hours' ? 'desc' : 'asc')
    }
  }

  function ariaSort(key: SortKey): 'ascending' | 'descending' | 'none' {
    if (key !== sortKey) return 'none'
    return sortDir === 'asc' ? 'ascending' : 'descending'
  }

  const filters: readonly (readonly [Filter, string])[] = [
    ['all', `전체 (${allRows.length})`],
    ['window', `${copy.windowLabel} (${data.windows.length})`],
    ['dark', `${copy.darkPeriodLabel} (${data.dark_periods.length})`],
  ]

  return (
    <section className="flex flex-col gap-3" aria-label="구간 목록">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium text-neutral-200">구간 목록</h3>
        <div role="group" aria-label="구간 종류 필터" className="flex gap-1">
          {filters.map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={filter === value}
              onClick={() => {
                setFilter(value)
                setShown(PAGE)
              }}
              className={`rounded-full px-3 py-1 text-xs ${
                filter === value
                  ? 'bg-neutral-100 text-neutral-950'
                  : 'border border-neutral-700 text-neutral-300 hover:border-neutral-400'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-neutral-800 px-4 py-6 text-center text-sm text-neutral-500">
          {filter === 'window'
            ? `이 기간에는 ${subject(copy.windowLabel)} 없습니다.`
            : filter === 'dark'
              ? `이 기간에는 ${subject(copy.darkPeriodLabel)} 없습니다.`
              : '표시할 구간이 없습니다.'}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-neutral-800">
          <table className="w-full min-w-xl text-left text-sm">
            <thead className="bg-neutral-900 text-xs text-neutral-400">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">
                  종류
                </th>
                <th
                  scope="col"
                  aria-sort={ariaSort('start')}
                  className="px-3 py-2 font-medium"
                >
                  <button
                    type="button"
                    onClick={() => toggleSort('start')}
                    className="hover:text-neutral-100"
                  >
                    시작{' '}
                    {sortKey === 'start' ? (sortDir === 'asc' ? '▲' : '▼') : ''}
                  </button>
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  끝
                </th>
                <th
                  scope="col"
                  aria-sort={ariaSort('hours')}
                  className="px-3 py-2 font-medium"
                >
                  <button
                    type="button"
                    onClick={() => toggleSort('hours')}
                    className="hover:text-neutral-100"
                  >
                    길이{' '}
                    {sortKey === 'hours' ? (sortDir === 'asc' ? '▲' : '▼') : ''}
                  </button>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-800">
              {rows.slice(0, shown).map((row) => (
                <tr
                  key={`${row.kind}-${row.start}`}
                  className="text-neutral-200"
                >
                  <td className="px-3 py-1.5">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] ${
                        row.kind === 'window'
                          ? 'bg-emerald-500/15 text-emerald-300'
                          : 'bg-neutral-800 text-neutral-300'
                      }`}
                    >
                      {row.kind === 'window'
                        ? copy.windowLabel
                        : copy.darkPeriodLabel}
                    </span>
                    {row.kind === 'dark' &&
                    row.hours === longestDarkHours &&
                    longestDarkHours > 0 ? (
                      <span className="ml-1.5 rounded-full bg-red-500/15 px-2 py-0.5 text-[11px] text-red-300">
                        최장
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 py-1.5 tabular-nums">
                    {formatUtc(row.start)}
                  </td>
                  <td className="px-3 py-1.5 tabular-nums">
                    {formatUtc(row.end)}
                  </td>
                  <td className="px-3 py-1.5 tabular-nums">
                    {formatDuration(row.hours)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {rows.length > shown ? (
        <button
          type="button"
          onClick={() => setShown(shown + PAGE)}
          className="self-center rounded-md border border-neutral-700 px-3 py-1.5 text-xs text-neutral-300 hover:border-neutral-400"
        >
          더 보기 ({shown}/{rows.length})
        </button>
      ) : null}
    </section>
  )
}
