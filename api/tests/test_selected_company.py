import pytest

from lunar_margin.engine.launch_schedule import Launch, LaunchSource, Participation
from lunar_margin.engine.provider_pricing import load_catalog
from lunar_margin.engine.selected_company import company_model


@pytest.mark.parametrize(
    ("minimum_kg", "increment_kg", "expected_mass", "assumption"),
    [
        (100.0, None, 100.0, "청구 단위 미확인 · 추가 올림 없음 가정"),
        (None, 10.0, 30.0, "최소 청구량 미확인 · 입력 질량을 하한으로 가정"),
    ],
)
def test_selected_company_preserves_each_published_billing_rule(
    minimum_kg: float | None,
    increment_kg: float | None,
    expected_mass: float,
    assumption: str,
) -> None:
    catalog = load_catalog()
    provider = next(provider for provider in catalog.providers if provider.id == "spacex")
    flight = provider.flights[0]
    assert flight.pricing is not None
    pricing = flight.pricing.model_copy(
        update={"minimum_billable_kg": minimum_kg, "billing_increment_kg": increment_kg}
    )
    updated = provider.model_copy(
        update={"flights": [flight.model_copy(update={"pricing": pricing})]}
    )
    catalog = catalog.model_copy(
        update={
            "providers": [updated if item.id == provider.id else item for item in catalog.providers]
        }
    )
    launch = Launch(
        id="partial-billing",
        provider_id="spacex",
        name="SpaceX flight",
        launch_provider="SpaceX",
        label="January 6",
        sources=[],
    )
    model = company_model(catalog, launch, mass_kg=24, delivery="surface")
    assert model.billable_mass_kg == expected_mass
    assert assumption in model.assumptions


def test_selected_launch_uses_operator_tariff_not_delivery_owner_or_another_company_minimum() -> (
    None
):
    launch = Launch(
        id="demo-griffin",
        provider_id="voyager",
        name="Griffin",
        label="NET January",
        launch_provider="SpaceX",
        sources=[
            LaunchSource(
                name="Spaceflight Now",
                url="https://spaceflightnow.com/launch-schedule/",
                label="NET January",
            )
        ],
        participants=[
            Participation(provider_id="voyager", role="delivery"),
            Participation(provider_id="spacex", role="launch"),
        ],
    )
    model = company_model(load_catalog(), launch, mass_kg=24, delivery="surface")
    assert model.company_id == "spacex"
    assert model.company_name == "SpaceX"
    assert model.tariff_usd_per_kg == 100_000
    assert model.fixed_usd == 500_000
    assert model.tariff_basis == "public_tariff"
    assert model.fixed_usd + model.tariff_usd_per_kg * model.billable_mass_kg == pytest.approx(
        2_900_000
    )
    assert model.assumptions
    ula = launch.model_copy(
        update={
            "id": "ula",
            "provider_id": None,
            "launch_provider": "United Launch Alliance (ULA)",
            "participants": [],
        }
    )
    fallback = company_model(load_catalog(), ula, mass_kg=24, delivery="surface")
    assert fallback.company_id is None
    assert fallback.company_name == "United Launch Alliance (ULA)"
    assert fallback.tariff_basis == "common_model"
    assert fallback.fixed_usd + fallback.tariff_usd_per_kg * fallback.billable_mass_kg == 29_300_000
    # A published surface rate must not become an orbit-delivery rate.
    orbit = company_model(load_catalog(), launch, mass_kg=24, delivery="orbit")
    assert orbit.tariff_basis == "common_model"
    assert orbit.tariff_usd_per_kg == 300_000


def test_scheduled_departure_minima_preserve_every_grid_and_attribute_ties() -> None:
    from datetime import date

    import numpy as np

    from lunar_margin.engine.selected_company import minimum_company_prices, scheduled_models

    source = LaunchSource(
        name="Spaceflight Now", url="https://example.com/launches", label="January 6"
    )
    launches = [
        Launch(
            id="ula",
            provider_id=None,
            name="ULA flight",
            launch_provider="United Launch Alliance (ULA)",
            departure_date=date(2027, 1, 6),
            label="January 6",
            sources=[source],
        ),
        Launch(
            id="spacex",
            provider_id="spacex",
            name="SpaceX flight",
            launch_provider="SpaceX",
            departure_date=date(2027, 1, 6),
            label="January 6",
            sources=[source],
        ),
        Launch(
            id="other-day",
            provider_id="blue_origin",
            name="Another day",
            launch_provider="Blue Origin",
            departure_date=date(2027, 1, 7),
            label="January 7",
            sources=[source],
        ),
        Launch(
            id="undated",
            provider_id="voyager",
            name="Month only",
            launch_provider="Astrobotic",
            label="January 2027",
            sources=[source],
        ),
    ]
    models = scheduled_models(
        load_catalog(), launches, date(2027, 1, 6), mass_kg=24, delivery="surface"
    )
    assert {model.launch_id for model in models} == {"ula", "spacex"}
    prices, winners = minimum_company_prices(models, np.array([1.0, 1.3]))
    assert prices.tolist() == pytest.approx([2_900_000, 3_620_000])
    assert [winner.company_name for winner in winners] == ["SpaceX"]
    # Equal common-reference costs retain both real scheduled carriers, not the first one.
    models = scheduled_models(
        load_catalog(), launches, date(2027, 1, 6), mass_kg=24, delivery="orbit"
    )
    _, tied = minimum_company_prices(models, np.array([1.0, 1.3]))
    assert {winner.company_name for winner in tied} == {"SpaceX", "United Launch Alliance (ULA)"}
    empty = scheduled_models(
        load_catalog(), launches, date(2027, 1, 8), mass_kg=24, delivery="surface"
    )
    assert empty == []
    assert minimum_company_prices(models, np.array([]))[1] == []
