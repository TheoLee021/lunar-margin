# Launch Calendar Data Strategy — Demo Rationale & Future Lunar-Delivery Integration

**Status:** Documentation / future work. **No launch-schedule, pricing, API, or date-selection code change in this work item.**  
**Recorded:** 2026-11-15 (NASA Space Apps 2026).  
**Team coordination:** Discussed with Jingi; preserve his current launch-schedule/price-grid implementation. Future data changes require owner discussion and a separately scoped PR.

## Short explanation for the project / judges (English)

> The current launch calendar uses publicly listed scheduled launches, including non-lunar missions, as **illustrative date anchors** so users can explore how schedule changes affect lunar site and mission trade studies. These listings are **not verified lunar payload-delivery opportunities**, and the associated costs are **scenario estimates, not supplier quotes**. Public lunar mission schedules are relatively sparse and often published only as a month, year, or “no earlier than” window; they do not provide a complete live feed of exact launch days, spare payload capacity, commercial eligibility, or bookable prices. Future versions will integrate source-attributed lunar mission announcements and provider-confirmed delivery terms, separating **confirmed / tentative / unknown** availability from hypothetical mission-design scenarios.

This is an explanation of the present **data and UX trade-off**, not a claim that general-purpose launch schedules can establish feasibility of a lunar mission.

## 현재 동작을 유지하는 이유 (Korean working note)

### 현재 (Implemented)
- Spaceflight Now 및 Space Launch Schedule의 공개 예정 발사 기록을 읽는다. 일반 위성·군사·통신 발사까지 포함한다.
- 표시 날짜는 사용자가 달 착륙 임무를 검토할 **가상의 출발일 입력 기준점**으로 사용한다. 발사체가 달로 향한다거나 화물을 받는다는 근거가 아니다.
- 정확한 UTC 날짜가 있는 공개 일정만 날짜 표의 선택 가능한 출발일로 사용하고, 월/연도/NET/TBD의 불확실성을 임의의 날짜로 채우지 않는다.
- 발사사를 선택하면 해당 공급업체의 공개 단가 또는 공통 참조 단가를 사용한 **가정 기반 예상 비용**이 나온다. 이용 가능 재고·운송 가능성·예약·보장 견적이 아니다.
- 착륙지의 LOLA/SPICE 환경 분석은 실제 NASA/JPL 입력과 별도로 계산되며, 가상의 발사편이 실제 착륙 일정 또는 전이궤도 적합성을 입증하지 않는다.
- 현재 규칙 및 구현 세부 사항은 [launch-schedule.md](../launch-schedule.md), [provider-pricing.md](../provider-pricing.md), [API contract](../api.md)를 참조한다.

### 왜 이렇게 설계했는가 (Rationale)
- 달 운송을 포함한 공개 임무 목록은 일반 우주 발사 일정에 비해 상대적으로 적고, 일부는 정확한 일자가 아닌 **연도·월·NET(earliest)** 수준의 정보만 제공한다.
- NASA의 CLPS 일정/계약 공고는 임무·공급업체·목적지의 근거를 제공하지만, **특정 탑재체가 해당 출발편에 실릴 수 있는지, 잔여 수용량, 판매 가격, 확약된 운항일**을 보장하지 않는다.
- 따라서 현재는 달 임무인 것처럼 임의로 데이터를 꾸미지 않고, 공개 발사 예정일을 시뮬레이션의 **날짜 선택 앵커**로 쓴다. 정보가 없는 항목은 `unknown`으로 남겨두는 것이 원칙이다.
- 이 방식은 UI/워크플로 시연에는 유용하지만 실제 달 운송·착륙의 실행 가능성을 보증하지 않는다. 실제 달 임무가 아닌 출발편의 이름/가격을 현실의 CLPS 서비스로 오인해서는 안 된다.

### Future integration (후속 작업, 미구현)
**목표:** 시뮬레이션 일정과 실제로 검증된 달 운송 기회를 구분하는 데이터 소스 계층. 새로운 코드는 담당 팀원의 동의 및 **기능당 하나의 PR** 원칙 아래 별도 검토한다.

1. **Mission discovery — NASA CLPS & provider announcements.** NASA CLPS mission/delivery timeline 및 공급업체 공식 mission updates에서 임무 ID, 착륙선, 공급업체, 발표된 예정 기간, 대상 달 지역, 원문 URL, 발표/확인 시각을 수집한다. 기관 웹 페이지를 자동으로 읽을 수 있더라도 공식 **안정적 공개 API가 존재한다고 전제하지 않는다**.
2. **Schedule normalization.** `exact_utc_date / date_window / month / quarter / year / NET / TBD`로 발표 정확도를 보존한다. UTC 변환·출처 충돌·취소·연기를 기록하고, 임의로 날짜를 보정하지 않는다.
3. **Delivery qualification.** 발사체 일정과 **달 착륙 서비스 일정**을 분리한다. 지정 목적지, 탑재체 허용 질량·인터페이스, 잔여 용량, 판매 가능 여부를 공급업체가 확인하지 않으면 `unknown`으로 둔다.
4. **Price qualification.** Published tariff / modeled scenario / supplier quote의 근거 및 유효 기간을 구분한다. NASA task-order 계약 총액을 특정 탑재체의 구매 가격으로 변환하지 않는다.
5. **Mission trade integration.** 같은 착륙지·날짜 임무에 대해 `lunar_delivery_verified`, `published_schedule_only`, `hypothetical_simulation`을 다른 상태로 표시한다. 환경 적합성과 운송 가용성 판단을 독립적으로 기록한다.
6. **Tests & review.** 출처 스냅샷, 데이터 변동, 결측 처리, 중복 임무, NET 정밀도, 임무 취소, 부적격 발사체, 비용 가정, 만료된 요금을 검증한다. 실제 서비스/화물 예약을 주장하기 전 공급업체 1차 자료가 필요하다.

### Acceptance criteria for a *future* data-source PR
- 구체적 달 임무만을 `published_lunar_mission`으로 분류한다. 일반 발사편은 자동 전환하지 않는다.
- 정확한 일자가 공개되지 않은 임무는 날짜 선택 가능으로 임의 처리하지 않는다.
- `source_url`, `source_issued_at`, `last_checked_at`, `date_precision`, `delivery_scope`, `capacity_status`, `price_basis` 등의 provenance를 추적 가능하게 유지한다.
- 운송 가용성이 불명확해도 시나리오 분석은 **명시적 hypothetical 상태**로 계속 수행할 수 있도록 설계한다. 다만 현재 구현의 날짜 선택 제약을 수정하는 작업은 별도 논의·별도 PR 대상이다.
- 결과가 실제 구매 가능 가격이나 확약된 발사 서비스인 것처럼 화면에 나타나지 않는다.

## Official references (not evidence of live availability)
- [NASA — Commercial Lunar Payload Services overview / delivery timeline](https://www.nasa.gov/commercial-lunar-payload-services/)
- [NASA — CLPS Providers](https://www.nasa.gov/commercial-lunar-payload-services/clps-providers/)
- [NASA — CLPS deliveries](https://www.nasa.gov/mission/clps-deliveries/)
- [NASA — CLPS reference / contracts](https://www.nasa.gov/reference/commercial-lunar-payload-services/)
- Current public calendar sources and date/precision handling: [launch-schedule.md](../launch-schedule.md).
- Current public supplier and pricing model assumptions: [provider-pricing.md](../provider-pricing.md).

**Boundary:** No end-to-end live lunar booking feed, provider-confirmed spare capacity, exact-sale tariff, or payload flight compatibility is claimed to exist or be integrated today. No merge to the existing mission-planning implementation is requested by this document.
