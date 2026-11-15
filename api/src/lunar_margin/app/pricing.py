"""Prices of eligible 500m search samples, grouped by actual landing-date runs."""

import math
from datetime import date
from functools import lru_cache
from pathlib import Path
from typing import Annotated, Literal, Self, cast

import numpy as np
from fastapi import APIRouter, Depends, HTTPException, Query
from numpy.typing import NDArray
from pydantic import BaseModel, ConfigDict, Field, model_validator

from lunar_margin.app.candidates import RunId, SettingsDep
from lunar_margin.engine.candidates.config import SearchConfig
from lunar_margin.engine.candidates.mission import MissionRequest
from lunar_margin.engine.dem import PolarDem
from lunar_margin.engine.pricing import (
    TARIFF_SOURCE,
    TARIFFS,
    Delivery,
    Price,
    Terrain,
    quote,
    terrain_at,
)
from lunar_margin.pipeline.candidate_status import read_status
from lunar_margin.pipeline.sources import DEM_SOURCES

router = APIRouter(prefix="/pricing", tags=["pricing"])


class Cargo(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    mass_kg: float = Field(default=24, gt=0, le=1_000_000)
    delivery: Delivery = "surface"


class CalendarRequest(Cargo):
    mission: MissionRequest
    landing_dates: list[date] = Field(min_length=1, max_length=5)

    @model_validator(mode="after")
    def valid_dates(self) -> Self:
        if len(set(self.landing_dates)) != len(self.landing_dates):
            raise ValueError("landing_dates must be unique")
        for landing in self.landing_dates:
            MissionRequest.model_validate({**self.mission.model_dump(), "landing_date": landing})
        return self


class RunCargo(Cargo):
    include_cells: bool = False


class GridPrice(BaseModel):
    id: str
    x_m: float
    y_m: float
    landable_fraction: float | None
    aim_slope_deg: float | None
    price: Price | None
    excluded_reason: str | None


class Counts(BaseModel):
    fine: int = 0
    eligible: int = 0
    priced: int = 0
    terrain_excluded: int = 0
    terrain_unknown: int = 0
    unevaluated: int = 0
    coarse_ignored: int = 0


class RunPrices(BaseModel):
    run_id: str
    landing_date: date
    mission_duration_days: int
    grid_spacing_m: Literal[500] = 500
    counts: Counts
    mean: Price | None
    cells: list[GridPrice]


class CalendarDate(BaseModel):
    landing_date: date
    run_id: str
    state: Literal["ready", "no_eligible", "not_computed", "running", "failed", "unavailable"]
    message: str | None = None
    pricing: RunPrices | None = None


class Evidence(BaseModel):
    term: str
    value: str
    grade: str
    source: str | None
    note: str


class CalendarPrices(BaseModel):
    mass_kg: float
    delivery: Delivery
    tariff_usd_per_kg: float
    dates: list[CalendarDate]
    evidence: list[Evidence]


class _RunMeta(BaseModel):
    config: SearchConfig


@lru_cache(maxsize=2)
def _open_dem(data_dir: Path) -> PolarDem:
    img, lbl = DEM_SOURCES["80s_80m"]
    return PolarDem.from_files(data_dir / "dem" / img.filename, data_dir / "dem" / lbl.filename)


def get_pricing_dem(settings: SettingsDep) -> PolarDem | None:
    try:
        return _open_dem(settings.data_dir)
    except FileNotFoundError:
        return None  # Do not cache absence: downloaded terrain should become available immediately.


PricingDemDep = Annotated[PolarDem | None, Depends(get_pricing_dem)]


def price_run(
    run_id: str, data_dir: Path, cargo: Cargo, dem: PolarDem | None, *, include_cells: bool
) -> RunPrices:
    root = data_dir / "candidates" / run_id
    if not root.is_dir():
        raise HTTPException(status_code=404, detail="search run not found")
    try:
        mission = MissionRequest.model_validate_json((root / "mission.json").read_text())
        config = _RunMeta.model_validate_json((root / "candidates.json").read_text()).config
        if config.grid_spacing_m != 500 or run_id.startswith("dev-"):
            raise HTTPException(
                status_code=409,
                detail="500m precision search required; development runs cannot be averaged",
            )
        if (
            config.window.start.date() != mission.landing_date
            or (config.window.end - config.window.start).total_seconds()
            != mission.mission_duration_days * 86400
        ):
            raise ValueError("search window does not match mission")
        with np.load(root / "sites.npz", allow_pickle=False) as archive:
            arrays = {
                name: cast(NDArray[np.float64], archive[name])
                for name in (
                    "x_m",
                    "y_m",
                    "ix",
                    "iy",
                    "spacing_m",
                    "stage",
                    "status",
                    "skipped_mask",
                )
            }
    except (OSError, ValueError, KeyError) as error:
        raise HTTPException(
            status_code=409, detail="complete mission search artifacts required"
        ) from error
    if any(arr.ndim != 1 or arr.shape != arrays["x_m"].shape for arr in arrays.values()):
        raise HTTPException(status_code=409, detail="invalid search sample arrays")
    fine = (arrays["stage"] == 1) & (arrays["spacing_m"] == 500)
    eligible = fine & (arrays["status"] == 0) & (arrays["skipped_mask"] == 0)
    counts = Counts(
        fine=int(fine.sum()),
        eligible=int(eligible.sum()),
        coarse_ignored=int((~fine).sum()),
        unevaluated=int((fine & ((arrays["status"] == 2) | (arrays["skipped_mask"] != 0))).sum()),
    )
    cells: list[GridPrice] = []
    prices: list[Price] = []
    for index in np.flatnonzero(eligible):
        x, y = float(arrays["x_m"][index]), float(arrays["y_m"][index])
        if not math.isfinite(x) or not math.isfinite(y):
            raise HTTPException(status_code=409, detail="non-finite sample coordinate")
        terrain = terrain_at(dem, x, y) if dem is not None else Terrain(None, None)
        price = quote(
            mass_kg=cargo.mass_kg,
            delivery=cargo.delivery,
            landable_fraction=terrain.landable_fraction,
        )
        reason = "landable_fraction_below_0.05" if price is None else None
        if terrain.aim_slope_deg is not None and terrain.aim_slope_deg > 10:
            price, reason = None, "aim_point_slope_above_10_deg"
        if price is None:
            counts.terrain_excluded += 1
        else:
            prices.append(price)
            counts.terrain_unknown += int(
                price.destination_unknown or terrain.aim_slope_deg is None
            )
        if include_cells:
            cells.append(
                GridPrice(
                    id=f"SP500_{int(arrays['ix'][index]):+d}_{int(arrays['iy'][index]):+d}",
                    x_m=x,
                    y_m=y,
                    landable_fraction=terrain.landable_fraction,
                    aim_slope_deg=terrain.aim_slope_deg,
                    price=price,
                    excluded_reason=reason,
                )
            )
    counts.priced = len(prices)
    mean: Price | None = None
    if prices:
        values = {
            name: math.fsum(getattr(p, name) for p in prices) / len(prices)
            for name in (
                "baseline_usd",
                "transport_usd",
                "destination_adjustment_usd",
                "demand_adjustment_usd",
                "adjusted_usd",
                "range_low_usd",
                "range_high_usd",
                "destination_multiplier",
                "demand_multiplier",
            )
        }
        mean = Price.model_validate(
            {**values, "destination_unknown": counts.terrain_unknown > 0, "demand_unknown": True}
        )
    return RunPrices(
        run_id=run_id,
        landing_date=mission.landing_date,
        mission_duration_days=mission.mission_duration_days,
        counts=counts,
        mean=mean,
        cells=cells,
    )


@router.get("/runs/{run_id}")
def get_run_prices(
    run_id: RunId, settings: SettingsDep, dem: PricingDemDep, cargo: Annotated[RunCargo, Query()]
) -> RunPrices:
    return price_run(run_id, settings.data_dir, cargo, dem, include_cells=cargo.include_cells)


@router.post("/calendar")
def get_calendar(
    request: CalendarRequest, settings: SettingsDep, dem: PricingDemDep
) -> CalendarPrices:
    rows: list[CalendarDate] = []
    for landing in request.landing_dates:
        # Revalidate the whole mission, including ephemeris coverage after the date changes.
        mission = MissionRequest.model_validate(
            {**request.mission.model_dump(), "landing_date": landing}
        )
        run_id = mission.run_id()
        root = settings.data_dir / "candidates" / run_id
        status = read_status(root) if root.is_dir() else None
        row = CalendarDate(landing_date=landing, run_id=run_id, state="not_computed")
        if status is not None and status.state in ("queued", "running"):
            row.state, row.message = "running", f"{status.stage}: {status.done}/{status.total}"
        elif status is not None and status.state == "failed":
            row.state, row.message = "failed", status.error
        elif (root / "candidates.json").is_file():
            try:
                row.pricing = price_run(
                    run_id, settings.data_dir, request, dem, include_cells=False
                )
                row.state = "ready" if row.pricing.mean is not None else "no_eligible"
            except HTTPException as error:
                row.state, row.message = "unavailable", str(error.detail)
        rows.append(row)
    return CalendarPrices(
        mass_kg=request.mass_kg,
        delivery=request.delivery,
        tariff_usd_per_kg=TARIFFS[request.delivery],
        dates=rows,
        evidence=[
            Evidence(
                term="c",
                value=str(TARIFFS[request.delivery]),
                grade="published_tariff",
                source=TARIFF_SOURCE,
                note="Astrobotic PUG (2022), USD/kg. 현재 예약 견적은 미확인",
            ),
            Evidence(
                term="F",
                value="500000-5000000 USD",
                grade="modeled",
                source=None,
                note="고정비 근거 없음. 범위는 고정비 F만 변화시킴",
            ),
            Evidence(
                term="r",
                value="R=500m, slope≤10°",
                grade="derived",
                source="NASA LRO LOLA 80m DEM",
                note="주변 DEM 경사의 저경사 면적 비율",
            ),
            Evidence(
                term="F_destination",
                value="1 + 0.30 * (1 - r)",
                grade="modeled",
                source=None,
                note="계수 0.30·반경 500m·경사 한도 10°는 모델값. r 미산정 시 1.10",
            ),
            Evidence(
                term="F_demand",
                value="1.00",
                grade="scenario",
                source=None,
                note="경합도 미산정. 여섯 페르소나 판정 미연결, 실제 예약 수요 아님",
            ),
            Evidence(
                term="P",
                value="F + c * m * F_destination * F_demand",
                grade="modeled",
                source=None,
                note="실제 견적 아님. 비행편·탑재 용량 및 고객 장비 경사 한도 미검증",
            ),
        ],
    )
