import { useEffect, useState } from 'react'
import { DeliverySchema, formatPrice, type Delivery } from '../api/pricing'
import {
  fetchProviderComparison,
  type CompareInput,
  type Comparison,
  type ProviderIssue,
} from '../api/providerPricing'

const COPY: Record<ProviderIssue, string> = {
  mission_unpublished: '등록된 공개 운항편 없음',
  schedule_unknown: '정확한 일정 미정',
  outside_schedule: '해당 일정 운항 불가',
  transit_out_of_range: '전이 기간 불충족',
  delivery_unknown: '배송 방식 미확인',
  delivery_unserved: '배송 방식 미지원',
  capacity_unknown: '잔여 적재량 미공개',
  capacity_exceeded: '적재 한도 초과',
  destination_unknown: '배송 가능 범위 미공개',
  destination_unserved: '이 위치 배송 불가',
  price_unpublished: '가격 미공개',
  pricing_terms_unknown: '최소 요금·수수료 미공개',
  terrain_excluded: '착륙 지형 조건 불충족',
}
const DELIVERY: Record<Delivery, string> = {
  orbit: '달 궤도 투입',
  surface: '표면 하역',
  rover_delivery: '로버 배송',
}

export function ProviderComparison({
  x_m,
  y_m,
  landingDate,
}: {
  x_m: number
  y_m: number
  landingDate: string
}) {
  const params = new URLSearchParams(window.location.search)
  const candidateMass = Number(params.get('mass_kg') ?? 24)
  const mass =
    Number.isFinite(candidateMass) &&
    candidateMass > 0 &&
    candidateMass <= 1000000
      ? candidateMass
      : 24
  const delivery =
    DeliverySchema.safeParse(params.get('delivery')).data ?? 'surface'
  const fallback = new Date(Date.parse(landingDate) - 4 * 86400000)
    .toISOString()
    .slice(0, 10)
  const departure = params.get('departure') ?? fallback
  const input: CompareInput = {
    estimate: true,
    departure_date: departure,
    landing_date: landingDate,
    mass_kg: mass,
    delivery,
    x_m,
    y_m,
  }
  const key = JSON.stringify(input)
  const [state, setState] = useState<{
    key: string
    data: Comparison | null
    error: string
  }>({ key: '', data: null, error: '' })
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    const request: CompareInput = JSON.parse(key)
    fetchProviderComparison(request, { signal: controller.signal })
      .then((data) => {
        if (!controller.signal.aborted) setState({ key, data, error: '' })
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setState({
            key,
            data: null,
            error: error instanceof Error ? error.message : String(error),
          })
      })
    return () => controller.abort()
  }, [key, revision])
  const data = state.key === key ? state.data : null,
    error = state.key === key ? state.error : ''
  return (
    <section
      aria-label="회사별 배송 비교"
      className="grid gap-3 border-t border-white/10 pt-4"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="text-sm font-semibold text-neutral-100">
          회사별 배송 비교
        </h4>
        <span className="text-xs text-neutral-400">
          {departure} → {landingDate} · {mass}kg · {DELIVERY[delivery]}
        </span>
      </div>
      {error ? (
        <p role="alert" className="text-xs text-red-300">
          {error}{' '}
          <button
            type="button"
            className="hud-button"
            onClick={() => setRevision((v) => v + 1)}
          >
            다시 불러오기
          </button>
        </p>
      ) : !data ? (
        <p role="status" className="text-xs text-neutral-400">
          6개 회사의 공개 일정·조건을 확인하는 중…
        </p>
      ) : (
        <>
          <p className="text-sm text-neutral-200">
            {data.minimum_estimate_usd === null
              ? '이 조건에서 계산 가능한 예상 비용 없음'
              : `최저 예상 비용 ${formatPrice(data.minimum_estimate_usd)}`}
          </p>
          <div className="grid gap-2">
            {data.terrain_unknown ? (
              <p className="text-xs text-neutral-400">
                지형 미산정 · 목적지 계수 ×1.10 적용
              </p>
            ) : null}
            {data.providers.map((provider) => (
              <article
                key={provider.provider_id}
                className="rounded-lg border border-white/10 bg-white/[0.02] p-3"
              >
                <div className="flex items-center justify-between gap-3">
                  <h5 className="text-sm font-medium text-neutral-100">
                    {provider.name}
                  </h5>
                  <span
                    className={
                      provider.minimum_estimate_usd !== null &&
                      provider.minimum_estimate_usd ===
                        data.minimum_estimate_usd
                        ? 'text-xs font-mono text-emerald-300'
                        : 'text-xs text-neutral-400'
                    }
                  >
                    {provider.minimum_estimate_usd === null
                      ? '이 조건 계산 불가'
                      : `예상 ${formatPrice(provider.minimum_estimate_usd)}`}
                  </span>
                </div>
                {provider.issues.length ? (
                  <p className="mt-2 text-xs text-neutral-400">
                    {provider.issues.map((issue) => COPY[issue]).join(' · ')}{' '}
                    <a
                      href={provider.source.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-sky-300 hover:underline"
                    >
                      공식 정보 ↗
                    </a>
                  </p>
                ) : null}
                {provider.flights.map((flight) => (
                  <div
                    key={flight.mission_id}
                    className="mt-2 grid gap-1 text-xs text-neutral-400"
                  >
                    <span className="text-neutral-300">
                      {flight.name}
                      {flight.vehicle ? ` · ${flight.vehicle}` : ''}
                    </span>
                    <span>
                      출발: {flight.departure.label} / 착륙:{' '}
                      {flight.arrival.label}
                    </span>
                    <span>
                      {flight.price_usd !== null
                        ? `${formatPrice(flight.price_usd)} · 공개 조건 기반 추정`
                        : flight.tariff_usd_per_kg !== null
                          ? `공개 단가 $${flight.tariff_usd_per_kg.toLocaleString('en-US')}/kg · 총액 미정`
                          : '가격 미공개'}
                    </span>
                    {flight.estimate_usd !== null ? (
                      <div className="grid gap-1 border-l-2 border-amber-400/60 pl-2">
                        <span className="text-amber-200">
                          {formatPrice(flight.estimate_usd)} ·{' '}
                          {flight.estimate_basis === 'public_tariff'
                            ? '공개 단가 기반 예상'
                            : '공통 모델 예상'}
                        </span>
                        <span>
                          적용 단가 $
                          {flight.estimate_tariff_usd_per_kg?.toLocaleString(
                            'en-US',
                          )}
                          /kg · 고정비 $
                          {flight.estimate_fixed_usd?.toLocaleString('en-US')}
                        </span>
                        <span>{flight.estimate_assumptions.join(' · ')}</span>
                        {flight.estimate_tariff_source ? (
                          <a
                            className="text-sky-300 hover:underline"
                            href={flight.estimate_tariff_source.url}
                            target="_blank"
                            rel="noreferrer"
                          >
                            단가 근거 ↗
                          </a>
                        ) : null}
                      </div>
                    ) : null}
                    {flight.maximum_payload_kg !== null ? (
                      <span>
                        기체 적재 상한{' '}
                        {flight.maximum_payload_kg.toLocaleString()}kg
                        {flight.available_payload_kg !== null
                          ? ` · 공개 잔여량 ${flight.available_payload_kg.toLocaleString()}kg`
                          : ''}
                      </span>
                    ) : null}
                    {flight.fixed_usd !== null ? (
                      <span>
                        공개 고정비 ${flight.fixed_usd.toLocaleString('en-US')}
                      </span>
                    ) : null}
                    {flight.minimum_billable_kg !== null &&
                    flight.billing_increment_kg !== null ? (
                      <span>
                        최소 청구 질량 {flight.minimum_billable_kg}kg ·{' '}
                        {flight.billing_increment_kg === 0
                          ? '질량 비례 청구'
                          : `${flight.billing_increment_kg}kg 단위 올림`}
                      </span>
                    ) : null}
                    {flight.issues.length ? (
                      <span>
                        {flight.issues
                          .filter((issue) => issue !== 'price_unpublished')
                          .map((issue) => COPY[issue])
                          .join(' · ')}
                      </span>
                    ) : null}
                    <div className="flex flex-wrap gap-x-3 gap-y-1">
                      {flight.sources.map((source) => (
                        <a
                          key={source.url}
                          href={source.url}
                          target="_blank"
                          rel="noreferrer"
                          title={source.title}
                          className="text-sky-300 hover:underline"
                        >
                          {source.published_date ?? '공식 조건'} ↗
                        </a>
                      ))}
                    </div>
                  </div>
                ))}
              </article>
            ))}
          </div>
          <p className="text-[11px] text-neutral-500">
            {data.catalog_checked_on} 등록된 공개 자료와 기존 가격 모델 기준 ·
            회사 단가 미공개 시 공통 모델을 사용하므로 동일 예상 비용이 나올 수
            있습니다 · 실제 견적·운항 보장 아님
          </p>
        </>
      )}
    </section>
  )
}
