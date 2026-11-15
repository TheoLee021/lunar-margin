from datetime import date
from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient

from lunar_margin.app.analysis import get_settings
from lunar_margin.app.main import create_app
from lunar_margin.app.pricing import get_pricing_dem
from lunar_margin.app.settings import Settings
from lunar_margin.engine.candidates.mission import MissionRequest, plan_search
from lunar_margin.engine.dem import PolarDem
from lunar_margin.engine.provider_pricing import (
    Catalog,
    Destination,
    Flight,
    QuoteContext,
    assess_catalog,
    billable_mass,
    compare_grid,
    load_catalog,
    minimum_grid_prices,
)
from lunar_margin.pipeline.pds_label import PolarGridLabel


def test_public_catalog_never_turns_a_planned_month_into_a_bookable_day() -> None:
    context = QuoteContext(
        departure_date=date(2027, 1, 6),
        landing_date=date(2027, 1, 10),
        mass_kg=24,
        delivery="surface",
    )
    offers = assess_catalog(load_catalog(), context)
    assert [offer.provider_id for offer in offers] == [
        "blue_origin",
        "ispace_us",
        "spacex",
        "lockheed_martin",
        "northrop_grumman",
        "voyager",
    ]
    assert all(offer.minimum_usd is None for offer in offers)
    spacex = next(offer for offer in offers if offer.provider_id == "spacex")
    assert spacex.flights[0].tariff_usd_per_kg == 100_000
    assert "outside_schedule" in spacex.flights[0].issues
    voyager = offers[-1]
    assert "schedule_unknown" in voyager.flights[0].issues
    assert "price_unpublished" in voyager.flights[0].issues


def published_catalog() -> Catalog:
    source = {"title": "Test fixture: published terms", "url": "https://example.com/terms"}
    flight = Flight.model_validate(
        {
            "id": "published-a",
            "name": "Published fixture A",
            "departure": {
                "label": "Jan 6",
                "precision": "day",
                "start": "2027-01-06",
                "end": "2027-01-06",
                "confirmed": True,
            },
            "arrival": {
                "label": "Jan 10",
                "precision": "day",
                "start": "2027-01-10",
                "end": "2027-01-10",
                "confirmed": True,
            },
            "deliveries": ["surface"],
            "maximum_payload_kg": 10,
            "available_payload_kg": 10,
            "destination": {"kind": "global"},
            "pricing": {
                "usd_per_kg": 100,
                "fixed_usd": 0,
                "minimum_billable_kg": 0,
                "billing_increment_kg": 0,
                "source": source,
            },
            "sources": [source],
        }
    )
    providers = load_catalog().providers.copy()
    providers[0] = providers[0].model_copy(update={"flights": [flight]})
    other = flight.model_copy(
        update={
            "id": "published-b",
            "name": "Published fixture B",
            "pricing": flight.pricing.model_copy(update={"usd_per_kg": 10, "fixed_usd": 100})
            if flight.pricing
            else None,
        }
    )
    providers[1] = providers[1].model_copy(update={"flights": [other]})
    return load_catalog().model_copy(update={"providers": providers})


def test_each_grid_chooses_its_minimum_before_averaging_without_top_100_sampling() -> None:
    context = QuoteContext(
        departure_date=date(2027, 1, 6),
        landing_date=date(2027, 1, 10),
        mass_kg=1,
        delivery="surface",
    )
    # A is cheaper on the easy grid, B on the harder grid. min(company averages) is wrong.
    result = minimum_grid_prices(
        published_catalog(),
        context,
        x_m=np.array([0.0, 500.0]),
        y_m=np.zeros(2),
        destination_multipliers=np.array([1.0, 1.3]),
    )
    np.testing.assert_allclose(result, [100, 113])
    assert float(np.mean(result)) == 106.5


def test_calendar_without_published_flights_returns_all_25_slots_without_grid_processing(
    tmp_path: Path,
) -> None:
    app = create_app(Settings())
    app.dependency_overrides[get_settings] = lambda: Settings(data_dir=tmp_path)
    response = TestClient(app).post(
        "/pricing/providers/calendar",
        json={
            "mission": {"landing_date": "2027-01-10", "mission_duration_days": 14},
            "landing_dates": [f"2027-01-{day:02d}" for day in range(8, 13)],
            "departure_dates": [f"2027-01-{day:02d}" for day in range(4, 9)],
            "mass_kg": 24,
            "delivery": "surface",
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert len(data["cells"]) == 25
    assert len(data["dates"]) == 5
    assert all(cell["mean_min_usd"] is None for cell in data["cells"])
    assert all(cell["eligible_grid_count"] is None for cell in data["cells"])
    assert all(
        cell["status"] in ("no_published_quote", "invalid_transit") for cell in data["cells"]
    )
    assert not list(tmp_path.iterdir())  # No search, terrain build, or fake quote artifacts.


def test_published_company_rules_gate_capacity_dates_delivery_and_billing() -> None:
    catalog = published_catalog()
    context = QuoteContext(
        departure_date=date(2027, 1, 6),
        landing_date=date(2027, 1, 10),
        mass_kg=1,
        delivery="surface",
    )
    offers = compare_grid(catalog, context, x_m=0, y_m=0, destination_multiplier=1.3)
    assert offers[0].minimum_usd == 130
    assert offers[1].minimum_usd == 113
    for changes, reason in [
        ({"departure_date": date(2027, 1, 5)}, "outside_schedule"),
        ({"mass_kg": 11.0}, "capacity_exceeded"),
        ({"delivery": "orbit"}, "delivery_unserved"),
    ]:
        invalid = assess_catalog(catalog, context.model_copy(update=changes))
        assert all(offer.minimum_usd is None for offer in invalid)
        assert reason in invalid[0].flights[0].issues
    original = catalog.providers[0].flights[0]
    assert original.pricing is not None
    rounded = original.pricing.model_copy(
        update={"minimum_billable_kg": 3.0, "billing_increment_kg": 2.0}
    )
    providers = catalog.providers.copy()
    providers[0] = providers[0].model_copy(
        update={"flights": [original.model_copy(update={"pricing": rounded})]}
    )
    result = compare_grid(
        catalog.model_copy(update={"providers": providers}),
        context,
        x_m=0,
        y_m=0,
        destination_multiplier=1,
    )
    assert result[0].minimum_usd == 400  # 1kg payload, published minimum 3kg rounds to 4kg.


def test_published_decimal_billing_step_does_not_round_fourteen_units_up_to_fifteen() -> None:
    pricing = published_catalog().providers[0].flights[0].pricing
    assert pricing is not None
    step = pricing.model_copy(update={"minimum_billable_kg": 0.0, "billing_increment_kg": 0.01})
    assert billable_mass(step, 0.14) == 0.14


def test_api_averages_all_original_grids_and_detail_lists_all_six_providers(tmp_path: Path) -> None:
    mission = MissionRequest(landing_date=date(2027, 1, 10), mission_duration_days=14)
    root = tmp_path / "candidates" / mission.run_id()
    root.mkdir(parents=True)
    (root / "mission.json").write_text(mission.model_dump_json())
    (root / "candidates.json").write_text(
        '{"config":' + plan_search(mission).config.model_dump_json() + "}"
    )
    # 110 distinct fine grids, one selected candidate, plus a coarse grid.
    xy = [(x, y) for x in range(-5, 6) for y in range(-5, 5)]
    n = len(xy)
    np.savez(
        root / "sites.npz",
        x_m=[float(x * 500) for x, _ in xy] + [8000.0],
        y_m=[float(y * 500) for _, y in xy] + [8000.0],
        ix=[x for x, _ in xy] + [16],
        iy=[y for _, y in xy] + [16],
        spacing_m=[500.0] * n + [2000.0],
        stage=[1] * n + [0],
        status=[0] * (n + 1),
        skipped_mask=[0] * (n + 1),
        rank=[1] + [0] * n,
    )
    dem = PolarDem(
        np.zeros((111, 111), dtype=np.float32), PolarGridLabel(111, 111, 80, 55, 55, 1737.4, 0, -90)
    )
    app = create_app(Settings())
    app.dependency_overrides[get_settings] = lambda: Settings(data_dir=tmp_path)
    app.dependency_overrides[get_pricing_dem] = lambda: dem
    app.dependency_overrides[load_catalog] = published_catalog
    client = TestClient(app)
    response = client.post(
        "/pricing/providers/calendar",
        json={
            "mission": mission.model_dump(mode="json"),
            "landing_dates": ["2027-01-10"],
            "departure_dates": ["2027-01-06"],
            "mass_kg": 1,
            "delivery": "surface",
        },
    )
    assert response.status_code == 200
    cell = response.json()["cells"][0]
    assert cell["status"] == "quoted"
    assert cell["eligible_grid_count"] == cell["quoted_grid_count"] == 110
    assert cell["mean_min_usd"] == pytest.approx(100)
    detail = client.post(
        "/pricing/providers/compare",
        json={
            "departure_date": "2027-01-06",
            "landing_date": "2027-01-10",
            "mass_kg": 1,
            "delivery": "surface",
            "x_m": 500,
            "y_m": 0,
        },
    )
    assert detail.status_code == 200
    assert len(detail.json()["providers"]) == 6
    assert detail.json()["minimum_usd"] == 100
    estimated = client.post(
        "/pricing/providers/calendar",
        json={
            "mission": mission.model_dump(mode="json"),
            "landing_dates": ["2027-01-10"],
            "departure_dates": ["2027-01-06"],
            "mass_kg": 1,
            "delivery": "surface",
            "estimate": True,
        },
    )
    assert estimated.status_code == 200
    assert estimated.json()["estimate"] is True
    assert estimated.json()["cells"][0]["status"] == "estimated"
    assert estimated.json()["cells"][0]["eligible_grid_count"] == 110
    assert estimated.json()["cells"][0]["mean_min_usd"] == pytest.approx(100)
    # A destination with only one covered grid must not silently shrink the mean's population.
    catalog = published_catalog()
    providers = catalog.providers.copy()
    flight = (
        providers[0]
        .flights[0]
        .model_copy(
            update={
                "destination": Destination(kind="circle", lat_deg=-90, lon_deg=0, radius_m=100),
            }
        )
    )
    providers[0] = providers[0].model_copy(update={"flights": [flight]})
    providers[1] = providers[1].model_copy(update={"flights": []})
    app.dependency_overrides[load_catalog] = lambda: catalog.model_copy(
        update={"providers": providers}
    )
    partial = client.post(
        "/pricing/providers/calendar",
        json={
            "mission": mission.model_dump(mode="json"),
            "landing_dates": ["2027-01-10"],
            "departure_dates": ["2027-01-06"],
            "mass_kg": 1,
            "delivery": "surface",
        },
    ).json()["cells"][0]
    assert partial["status"] == "partial_coverage"
    assert partial["mean_min_usd"] is None
    assert partial["quoted_grid_count"] == 1
    assert partial["eligible_grid_count"] == 110
    legacy_id = "m-saved-search-version"
    root.rename(root.parent / legacy_id)
    reused = client.post(
        "/pricing/providers/calendar",
        json={
            "mission": mission.model_dump(mode="json"),
            "source_run_id": legacy_id,
            "landing_dates": ["2027-01-10"],
            "departure_dates": ["2027-01-06"],
            "mass_kg": 1,
            "delivery": "surface",
        },
    ).json()
    assert reused["dates"][0]["state"] == "completed"
    assert reused["dates"][0]["run_id"] == legacy_id
    changed = client.post(
        "/pricing/providers/calendar",
        json={
            "mission": {**mission.model_dump(mode="json"), "max_continuous_darkness_hours": 99},
            "source_run_id": legacy_id,
            "landing_dates": ["2027-01-10"],
            "departure_dates": ["2027-01-06"],
            "mass_kg": 1,
            "delivery": "surface",
        },
    ).json()
    assert changed["dates"][0]["state"] == "not_computed"
    assert changed["dates"][0]["run_id"] != legacy_id


def test_model_estimate_uses_common_tariff_without_claiming_a_bookable_quote() -> None:
    context = QuoteContext.model_validate(
        {
            "departure_date": "2027-01-06",
            "landing_date": "2027-01-10",
            "mass_kg": 24,
            "delivery": "surface",
            "estimate": True,
        }
    )
    offers = compare_grid(load_catalog(), context, x_m=0, y_m=0, destination_multiplier=1.1)
    assert len(offers) == 6
    voyager = offers[-1]
    assert voyager.minimum_usd is None
    assert voyager.minimum_estimate_usd == pytest.approx(32_180_000)
    assert voyager.flights[0].estimate_basis == "common_model"
    assert "price_unpublished" in voyager.flights[0].issues
    assert offers[2].minimum_estimate_usd is None
    assert offers[3].minimum_estimate_usd == pytest.approx(32_180_000)
    values = minimum_grid_prices(
        load_catalog(),
        context,
        x_m=np.zeros(2),
        y_m=np.zeros(2),
        destination_multipliers=np.array([1.0, 1.1]),
    )
    np.testing.assert_allclose(values, [29_300_000, 32_180_000])


def test_public_tariff_estimate_can_use_user_landing_without_complete_billing_terms() -> None:
    context = QuoteContext.model_validate(
        {
            "departure_date": "2028-01-06",
            "landing_date": "2028-01-10",
            "mass_kg": 24,
            "delivery": "surface",
            "estimate": True,
        }
    )
    offers = compare_grid(load_catalog(), context, x_m=0, y_m=0, destination_multiplier=1.1)
    spacex = offers[2]
    assert spacex.minimum_usd is None
    assert spacex.minimum_estimate_usd == pytest.approx(3_140_000)
    assert spacex.flights[0].estimate_basis == "public_tariff"
    assert spacex.flights[0].estimate_assumptions
