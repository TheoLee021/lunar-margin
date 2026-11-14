import { useState } from 'react'
import type { Candidate } from '../api/candidates'
import {
  fractionText,
  scoreText,
  sortCandidates,
  type SortDir,
  type SortKey,
} from './derive'

interface Props {
  candidates: readonly Candidate[]
  highlightedId: string | null
  selectedId: string | null
  onHover: (id: string | null) => void
  onSelect: (id: string) => void
}

const COLUMNS: readonly {
  key: SortKey
  label: string
  align: 'left' | 'right'
}[] = [
  { key: 'rank', label: '순위', align: 'right' },
  { key: 'id', label: 'ID', align: 'left' },
  { key: 'lat', label: '위도', align: 'right' },
  { key: 'lon', label: '경도(°E)', align: 'right' },
  { key: 'sun', label: '일조율', align: 'right' },
  { key: 'earth', label: '지구 가시율', align: 'right' },
  { key: 'score', label: '점수', align: 'right' },
  { key: 'region', label: '영역', align: 'right' },
]

export function CandidateTable({
  candidates,
  highlightedId,
  selectedId,
  onHover,
  onSelect,
}: Props) {
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({
    key: 'rank',
    dir: 'asc',
  })
  if (candidates.length === 0)
    return (
      <p className="rounded-lg border border-dashed border-neutral-800 px-4 py-8 text-center text-sm text-neutral-500">
        선정된 후보가 없습니다. 임계값이 너무 엄격하거나 계산에 성공한 점이 없을
        수 있습니다. 위의 탈락 사유를 확인하세요.
      </p>
    )
  const rows = sortCandidates(candidates, sort.key, sort.dir)

  function toggle(key: SortKey) {
    setSort((current) =>
      current.key === key
        ? { key, dir: current.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: key === 'id' ? 'asc' : key === 'rank' ? 'asc' : 'desc' },
    )
  }

  return (
    <div className="max-h-[28rem] overflow-auto rounded-xl border border-neutral-800">
      <table className="w-full min-w-[40rem] border-collapse text-xs">
        <thead className="sticky top-0 bg-neutral-900">
          <tr>
            {COLUMNS.map((col) => (
              <th
                key={col.key}
                scope="col"
                aria-sort={
                  sort.key === col.key
                    ? sort.dir === 'asc'
                      ? 'ascending'
                      : 'descending'
                    : 'none'
                }
                className={`px-3 py-2 font-medium text-neutral-400 ${
                  col.align === 'right' ? 'text-right' : 'text-left'
                }`}
              >
                <button
                  type="button"
                  onClick={() => toggle(col.key)}
                  className="hover:text-neutral-100"
                >
                  {col.label}
                  {sort.key === col.key
                    ? sort.dir === 'asc'
                      ? ' ▲'
                      : ' ▼'
                    : ''}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => {
            const active = c.id === highlightedId || c.id === selectedId
            return (
              <tr
                key={c.id}
                onMouseEnter={() => onHover(c.id)}
                onMouseLeave={() => onHover(null)}
                className={`border-t border-neutral-800 ${
                  c.id === selectedId
                    ? 'bg-sky-500/15'
                    : active
                      ? 'bg-neutral-800/70'
                      : ''
                }`}
              >
                <td className="px-3 py-1.5 text-right tabular-nums text-neutral-200">
                  {c.rank}
                </td>
                <td className="px-3 py-1.5 text-left">
                  <button
                    type="button"
                    onClick={() => onSelect(c.id)}
                    onFocus={() => onHover(c.id)}
                    onBlur={() => onHover(null)}
                    aria-pressed={c.id === selectedId}
                    className="font-mono text-neutral-100 underline-offset-2 hover:underline"
                  >
                    {c.id}
                  </button>
                  {!c.data_quality.horizon_complete ? (
                    <span
                      title="수평선이 높이 지도 밖으로 나가 값이 낮게 계산됐을 수 있습니다"
                      className="ml-2 rounded bg-amber-400/15 px-1.5 py-0.5 text-[10px] text-amber-300"
                    >
                      수평선 불완전
                    </span>
                  ) : null}
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums">
                  {c.lat_deg.toFixed(3)}°
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums">
                  {c.lon_deg.toFixed(2)}
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums text-amber-300">
                  {fractionText(c.sun.fraction)}
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums text-sky-300">
                  {fractionText(c.earth.fraction)}
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums">
                  {scoreText(c.score.total)}
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums text-neutral-400">
                  {c.region_id}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
