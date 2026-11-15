import { Fragment, useState } from 'react'
import { formatPrice } from '../api/pricing'
import type { CandidatePrices } from './useCandidatePrices'
import type { Candidate } from '../api/candidates'
import type { CandidateAvailability } from '../api/reservations'
import {
  fractionText,
  degText,
  scoreText,
  sortCandidates,
  type SortDir,
  type SortKey,
} from './derive'

interface Props {
  candidates: readonly Candidate[]
  reservations: ReadonlyMap<string, CandidateAvailability> | null
  prices: CandidatePrices
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
  { key: 'rank', label: '과학 순위', align: 'right' },
  { key: 'id', label: 'ID', align: 'left' },
  { key: 'lat', label: '위도', align: 'right' },
  { key: 'lon', label: '경도(°E)', align: 'right' },
  { key: 'sun', label: '일조율', align: 'right' },
  { key: 'earth', label: '지구 가시율', align: 'right' },
  { key: 'slope', label: '지역 경사 P95', align: 'right' },
  { key: 'roughness', label: '지역 거칠기 P95', align: 'right' },
  { key: 'score', label: '점수', align: 'right' },
  { key: 'region', label: '영역', align: 'right' },
]

export function CandidateTable({
  candidates,
  reservations,
  prices,
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
      <p className="rounded-lg border border-dashed border-white/10 px-4 py-8 text-center text-sm text-neutral-500">
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
    <div className="max-h-[28rem] overflow-auto rounded-xl border border-white/10">
      <table className="w-full min-w-[40rem] border-collapse text-xs">
        <thead className="sticky top-0 bg-[#0f1217]/60">
          <tr>
            <th
              scope="col"
              className="px-3 py-2 text-left font-medium text-neutral-400"
            >
              예약 상태 / 가능 순위
            </th>
            {COLUMNS.map((col) => (
              <Fragment key={col.key}>
                <th
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
                {col.key === 'rank' ? (
                  <th
                    scope="col"
                    className="px-3 py-2 text-right font-medium whitespace-nowrap text-neutral-400"
                  >
                    가격 (USD)
                  </th>
                ) : null}
              </Fragment>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => {
            const reservation = reservations?.get(c.id)
            const active = c.id === highlightedId || c.id === selectedId
            return (
              <tr
                key={c.id}
                onMouseEnter={() => onHover(c.id)}
                onMouseLeave={() => onHover(null)}
                className={`border-t border-white/10 ${
                  c.id === selectedId
                    ? 'bg-sky-500/15'
                    : active
                      ? 'bg-white/[0.06]'
                      : ''
                }`}
              >
                <td className="px-3 py-2 text-left">
                  {reservation ? (
                    <>
                      <p
                        className={
                          reservation.status === 'reserved'
                            ? 'text-amber-300'
                            : 'text-emerald-300'
                        }
                      >
                        {reservation.status === 'reserved'
                          ? '예약됨 · 예약 불가'
                          : `예약 가능 · ${reservation.available_rank}위`}
                      </p>
                      <p className="mt-1 font-mono text-[10px] text-neutral-500">
                        {reservation.cell_id}
                      </p>
                      {reservation.conflicts.map((booking) => (
                        <p
                          key={booking.id}
                          className="mt-1 text-[10px] text-neutral-400"
                        >
                          {booking.company} · {booking.starts_at.slice(0, 10)} →{' '}
                          {booking.ends_at.slice(0, 10)} UTC
                        </p>
                      ))}
                    </>
                  ) : (
                    <span className="text-neutral-500">미확인 · 예약 불가</span>
                  )}
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums text-neutral-200">
                  {c.rank}
                </td>
                <td className="px-3 py-1.5 text-right whitespace-nowrap tabular-nums text-amber-300">
                  <CandidatePriceValue prices={prices} id={c.id} />
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
                  {degText(c.terrain?.slope_p95_deg ?? null)}
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums">
                  {c.terrain?.roughness_p95_m == null
                    ? '—'
                    : `${c.terrain.roughness_p95_m.toFixed(2)} m`}
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

function CandidatePriceValue({
  prices,
  id,
}: {
  prices: CandidatePrices
  id: string
}) {
  if (prices.status === 'loading')
    return <span className="text-neutral-500">조회 중…</span>
  if (prices.status === 'error')
    return <span className="text-neutral-500">조회 실패</span>
  if (prices.status === 'unavailable')
    return <span className="text-neutral-500">산정 불가</span>
  const cell = prices.data.get(id)
  if (!cell)
    return (
      <span
        className="text-neutral-500"
        title="가격 산정 대상인 적합 500 m 격자에 포함되지 않습니다"
      >
        미산정
      </span>
    )
  if (!cell.price)
    return (
      <span
        className="text-neutral-500"
        title={
          cell.excluded_reason === 'aim_point_slope_above_10_deg'
            ? '가격 모델의 중심 경사 한도 10° 초과'
            : cell.excluded_reason === 'landable_fraction_below_0.05'
              ? '가격 모델의 착륙 가능 면적 비율 5% 미만'
              : '가격 모델의 지형 조건 미충족'
        }
      >
        산정 제외
      </span>
    )
  return (
    <>
      <span
        title={cell.price.adjusted_usd.toLocaleString('en-US', {
          style: 'currency',
          currency: 'USD',
          maximumFractionDigits: 0,
        })}
      >
        {formatPrice(cell.price.adjusted_usd)}
      </span>
      {cell.price.destination_unknown || cell.aim_slope_deg === null ? (
        <span className="block text-[10px] text-neutral-500">지형 미확인</span>
      ) : null}
    </>
  )
}
