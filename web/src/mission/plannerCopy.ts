const pricingAssumptions: Record<string, string> = {
  '선택한 발사사의 단가를 적용한 달 배송 데모 모델':
    'Lunar delivery costs are modeled using the selected provider’s rate.',
  '실제 발사 임무·운항 기간·배송 가능 여부와의 연계 미확인':
    'Mission, operating window, and delivery availability have yet to be verified.',
  '경합도 미산정 1.00 적용': 'The model assumes a competition factor of 1.00.',
  '회사 단가 미공개 · 배송 방식별 공통 참조 단가 사용':
    'The provider has no published rate. The model uses the reference rate for this delivery method.',
  '고정비 $500,000 모델값 적용': 'The model assumes a fixed cost of $500,000.',
  '최소 청구량·청구 단위 미확인 · 입력 질량 비례 가정':
    'Minimum billable mass and billing increments are unknown. Cost scales with payload mass.',
  '최소 청구량 미확인 · 입력 질량을 하한으로 가정':
    'Minimum billable mass is unknown. The model uses the payload mass as the minimum.',
  '청구 단위 미확인 · 추가 올림 없음 가정':
    'Billing increments are unknown. The model uses the mass without rounding up.',
}

export function assumptionLabel(value: string) {
  return pricingAssumptions[value] ?? value
}

export function englishMessage(value: string, fallback: string) {
  return /[가-힣]/.test(value) ? fallback : value
}
