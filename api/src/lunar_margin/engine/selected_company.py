"""A selected operator's planning model, independent of bookable lunar flight windows."""

import re
from datetime import date
from typing import Literal

import numpy as np
from numpy.typing import NDArray
from pydantic import Field, HttpUrl

from lunar_margin.engine.launch_schedule import ALIASES, PROVIDERS, Launch
from lunar_margin.engine.pricing import FIXED_LOW, TARIFF_SOURCE, TARIFFS, Delivery
from lunar_margin.engine.provider_pricing import (
    Catalog,
    Model,
    ProviderId,
    Source,
    estimated_billable_mass,
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
    mass, billing_assumptions = estimated_billable_mass(reference, mass_kg)
    assumptions = [
        "선택한 발사사의 단가를 적용한 달 배송 데모 모델",
        "실제 발사 임무·운항 기간·배송 가능 여부와의 연계 미확인",
        "경합도 미산정 1.00 적용",
    ]
    if reference is None:
        assumptions.append("회사 단가 미공개 · 배송 방식별 공통 참조 단가 사용")
    if reference is None or reference.fixed_usd is None:
        assumptions.append("고정비 $500,000 모델값 적용")
    assumptions.extend(billing_assumptions)
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


def scheduled_models(
    catalog: Catalog,
    launches: list[Launch],
    departure: date,
    *,
    mass_kg: float,
    delivery: Delivery,
) -> list[CompanyModel]:
    """Only operators actually listed on this UTC departure day, one model per operator."""
    by_company: dict[str, CompanyModel] = {}
    for launch in sorted(launches, key=lambda item: item.id):
        if launch.departure_date != departure:
            continue
        model = company_model(catalog, launch, mass_kg=mass_kg, delivery=delivery)
        key = model.company_id or model.company_name.casefold().strip()
        by_company.setdefault(key, model)
    return list(by_company.values())


def minimum_company_prices(
    models: list[CompanyModel], factors: NDArray[np.float64]
) -> tuple[NDArray[np.float64], list[CompanyModel]]:
    """Per-grid minima and every operator contributing to them, including ties."""
    if (
        factors.ndim != 1
        or not np.isfinite(factors).all()
        or np.any((factors < 1) | (factors > 1.3))
    ):
        raise ValueError("finite destination factors between 1 and 1.3 required")
    if not models or factors.size == 0:
        return np.full(factors.shape, np.inf, dtype=np.float64), []
    costs = np.array(
        [
            model.fixed_usd + model.tariff_usd_per_kg * model.billable_mass_kg * factors
            for model in models
        ]
    )
    minima = np.min(costs, axis=0)
    winners = [
        model
        for index, model in enumerate(models)
        if np.any(np.isclose(costs[index], minima, rtol=0, atol=0.005))
    ]
    return minima, winners
