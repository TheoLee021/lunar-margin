import pytest

from lunar_margin.engine.launch_schedule import Launch, LaunchSource, Participation
from lunar_margin.engine.provider_pricing import load_catalog
from lunar_margin.engine.selected_company import company_model


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
