"""Published provider terms, separate from terrain analysis and historical benchmarks."""

import math
from datetime import date
from decimal import ROUND_CEILING, Decimal
from functools import lru_cache
from importlib.resources import files
from typing import Literal, Self

import numpy as np
from numpy.typing import NDArray
from pydantic import BaseModel, ConfigDict, Field, HttpUrl, model_validator

from lunar_margin.engine.candidates.projection import polar_xy_to_lonlat
from lunar_margin.engine.ephemeris import MOON_RADIUS_M
from lunar_margin.engine.pricing import FIXED_LOW, TARIFF_SOURCE, TARIFFS, Delivery

ProviderId = Literal[
    "blue_origin", "ispace_us", "spacex", "lockheed_martin", "northrop_grumman", "voyager"
]
Issue = Literal[
    "mission_unpublished",
    "schedule_unknown",
    "outside_schedule",
    "transit_out_of_range",
    "delivery_unknown",
    "delivery_unserved",
    "capacity_unknown",
    "capacity_exceeded",
    "destination_unknown",
    "destination_unserved",
    "price_unpublished",
    "pricing_terms_unknown",
    "terrain_excluded",
]


class Model(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False, frozen=True)


class Source(Model):
    title: str
    url: HttpUrl
    published_date: date | None = None


class Schedule(Model):
    label: str
    precision: Literal["unknown", "year", "month", "day", "window", "not_before"] = "unknown"
    start: date | None = None
    end: date | None = None
    confirmed: bool = False

    @model_validator(mode="after")
    def valid_window(self) -> Self:
        if self.start is not None and self.end is not None and self.end < self.start:
            raise ValueError("schedule end precedes start")
        if self.confirmed and (
            self.precision not in ("day", "window") or self.start is None or self.end is None
        ):
            raise ValueError("confirmed schedules need an explicit day-level window")
        return self


class PublishedPricing(Model):
    usd_per_kg: float = Field(gt=0, le=1e12)
    fixed_usd: float | None = Field(default=None, ge=0, le=1e15)
    minimum_billable_kg: float | None = Field(default=None, ge=0, le=1e6)
    billing_increment_kg: float | None = Field(default=None, ge=0, le=1e6)
    source: Source


class Destination(Model):
    kind: Literal["global", "circle"]
    lat_deg: float | None = Field(default=None, ge=-90, le=90)
    lon_deg: float | None = Field(default=None, ge=-180, le=360)
    radius_m: float | None = Field(default=None, gt=0)

    @model_validator(mode="after")
    def valid_circle(self) -> Self:
        if self.kind == "circle" and any(
            value is None for value in (self.lat_deg, self.lon_deg, self.radius_m)
        ):
            raise ValueError("delivery circles need a published center and reach")
        return self


class Flight(Model):
    id: str
    name: str
    vehicle: str | None = None
    departure: Schedule
    arrival: Schedule
    deliveries: list[Delivery] | None = None
    maximum_payload_kg: float | None = Field(default=None, gt=0)
    available_payload_kg: float | None = Field(default=None, ge=0)
    destination: Destination | None = None
    pricing: PublishedPricing | None = None
    sources: list[Source] = Field(min_length=1)


class Provider(Model):
    id: ProviderId
    name: str
    source: Source
    flights: list[Flight]


class Catalog(Model):
    checked_on: date
    providers: list[Provider] = Field(min_length=6, max_length=6)

    @model_validator(mode="after")
    def unique_ids(self) -> Self:
        if len({provider.id for provider in self.providers}) != 6:
            raise ValueError("the six provider IDs must each appear exactly once")
        ids = [flight.id for provider in self.providers for flight in provider.flights]
        if len(ids) != len(set(ids)):
            raise ValueError("mission IDs must be unique")
        return self


class QuoteContext(Model):
    estimate: bool = False
    departure_date: date
    landing_date: date
    mass_kg: float = Field(gt=0, le=1_000_000)
    delivery: Delivery


class FlightOffer(Model):
    mission_id: str
    name: str
    vehicle: str | None
    departure: Schedule
    arrival: Schedule
    tariff_usd_per_kg: float | None
    fixed_usd: float | None = None
    minimum_billable_kg: float | None = None
    billing_increment_kg: float | None = None
    maximum_payload_kg: float | None
    available_payload_kg: float | None
    issues: list[Issue]
    sources: list[Source]
    estimate_usd: float | None = None
    estimate_basis: Literal["public_tariff", "common_model"] | None = None
    estimate_assumptions: list[str] = Field(default_factory=list)
    estimate_tariff_usd_per_kg: float | None = None
    estimate_fixed_usd: float | None = None
    estimate_tariff_source: Source | None = None
    price_usd: float | None = None
    price_grade: Literal["modeled_from_published_terms"] | None = None


class ProviderOffer(Model):
    provider_id: ProviderId
    name: str
    source: Source
    issues: list[Issue]
    flights: list[FlightOffer]
    minimum_usd: float | None = None
    minimum_estimate_usd: float | None = None


@lru_cache(maxsize=1)
def load_catalog() -> Catalog:
    return Catalog.model_validate_json(
        files("lunar_margin").joinpath("provider_catalog.json").read_text()
    )


def flight_issues(flight: Flight, context: QuoteContext) -> list[Issue]:
    issues: list[Issue] = []
    if not 3 <= (context.landing_date - context.departure_date).days <= 150:
        issues.append("transit_out_of_range")
    for schedule, value in (
        (flight.departure, context.departure_date),
        (flight.arrival, context.landing_date),
    ):
        if schedule.precision == "not_before" and schedule.start and value < schedule.start:
            issues.append("outside_schedule")
        elif not schedule.confirmed:
            issues.append("schedule_unknown")
        elif schedule.start and schedule.end and not schedule.start <= value <= schedule.end:
            issues.append("outside_schedule")
    if flight.deliveries is None:
        issues.append("delivery_unknown")
    elif context.delivery not in flight.deliveries:
        issues.append("delivery_unserved")
    maximum = flight.maximum_payload_kg
    available = flight.available_payload_kg
    if (maximum is not None and context.mass_kg > maximum) or (
        available is not None and context.mass_kg > available
    ):
        issues.append("capacity_exceeded")
    elif available is None:
        issues.append("capacity_unknown")
    if flight.destination is None:
        issues.append("destination_unknown")
    if flight.pricing is None:
        issues.append("price_unpublished")
    elif any(
        value is None
        for value in (
            flight.pricing.fixed_usd,
            flight.pricing.minimum_billable_kg,
            flight.pricing.billing_increment_kg,
        )
    ):
        issues.append("pricing_terms_unknown")
    return list(dict.fromkeys(issues))


def billable_mass(pricing: PublishedPricing, mass_kg: float) -> float:
    if pricing.minimum_billable_kg is None or pricing.billing_increment_kg is None:
        raise ValueError("published billing terms required")
    mass = max(mass_kg, pricing.minimum_billable_kg)
    step = pricing.billing_increment_kg
    if not step:
        return mass
    units = (Decimal(str(mass)) / Decimal(str(step))).to_integral_value(rounding=ROUND_CEILING)
    return float(units * Decimal(str(step)))


def assess_catalog(catalog: Catalog, context: QuoteContext) -> list[ProviderOffer]:
    return [
        ProviderOffer(
            provider_id=provider.id,
            name=provider.name,
            source=provider.source,
            issues=[] if provider.flights else ["mission_unpublished", "price_unpublished"],
            flights=[
                FlightOffer(
                    mission_id=flight.id,
                    name=flight.name,
                    vehicle=flight.vehicle,
                    departure=flight.departure,
                    arrival=flight.arrival,
                    tariff_usd_per_kg=flight.pricing.usd_per_kg if flight.pricing else None,
                    fixed_usd=flight.pricing.fixed_usd if flight.pricing else None,
                    minimum_billable_kg=flight.pricing.minimum_billable_kg
                    if flight.pricing
                    else None,
                    billing_increment_kg=flight.pricing.billing_increment_kg
                    if flight.pricing
                    else None,
                    maximum_payload_kg=flight.maximum_payload_kg,
                    available_payload_kg=flight.available_payload_kg,
                    issues=flight_issues(flight, context),
                    sources=flight.sources,
                )
                for flight in provider.flights
            ],
        )
        for provider in catalog.providers
    ]


def destination_mask(
    destination: Destination,
    x_m: NDArray[np.float64],
    y_m: NDArray[np.float64],
) -> NDArray[np.bool_]:
    if destination.kind == "global":
        return np.ones(x_m.shape, dtype=np.bool_)
    if destination.lat_deg is None or destination.lon_deg is None or destination.radius_m is None:
        raise ValueError("published delivery circle required")
    lat, lon = polar_xy_to_lonlat(x_m, y_m)
    phi, lam = np.radians(lat), np.radians(lon)
    center_phi, center_lam = math.radians(destination.lat_deg), math.radians(destination.lon_deg)
    a = (
        np.sin((phi - center_phi) / 2) ** 2
        + np.cos(phi) * math.cos(center_phi) * np.sin((lam - center_lam) / 2) ** 2
    )
    distance = 2 * MOON_RADIUS_M * np.arcsin(np.sqrt(np.clip(a, 0, 1)))
    return distance <= destination.radius_m


def estimate_catalog(catalog: Catalog, context: QuoteContext) -> Catalog:
    """No published mission still permits an explicitly labeled planning model."""
    if not context.estimate:
        return catalog
    providers = [
        provider
        if provider.flights
        else provider.model_copy(
            update={
                "flights": [
                    Flight(
                        id=f"model-{provider.id}",
                        name="공통 비용 모델 · 운항편 미확인",
                        departure=Schedule(label="발사 일정 미정"),
                        arrival=Schedule(label="사용자가 선택한 착륙일"),
                        sources=[provider.source],
                    )
                ]
            }
        )
        for provider in catalog.providers
    ]
    return catalog.model_copy(update={"providers": providers})


def estimate_blocked(flight: Flight, context: QuoteContext) -> bool:
    # Unknown terms are disclosed assumptions, known incompatibilities remain exclusions.
    hard: set[Issue] = {
        "transit_out_of_range",
        "outside_schedule",
        "delivery_unserved",
        "capacity_exceeded",
    }
    return bool(hard.intersection(flight_issues(flight, context)))


def estimate_terms(flight: Flight, context: QuoteContext) -> tuple[float, float, float, list[str]]:
    pricing = flight.pricing
    tariff = pricing.usd_per_kg if pricing else TARIFFS[context.delivery]
    fixed = pricing.fixed_usd if pricing and pricing.fixed_usd is not None else FIXED_LOW
    assumptions = [
        "실제 운항·예약 가능 여부 미확인",
        "착륙일은 사용자가 선택한 분석 시점",
        "경합도 미산정 1.00 적용",
    ]
    if pricing is None:
        assumptions.append("회사 단가 미공개 · 기존 배송 방식별 공통 참조 단가 사용")
    if pricing is None or pricing.fixed_usd is None:
        assumptions.append("고정비 $500,000 모델값 적용")
    if (
        pricing
        and pricing.minimum_billable_kg is not None
        and pricing.billing_increment_kg is not None
    ):
        mass = billable_mass(pricing, context.mass_kg)
    else:
        mass = context.mass_kg
        assumptions.append("최소 청구량·청구 단위 미확인 · 입력 질량 비례 가정")
    if flight.destination is None:
        assumptions.append("이 위치의 배송 가능 여부 미확인")
    return tariff, fixed, mass, assumptions


def minimum_grid_prices(
    catalog: Catalog,
    context: QuoteContext,
    *,
    x_m: NDArray[np.float64],
    y_m: NDArray[np.float64],
    destination_multipliers: NDArray[np.float64],
) -> NDArray[np.float64]:
    """All grids, cheap vector operations only. No DEM/SPICE work per provider."""
    if (
        x_m.ndim != 1
        or x_m.shape != y_m.shape
        or x_m.shape != destination_multipliers.shape
        or not np.isfinite(x_m).all()
        or not np.isfinite(y_m).all()
        or not np.isfinite(destination_multipliers).all()
        or np.any((destination_multipliers < 1) | (destination_multipliers > 1.3))
    ):
        raise ValueError("finite, equally sized grid vectors and destination factors required")
    minimum = np.full(x_m.shape, np.inf, dtype=np.float64)
    for provider in estimate_catalog(catalog, context).providers:
        for flight in provider.flights:
            if context.estimate:
                if estimate_blocked(flight, context):
                    continue
                tariff, fixed, mass, _ = estimate_terms(flight, context)
                costs = fixed + tariff * mass * destination_multipliers
                if flight.destination is not None:
                    costs = np.where(destination_mask(flight.destination, x_m, y_m), costs, np.inf)
                np.minimum(minimum, costs, out=minimum)
                continue
            pricing = flight.pricing
            destination = flight.destination
            if (
                flight_issues(flight, context)
                or pricing is None
                or destination is None
                or pricing.fixed_usd is None
            ):
                continue
            costs = (
                pricing.fixed_usd
                + pricing.usd_per_kg
                * billable_mass(pricing, context.mass_kg)
                * destination_multipliers
            )
            costs = np.where(destination_mask(destination, x_m, y_m), costs, np.inf)
            np.minimum(minimum, costs, out=minimum)
    return minimum


def compare_grid(
    catalog: Catalog,
    context: QuoteContext,
    *,
    x_m: float,
    y_m: float,
    destination_multiplier: float,
    terrain_excluded: bool = False,
) -> list[ProviderOffer]:
    catalog = estimate_catalog(catalog, context)
    offers = assess_catalog(catalog, context)
    for offer_index, (provider, offer) in enumerate(zip(catalog.providers, offers, strict=True)):
        updated: list[FlightOffer] = []
        for flight, flight_offer in zip(provider.flights, offer.flights, strict=True):
            issues = flight_offer.issues.copy()
            if terrain_excluded:
                issues.append("terrain_excluded")
            if (
                flight.destination is not None
                and not destination_mask(flight.destination, np.array([x_m]), np.array([y_m]))[0]
            ):
                issues.append("destination_unserved")
            price: float | None = None
            pricing = flight.pricing
            if not issues and pricing is not None and pricing.fixed_usd is not None:
                price = (
                    pricing.fixed_usd
                    + pricing.usd_per_kg
                    * billable_mass(pricing, context.mass_kg)
                    * destination_multiplier
                )
            estimate: float | None = None
            basis: Literal["public_tariff", "common_model"] | None = None
            assumptions: list[str] = []
            tariff: float | None = None
            fixed: float | None = None
            tariff_source: Source | None = None
            if (
                context.estimate
                and not terrain_excluded
                and "destination_unserved" not in issues
                and not estimate_blocked(flight, context)
            ):
                tariff, fixed, mass, assumptions = estimate_terms(flight, context)
                estimate = fixed + tariff * mass * destination_multiplier
                basis = "public_tariff" if pricing else "common_model"
                tariff_source = (
                    pricing.source
                    if pricing
                    else Source(
                        title="공통 참조 단가 · Astrobotic PUG (회사별 견적 아님)",
                        url=HttpUrl(TARIFF_SOURCE),
                    )
                )
            updated.append(
                flight_offer.model_copy(
                    update={
                        "estimate_usd": estimate,
                        "estimate_basis": basis,
                        "estimate_assumptions": assumptions,
                        "estimate_tariff_usd_per_kg": tariff,
                        "estimate_fixed_usd": fixed,
                        "estimate_tariff_source": tariff_source,
                        "issues": issues,
                        "price_usd": price,
                        "price_grade": "modeled_from_published_terms"
                        if price is not None
                        else None,
                    }
                )
            )
        values = [flight.price_usd for flight in updated if flight.price_usd is not None]
        offers[offer_index] = offer.model_copy(
            update={
                "flights": updated,
                "minimum_estimate_usd": min(
                    (f.estimate_usd for f in updated if f.estimate_usd is not None), default=None
                ),
                "minimum_usd": min(values) if values else None,
            }
        )
    return offers
