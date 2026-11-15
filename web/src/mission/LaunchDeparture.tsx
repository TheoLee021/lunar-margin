import { useEffect, useState } from 'react'
import { fetchLaunchSchedule, type LaunchSchedule } from '../api/launchSchedule'

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
const ROLES = {
  delivery: '착륙선·배송',
  launch: '발사체',
  partner: '본문 관련 언급',
}

export function LaunchDeparture({
  selectedId,
  onSelect,
  onClear,
}: {
  selectedId: string | null
  onSelect: (launch: LaunchSchedule['launches'][number]) => void
  onClear: () => void
}) {
  const [data, setData] = useState<LaunchSchedule | null>(null)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  const [company, setCompany] = useState<Company | 'all'>('all')
  const [query, setQuery] = useState('')
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
  const selected = data?.launches.find((item) => item.id === selectedId)
  const complete =
    data?.sources.every((source) => source.complete && !source.stale) ?? false
  function choose(item: LaunchSchedule['launches'][number]) {
    if (item.departure_date) {
      onSelect(item)
    }
  }
  function related(item: LaunchSchedule['launches'][number], id: Company) {
    if (id === 'other') return item.provider_id === null
    return item.participants.length
      ? item.participants.some((p) => p.provider_id === id)
      : item.provider_id === id
  }
  const normalize = (value: string) =>
    value.toLowerCase().replace(/[\s_-]+/g, '')
  const visible =
    data?.launches.filter((item) =>
      normalize(item.name + ' ' + item.launch_provider).includes(
        normalize(query),
      ),
    ) ?? []
  return (
    <section
      aria-label="발사 일정에서 출발일 선택"
      className="launch-departure"
    >
      <p className="hint text-amber-200">
        데모 · 전체 발사 일정입니다. 지구 궤도 임무도 달 임무 분석용 출발일로
        가정해 사용할 수 있습니다.
      </p>
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
              ? '발사 임무 선택 · 또는 아래에서 직접 입력'
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
          <button type="button" onClick={() => setRevision((v) => v + 1)}>
            일정 다시 시도
          </button>
        </p>
      ) : null}
      {selected ? (
        <p className="hint" aria-label="선택한 발사 임무 출처">
          {selected.name} ·{' '}
          {selected.lunar_related ? '달 관련' : '일반 발사 · 달 임무 가정'} ·
          예정/NET · 착륙일은 직접 선택합니다. 표의 ±2일은 비교용
          시나리오입니다.{' '}
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
          실제 달 배송편을 뜻하지 않습니다. 월 단위 일정은 출발일로 자동
          입력하지 않습니다.
        </p>
      )}
      {data ? (
        <details className="launch-catalog" open>
          <summary>
            전체 발사 일정 · {data.launches.length}개 · 월·연도 미정 포함
          </summary>
          <label>
            회사별 일정
            <select
              aria-label="회사별 일정"
              value={company}
              onChange={(e) => setCompany(e.target.value as Company | 'all')}
            >
              <option value="all">모든 발사사</option>
              {(Object.keys(COMPANIES) as Company[]).map((id) => (
                <option key={id} value={id}>
                  {COMPANIES[id]} ·{' '}
                  {data.launches.filter((item) => related(item, id)).length}개
                </option>
              ))}
            </select>
          </label>
          <label>
            임무·발사사 검색
            <input
              type="search"
              aria-label="임무·발사사 검색"
              placeholder="USSF-317, Amazon Leo, ULA…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <div
            className="launch-catalog-list"
            role="region"
            aria-label="전체 발사 일정 목록"
            tabIndex={0}
          >
            {(Object.keys(COMPANIES) as Company[])
              .filter((id) => company === 'all' || company === id)
              .filter(
                (id) => !query || visible.some((item) => related(item, id)),
              )
              .map((id) => {
                const rows = visible.filter((item) => related(item, id))
                return (
                  <section key={id} aria-label={`${COMPANIES[id]} 발사 일정`}>
                    <h4>
                      {COMPANIES[id]} <span>{rows.length}개</span>
                    </h4>
                    {rows.length ? (
                      rows.map((item) => (
                        <article key={item.id}>
                          <div>
                            <strong>{item.name}</strong>
                            <span>
                              {item.launch_provider} ·{' '}
                              {item.lunar_related
                                ? '달 관련'
                                : '일반 발사 · 데모'}
                            </span>
                            <span>
                              {item.participants
                                .filter((p) => p.provider_id === id)
                                .map((p) => ROLES[p.role])
                                .join(' · ')}
                            </span>
                          </div>
                          <p>
                            {item.label}
                            {!item.departure_date ? ' · 출발 일자 미정' : ''}
                          </p>
                          <div className="launch-catalog-links">
                            {item.sources.map((source) => (
                              <a
                                key={`${source.name}-${source.url}`}
                                href={source.url}
                                target="_blank"
                                rel="noreferrer"
                              >
                                {source.name} ↗
                              </a>
                            ))}
                            {item.departure_date ? (
                              <button
                                type="button"
                                onClick={() => choose(item)}
                                aria-label={`${item.name} ${item.departure_date} 출발일로 선택`}
                              >
                                출발일로 선택
                              </button>
                            ) : null}
                          </div>
                        </article>
                      ))
                    ) : (
                      <p>
                        {complete
                          ? query
                            ? '검색 결과 없음'
                            : '두 사이트에 등록된 발사 일정 없음'
                          : '수집 확인 필요 · 일정 유무 미확인'}
                      </p>
                    )}
                  </section>
                )
              })}
            {query &&
            !visible.some(
              (item) => company === 'all' || related(item, company),
            ) ? (
              <p role="status">검색 결과 없음</p>
            ) : null}
          </div>
          <p className="hint">
            회사 역할별로 같은 임무가 함께 표시될 수 있습니다. 일반 발사는 달
            배송 가능 여부와 무관한 데모 입력입니다. 본문 관련 언급은 참여
            확약을 뜻하지 않습니다.
          </p>
        </details>
      ) : null}
      {data ? (
        <p className="hint">
          {data.sources
            .map(
              (source) =>
                `${source.name} ${source.stale ? '갱신 실패 · 마지막 자료' : '확인'} ${source.fetched_at.slice(0, 16).replace('T', ' ')} UTC · ${source.scanned_records}건 / ${source.scanned_pages}페이지${source.complete ? '' : ' · 수집 미완료'}`,
            )
            .join(' · ')}{' '}
          · 최대 10분 재사용
        </p>
      ) : null}
    </section>
  )
}
