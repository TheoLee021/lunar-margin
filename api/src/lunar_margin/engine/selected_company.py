"""A selected operator's planning model, independent of bookable lunar flight windows."""

import re
from typing import Literal

from pydantic import Field, HttpUrl

from lunar_margin.engine.launch_schedule import ALIASES, PROVIDERS, Launch
from lunar_margin.engine.pricing import FIXED_LOW, TARIFF_SOURCE, TARIFFS, Delivery
from lunar_margin.engine.provider_pricing import (
    Catalog,
    Model,
    ProviderId,
    Source,
    billable_mass,
)


class CompanyModel(Model):
    launch_id: str
    launch_name: str
    company_id: ProviderId | None
    company_name: str
    tariff_usd_per_kg: float = Field(gt=0)
    fixed_usd: float = Field(ge=0)
    billable_mass_kg: float = Field(gt=0)
    tariff_basis: Literal["public_tariff", "common_model"]
    tariff_source: Source
    assumptions: list[str]


def company_model(
    catalog: Catalog, launch: Launch, *, mass_kg: float, delivery: Delivery
) -> CompanyModel:
    operator: ProviderId | None = next(
        (p.provider_id for p in launch.participants if p.role == "launch"), None
    )
    if operator is None:
        operator = next(
            (key for key in PROVIDERS if re.search(ALIASES[key], launch.launch_provider, re.I)),
            None,
        )
    provider = next((p for p in catalog.providers if p.id == operator), None)
    public = (
        [
            f.pricing
            for f in provider.flights
            if f.pricing is not None and f.deliveries is not None and delivery in f.deliveries
        ]
        if provider
        else []
    )
    reference = min(public, key=lambda pricing: pricing.usd_per_kg, default=None)
    tariff = reference.usd_per_kg if reference else TARIFFS[delivery]
    fixed = reference.fixed_usd if reference and reference.fixed_usd is not None else FIXED_LOW
    mass = (
        billable_mass(reference, mass_kg)
        if reference
        and reference.minimum_billable_kg is not None
        and reference.billing_increment_kg is not None
        else mass_kg
    )
    assumptions = [
        "선택한 발사사의 단가를 적용한 달 배송 데모 모델",
        "실제 발사 임무·운항 기간·배송 가능 여부와의 연계 미확인",
        "경합도 미산정 1.00 적용",
    ]
    if reference is None:
        assumptions.append("회사 단가 미공개 · 배송 방식별 공통 참조 단가 사용")
    if reference is None or reference.fixed_usd is None:
        assumptions.append("고정비 $500,000 모델값 적용")
    if (
        reference is None
        or reference.minimum_billable_kg is None
        or reference.billing_increment_kg is None
    ):
        assumptions.append("최소 청구량·청구 단위 미확인 · 입력 질량 비례 가정")
    return CompanyModel(
        launch_id=launch.id,
        launch_name=launch.name,
        company_id=operator,
        company_name=PROVIDERS[operator] if operator else launch.launch_provider,
        tariff_usd_per_kg=tariff,
        fixed_usd=fixed,
        billable_mass_kg=mass,
        tariff_basis="public_tariff" if reference else "common_model",
        tariff_source=reference.source
        if reference
        else Source(title="공통 참조 단가 · 회사별 견적 아님", url=HttpUrl(TARIFF_SOURCE)),
        assumptions=assumptions,
    )
