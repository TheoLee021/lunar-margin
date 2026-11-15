"""Six-provider comparisons. Schedules are assessed before touching any terrain grids."""

import math
from datetime import date
from typing import Annotated, Literal, Self

import numpy as np
from fastapi import APIRouter, Depends, HTTPException
from numpy.typing import NDArray
from pydantic import Field, model_validator

from lunar_margin.app.candidates import SettingsDep
from lunar_margin.app.launch_schedule import get_reader
from lunar_margin.app.pricing import CalendarRequest, PricingDemDep, RunCargo, RunPrices, price_run
from lunar_margin.engine.candidates.mission import MissionRequest
from lunar_margin.engine.pricing import Delivery, Terrain, terrain_at
from lunar_margin.engine.provider_pricing import (
    Catalog,
    Model,
    ProviderId,
    ProviderOffer,
    QuoteContext,
    compare_grid,
    estimate_blocked,
    estimate_catalog,
    flight_issues,
    load_catalog,
    minimum_grid_prices,
)
from lunar_margin.engine.selected_company import CompanyModel, company_model
from lunar_margin.pipeline.candidate_status import read_status

router = APIRouter(prefix="/pricing/providers", tags=["provider pricing"])
CatalogDep = Annotated[Catalog, Depends(load_catalog)]


class ProviderCalendarRequest(CalendarRequest):
    estimate: bool = False
    selected_launch_id: str | None = Field(default=None, pattern=r"^[A-Za-z0-9_-]{1,160}$")
    departure_dates: list[date] = Field(min_length=1, max_length=5)
    source_run_id: str | None = Field(default=None, pattern=r"^[A-Za-z0-9_-]{1,120}$")

    @model_validator(mode="after")
    def unique_departures(self) -> Self:
        if self.selected_launch_id is not None and not self.estimate:
            raise ValueError("selected_launch_id is available only for demo estimates")
        if len(set(self.departure_dates)) != len(self.departure_dates):
            raise ValueError("departure_dates must be unique")
        return self


class SearchDate(Model):
    landing_date: date
    run_id: str
    state: Literal["completed", "not_computed", "running", "failed", "unavailable"]
    message: str | None = None


class CalendarCell(Model):
    departure_date: date
    landing_date: date
    run_id: str
    status: Literal[
        "no_published_quote",
        "search_required",
        "quoted",
        "estimated",
        "partial_coverage",
        "no_eligible",
        "invalid_transit",
        "unavailable",
    ]
    mean_min_usd: float | None = None
    eligible_grid_count: int | None = None
    terrain_unknown_count: int | None = None
    quoted_grid_count: int = 0
    eligible_provider_ids: list[ProviderId] = Field(default_factory=lambda: list[ProviderId]())


class ProviderCalendar(Model):
    estimate: bool = False
    selection: CompanyModel | None = None
    catalog_checked_on: date
    mass_kg: float
    delivery: Delivery
    mission_duration_days: int
    dates: list[SearchDate]
    cells: list[CalendarCell]
    aggregation: Literal["mean_of_grid_minima"] = "mean_of_grid_minima"
    sampling: Literal["all_eligible_500m_grids"] = "all_eligible_500m_grids"


class GridRequest(QuoteContext):
    x_m: float = Field(ge=-350_000, le=350_000)
    y_m: float = Field(ge=-350_000, le=350_000)


class GridComparison(Model):
    catalog_checked_on: date
    departure_date: date
    landing_date: date
    mass_kg: float
    delivery: Delivery
    x_m: float
    y_m: float
    minimum_usd: float | None
    minimum_estimate_usd: float | None
    estimate: bool
    providers: list[ProviderOffer]
    destination_multiplier: float | None
    terrain_unknown: bool | None
    demand_multiplier: float = Field(default=1.0, ge=1.0, le=1.0)
    demand_unknown: Literal[True] = True


@router.get("/catalog")
def get_provider_catalog(catalog: CatalogDep) -> Catalog:
    return catalog


@router.post("/compare")
def get_grid_comparison(
    request: GridRequest,
    catalog: CatalogDep,
    dem: PricingDemDep,
) -> GridComparison:
    needs_terrain = any(
        (
            not estimate_blocked(flight, request)
            if request.estimate
            else not flight_issues(flight, request)
        )
        for provider in estimate_catalog(catalog, request).providers
        for flight in provider.flights
    )
    terrain: Terrain | None = None
    multiplier: float | None = None
    if needs_terrain:
        terrain = terrain_at(dem, request.x_m, request.y_m) if dem else Terrain(None, None)
        multiplier = (
            1.1 if terrain.landable_fraction is None else 1 + 0.3 * (1 - terrain.landable_fraction)
        )
    excluded = terrain is not None and (
        (terrain.landable_fraction is not None and terrain.landable_fraction < 0.05)
        or (terrain.aim_slope_deg is not None and terrain.aim_slope_deg > 10)
    )
    offers = compare_grid(
        catalog,
        request,
        x_m=request.x_m,
        y_m=request.y_m,
        destination_multiplier=multiplier if multiplier is not None else 1.1,
        terrain_excluded=excluded,
    )
    values = [offer.minimum_usd for offer in offers if offer.minimum_usd is not None]
    return GridComparison(
        catalog_checked_on=catalog.checked_on,
        departure_date=request.departure_date,
        landing_date=request.landing_date,
        mass_kg=request.mass_kg,
        delivery=request.delivery,
        x_m=request.x_m,
        y_m=request.y_m,
        minimum_usd=min(values) if values else None,
        minimum_estimate_usd=min(
            (o.minimum_estimate_usd for o in offers if o.minimum_estimate_usd is not None),
            default=None,
        ),
        estimate=request.estimate,
        providers=offers,
        destination_multiplier=multiplier,
        terrain_unknown=None
        if terrain is None
        else (terrain.landable_fraction is None or terrain.aim_slope_deg is None),
    )


@router.post("/calendar")
def get_provider_calendar(
    request: ProviderCalendarRequest,
    catalog: CatalogDep,
    settings: SettingsDep,
    dem: PricingDemDep,
) -> ProviderCalendar:
    selected: CompanyModel | None = None
    if request.selected_launch_id:
        launch = next(
            (
                item
                for item in get_reader().peek().launches
                if item.id == request.selected_launch_id
            ),
            None,
        )
        if launch is None:
            raise HTTPException(
                status_code=409,
                detail="선택한 발사 일정을 찾을 수 없습니다. 목록에서 다시 선택하세요.",
            )
        selected = company_model(
            catalog, launch, mass_kg=request.mass_kg, delivery=request.delivery
        )
    dates: list[SearchDate] = []
    cells: list[CalendarCell] = []
    grids: dict[date, RunPrices] = {}
    vectors: dict[date, tuple[NDArray[np.float64], NDArray[np.float64], NDArray[np.float64]]] = {}
    minima: dict[tuple[date, tuple[str, ...]], NDArray[np.float64]] = {}
    saved_ids: dict[date, str] = {}
    if request.source_run_id:
        source_root = settings.data_dir / "candidates" / request.source_run_id
        try:
            source_mission = MissionRequest.model_validate_json(
                (source_root / "mission.json").read_text()
            )
        except (OSError, ValueError) as error:
            raise HTTPException(
                status_code=409, detail="선택한 탐색 실행의 임무 조건을 읽을 수 없습니다"
            ) from error
        desired = request.mission.model_dump(exclude={"landing_date"})
        if source_mission.model_dump(exclude={"landing_date"}) == desired:
            # Reuse the chosen saved grids across search-hash versions, never edited conditions.
            for folder in sorted(source_root.parent.iterdir()):
                if folder.name.startswith("dev-") or not (folder / "candidates.json").is_file():
                    continue
                try:
                    saved = MissionRequest.model_validate_json(
                        (folder / "mission.json").read_text()
                    )
                except OSError, ValueError:
                    continue
                if saved.model_dump(exclude={"landing_date"}) == desired:
                    saved_ids[saved.landing_date] = folder.name
            if not request.source_run_id.startswith("dev-"):
                saved_ids[source_mission.landing_date] = request.source_run_id
    for landing in request.landing_dates:
        mission = MissionRequest.model_validate(
            {**request.mission.model_dump(), "landing_date": landing}
        )
        run_id = saved_ids.get(landing, mission.run_id())
        root = settings.data_dir / "candidates" / run_id
        status = read_status(root) if root.is_dir() else None
        state: Literal["completed", "not_computed", "running", "failed", "unavailable"] = (
            "not_computed"
        )
        message: str | None = None
        if status and status.state in ("queued", "running"):
            state = "running"
        elif status and status.state == "failed":
            state, message = "failed", status.error
        elif (root / "candidates.json").is_file():
            state = "completed"
        dates.append(SearchDate(landing_date=landing, run_id=run_id, state=state, message=message))
        for departure in request.departure_dates:
            context = QuoteContext(
                estimate=request.estimate,
                departure_date=departure,
                landing_date=landing,
                mass_kg=request.mass_kg,
                delivery=request.delivery,
            )
            possible: dict[ProviderId, list[str]] = {
                provider.id: [
                    flight.id
                    for flight in provider.flights
                    if (
                        not estimate_blocked(flight, context)
                        if request.estimate
                        else not flight_issues(flight, context)
                    )
                ]
                for provider in estimate_catalog(catalog, context).providers
            }
            provider_ids: list[ProviderId] = [key for key, value in possible.items() if value]
            if selected is not None:
                provider_ids = [selected.company_id] if selected.company_id is not None else []
            cell = CalendarCell(
                departure_date=departure,
                landing_date=landing,
                run_id=run_id,
                status="no_published_quote",
                eligible_provider_ids=provider_ids,
            )
            if not 3 <= (landing - departure).days <= 150:
                cells.append(cell.model_copy(update={"status": "invalid_transit"}))
                continue
            if not provider_ids and selected is None:
                cells.append(cell)
                continue  # Public terms are unknown: no DEM loop or six repeated searches.
            if state != "completed":
                cells.append(cell.model_copy(update={"status": "search_required"}))
                continue
            if landing not in grids:
                try:
                    grids[landing] = price_run(
                        run_id,
                        settings.data_dir,
                        RunCargo(mass_kg=request.mass_kg, delivery=request.delivery),
                        dem,
                        include_cells=True,
                    )
                except HTTPException:
                    cells.append(cell.model_copy(update={"status": "unavailable"}))
                    continue
                valid = [item for item in grids[landing].cells if item.price is not None]
                vectors[landing] = (
                    np.array([item.x_m for item in valid], dtype=np.float64),
                    np.array([item.y_m for item in valid], dtype=np.float64),
                    np.array(
                        [
                            item.price.destination_multiplier
                            for item in valid
                            if item.price is not None
                        ],
                        dtype=np.float64,
                    ),
                )
            x_m, y_m, factors = vectors[landing]
            key = (
                landing,
                tuple(sorted(flight for value in possible.values() for flight in value)),
            )
            if selected is not None:
                key = (landing, ("selected-company", selected.launch_id))
            if key not in minima and selected is not None:
                minima[key] = (
                    selected.fixed_usd
                    + selected.tariff_usd_per_kg * selected.billable_mass_kg * factors
                )
            if key not in minima:
                minima[key] = minimum_grid_prices(
                    catalog, context, x_m=x_m, y_m=y_m, destination_multipliers=factors
                )
            values = minima[key]
            finite = values[np.isfinite(values)]
            n, priced = len(values), len(finite)
            mean = math.fsum(float(value) for value in finite) / n if n and n == priced else None
            cells.append(
                cell.model_copy(
                    update={
                        "status": "no_eligible"
                        if n == 0
                        else ("estimated" if request.estimate else "quoted")
                        if mean is not None
                        else "partial_coverage",
                        "mean_min_usd": mean,
                        "eligible_grid_count": n,
                        "terrain_unknown_count": grids[landing].counts.terrain_unknown,
                        "quoted_grid_count": priced,
                    }
                )
            )
    return ProviderCalendar(
        estimate=request.estimate,
        selection=selected,
        catalog_checked_on=catalog.checked_on,
        mass_kg=request.mass_kg,
        delivery=request.delivery,
        mission_duration_days=request.mission.mission_duration_days,
        dates=dates,
        cells=cells,
    )
