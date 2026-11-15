import { useEffect, useState } from 'react'
import { fetchLaunchSchedule, type LaunchSchedule } from '../api/launchSchedule'

export function LaunchDeparture({
  departure,
  onSelect,
}: {
  departure: string
  onSelect: (date: string) => void
}) {
  const [data, setData] = useState<LaunchSchedule | null>(null)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    fetchLaunchSchedule({ signal: controller.signal })
      .then((result) => {
        if (!controller.signal.aborted) {
          setData(result)
          setError('')
        }
      })
      .catch((e: unknown) => {
        if (!controller.signal.aborted)
          setError(e instanceof Error ? e.message : String(e))
      })
    return () => controller.abort()
  }, [revision])
  const selected = data?.launches.find(
    (item) => item.departure_date === departure,
  )
  return (
    <section
      aria-label="발사 일정에서 출발일 선택"
      className="launch-departure"
    >
      <label>
        발사 일정에서 출발일 선택 · UTC
        <select
          value={selected?.id ?? ''}
          disabled={!data}
          onChange={(e) => {
            const item = data?.launches.find(
              (item) => item.id === e.target.value,
            )
            if (item?.departure_date) onSelect(item.departure_date)
          }}
        >
          <option value="">
            {data
              ? '발사 임무 선택 · 또는 아래에서 직접 입력'
              : error
                ? '일정 불러오기 실패'
                : '두 사이트의 발사 일정 확인 중…'}
          </option>
          {data?.launches.map((item) => (
            <option
              key={item.id}
              value={item.id}
              disabled={!item.departure_date}
            >
              {item.departure_date ?? '정확일 미정'} · {item.name} ·{' '}
              {item.label}
            </option>
          ))}
        </select>
      </label>
      {error ? (
        <p role="alert">
          {error}{' '}
          <button type="button" onClick={() => setRevision((v) => v + 1)}>
            일정 다시 시도
          </button>
        </p>
      ) : null}
      {selected ? (
        <p className="hint">
          {selected.name} · 예정/NET · 착륙일은 직접 선택합니다.{' '}
          {selected.sources.map((source) => (
            <a
              key={source.url}
              href={source.url}
              target="_blank"
              rel="noreferrer"
            >
              {source.name}: {source.label} ↗{' '}
            </a>
          ))}
        </p>
      ) : (
        <p className="hint">
          확정 운항·예약을 뜻하지 않습니다. 월 단위 일정은 출발일로 자동
          입력하지 않습니다.
        </p>
      )}
      {data && !data.launches.length ? (
        <p role="status">
          등록된 달 배송 임무의 발사 예정일이 없습니다. 출발일을 직접
          입력하세요.
        </p>
      ) : null}
      {data ? (
        <p className="hint">
          {data.sources
            .map(
              (source) =>
                `${source.name} ${source.stale ? '갱신 실패 · 마지막 자료' : '확인'} ${source.fetched_at.slice(0, 16).replace('T', ' ')} UTC`,
            )
            .join(' · ')}{' '}
          · 10분 간격 갱신
        </p>
      ) : null}
    </section>
  )
}
