import type { LaunchSchedule } from '../api/launchSchedule'

type Company =
  Exclude<LaunchSchedule['launches'][number]['provider_id'], null> | 'other'
const COMPANIES: Record<Company, string> = {
  blue_origin: 'Blue Origin',
  ispace_us: 'ispace-U.S.',
  spacex: 'SpaceX',
  lockheed_martin: 'Lockheed Martin Space',
  northrop_grumman: 'Northrop Grumman Space Systems',
  voyager: 'Voyager Technologies',
  other: '기타 발사사 · ULA 등',
}
export function LaunchDeparture({
  data,
  error,
  onRetry,
  selectedId,
  onSelect,
  onClear,
}: {
  data: LaunchSchedule | null
  error: string
  onRetry: () => void
  selectedId: string | null
  onSelect: (launch: LaunchSchedule['launches'][number]) => void
  onClear: () => void
}) {
  const selected = data?.launches.find((item) => item.id === selectedId)
  function choose(item: LaunchSchedule['launches'][number]) {
    if (item.departure_date) {
      onSelect(item)
    }
  }
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
            if (item) choose(item)
            else if (!e.target.value) onClear()
          }}
        >
          <option value="">
            {data
              ? '발사 임무 선택'
              : error
                ? '일정 불러오기 실패'
                : '두 사이트의 발사 일정 확인 중…'}
          </option>
          {(Object.keys(COMPANIES) as Company[]).map((id) => (
            <optgroup key={id} label={COMPANIES[id]}>
              {data?.launches
                .filter((item) => (item.provider_id ?? 'other') === id)
                .map((item) => (
                  <option
                    key={item.id}
                    value={item.id}
                    disabled={!item.departure_date}
                  >
                    {item.departure_date ?? '정확일 미정'} · {item.name} ·{' '}
                    {item.label}
                  </option>
                ))}
              {data &&
              !data.launches.some(
                (item) => (item.provider_id ?? 'other') === id,
              ) ? (
                <option disabled value={`none-${id}`}>
                  등록된 대표 임무 일정 없음
                </option>
              ) : null}
            </optgroup>
          ))}
        </select>
      </label>
      {error ? (
        <p role="alert">
          {error}{' '}
          <button type="button" onClick={onRetry}>
            일정 다시 시도
          </button>
        </p>
      ) : null}
      {selected ? (
        <p className="hint" aria-label="선택한 발사 임무 출처">
          {selected.launch_provider} · 예정일 {selected.departure_date} ·{' '}
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
      ) : null}
      <p className="hint">
        공개된 발사 예정일로 비교합니다. 가격은 달 배송을 가정한 모델값입니다.
      </p>
    </section>
  )
}
