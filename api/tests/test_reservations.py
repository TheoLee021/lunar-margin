"""HTTP 계약과 실제 PostgreSQL 중복 방지 (전용 *_test DB만 사용)."""

import os
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Barrier
from typing import LiteralString, cast

import psycopg
import pytest
from fastapi.testclient import TestClient
from psycopg.sql import SQL
from pydantic import SecretStr
from test_candidates_api import served as served

from lunar_margin.app.main import create_app
from lunar_margin.app.settings import Settings
from lunar_margin.reservations.models import cell_for_point

DSN = os.environ.get(
    "RESERVATION_TEST_DATABASE_URL",
    "postgresql://lunar_margin:lunar_margin@localhost:55432/lunar_margin_test",
)
BOOKING = {
    "company": "Lunar A",
    "mission_name": "South pole 1",
    "cell_ix": 1,
    "cell_iy": -2,
    "landing_date": "2027-01-01",
    "mission_duration_days": 14,
}


@pytest.fixture
def client() -> TestClient:
    with psycopg.connect(DSN, autocommit=True) as conn:
        assert conn.info.dbname.endswith("_test"), "Only a disposable *_test DB is allowed"
        migrations = (Path(__file__).parents[2] / "supabase/migrations").glob("*.sql")
        for migration in sorted(migrations):
            # Trusted repository migrations, not request/user SQL.
            conn.execute(SQL(cast(LiteralString, migration.read_text())))
        conn.execute("TRUNCATE mission_reservations.bookings")
    return TestClient(
        create_app(
            Settings(
                reservation_database_url=SecretStr(DSN),
            )
        )
    )


def test_confirm_conflict_and_adjacent_period(client: TestClient) -> None:
    first = client.post("/reservations", json=BOOKING)
    assert first.status_code == 201
    record = first.json()
    assert record["cell_id"] == "SP500v1:1:-2"
    assert record["starts_at"] == "2027-01-01T00:00:00Z"
    assert record["ends_at"] == "2027-01-15T00:00:00Z"
    assert record["status"] == "confirmed" and record["confirmed_at"]
    # Earlier landing does not take priority over an existing confirmation.
    conflict = client.post("/reservations", json={**BOOKING, "landing_date": "2026-12-31"})
    assert conflict.status_code == 409
    assert (
        client.post("/reservations", json={**BOOKING, "landing_date": "2027-01-15"}).status_code
        == 201
    )
    assert client.post("/reservations", json={**BOOKING, "cell_ix": 2}).status_code == 201


def test_cancel_releases_cell_and_preserves_history_across_apps(client: TestClient) -> None:
    booking_id = client.post("/reservations", json=BOOKING).json()["id"]
    assert client.post(f"/reservations/{booking_id}/cancel").json()["status"] == "cancelled"
    assert client.post(f"/reservations/{booking_id}/cancel").status_code == 200
    assert client.post("/reservations", json=BOOKING).status_code == 201
    another = TestClient(
        create_app(
            Settings(
                reservation_database_url=SecretStr(DSN),
            )
        )
    )
    rows = another.get("/reservations").json()["reservations"]
    assert len(rows) == 2
    assert {row["status"] for row in rows} == {"confirmed", "cancelled"}


@pytest.mark.parametrize("cell_ix", range(10))
def test_concurrent_confirmations_have_exactly_one_winner(client: TestClient, cell_ix: int) -> None:
    barrier = Barrier(2)

    def submit(_: int) -> int:
        barrier.wait()
        return client.post("/reservations", json={**BOOKING, "cell_ix": cell_ix}).status_code

    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(submit, range(2))) == [201, 409]


def test_demo_does_not_require_or_publish_operator_credentials(client: TestClient) -> None:
    assert client.post("/reservations", json=BOOKING).status_code == 201
    assert client.get("/reservations").status_code == 200
    assert (
        client.get("/reservations", headers={"Authorization": "Bearer obsolete"}).status_code == 200
    )
    assert "HTTPBearer" not in client.get("/openapi.json").text
    assert (
        client.post("/reservations/00000000-0000-0000-0000-000000000000/cancel").status_code == 404
    )


@pytest.mark.parametrize(
    "change",
    [
        {"company": " "},
        {"mission_duration_days": 0},
        {"mission_duration_days": 366},
        {"cell_ix": 100000},
        {"cell_ix": 1.2},
        {"landing_date": "2027-01-01T03:00:00Z"},
        {"confirmed_at": "2020-01-01"},
        {"status": "confirmed"},
    ],
)
def test_invalid_registration_is_rejected(client: TestClient, change: dict[str, object]) -> None:
    assert client.post("/reservations", json={**BOOKING, **change}).status_code == 422


def test_missing_database_fails_closed() -> None:
    app = create_app(Settings(reservation_database_url=None))
    response = TestClient(app).post("/reservations", json=BOOKING)
    assert response.status_code == 503


@pytest.mark.parametrize(
    ("x", "y", "expected"),
    [
        (0, 0, "SP500v1:0:0"),
        (249.999, -250, "SP500v1:0:0"),
        (250, -250.001, "SP500v1:1:-1"),
        (-750, 750, "SP500v1:-1:2"),
    ],
)
def test_grid_identity_has_fixed_centered_half_open_boundaries(
    x: float, y: float, expected: str
) -> None:
    assert cell_for_point(x, y).cell_id == expected


def test_candidate_availability_uses_live_reservations_without_changing_scores(
    client: TestClient, served: Path
) -> None:
    app = create_app(
        Settings(
            data_dir=served,
            reservation_database_url=SecretStr(DSN),
        )
    )
    reader = TestClient(app)
    from lunar_margin.app.analysis import get_settings

    app.dependency_overrides[get_settings] = lambda: app.state.settings
    original = reader.get("/candidates/runs/demo").json()
    first = reader.get("/candidates/runs/demo/availability")
    assert first.status_code == 200
    assert first.headers["cache-control"] == "no-store"
    rows = first.json()["candidates"]
    assert [row["available_rank"] for row in rows] == list(range(1, len(rows) + 1))
    cell = rows[0]
    booking = client.post(
        "/reservations",
        json={**BOOKING, "cell_ix": cell["cell_ix"], "cell_iy": cell["cell_iy"]},
    )
    assert booking.status_code == 201
    reserved = reader.get("/candidates/runs/demo/availability").json()["candidates"]
    assert reserved[0]["status"] == "reserved" and reserved[0]["available_rank"] is None
    assert reserved[0]["conflicts"][0]["company"] == BOOKING["company"]
    assert reserved[1]["available_rank"] == 1
    assert reader.get("/candidates/runs/demo").json() == original
    client.post(f"/reservations/{booking.json()['id']}/cancel")
    assert (
        reader.get("/candidates/runs/demo/availability").json()["candidates"][0]["status"]
        == "available"
    )


def test_availability_does_not_assume_available_when_database_is_missing(served: Path) -> None:
    reader = TestClient(create_app(Settings(data_dir=served, reservation_database_url=None)))
    assert reader.get("/candidates/runs/demo/availability").status_code == 503


def test_database_constraint_rejects_a_writer_bypassing_the_api(client: TestClient) -> None:
    assert client.post("/reservations", json=BOOKING).status_code == 201
    with psycopg.connect(DSN) as conn, pytest.raises(psycopg.errors.ExclusionViolation):
        conn.execute("""INSERT INTO mission_reservations.bookings
            (id, cell_id, cell_ix, cell_iy, company, mission_name, starts_at, ends_at)
            SELECT '00000000-0000-0000-0000-000000000001'::uuid, cell_id, cell_ix, cell_iy,
            'Bypass', 'Direct SQL', starts_at, ends_at FROM mission_reservations.bookings""")


def test_unreachable_database_returns_no_credentials() -> None:
    reader = TestClient(
        create_app(
            Settings(
                reservation_database_url=SecretStr(
                    "postgresql://secret-user:secret-password@127.0.0.1:1/missing"
                ),
            )
        )
    )
    response = reader.post("/reservations", json=BOOKING)
    assert response.status_code == 503
    assert "secret-password" not in response.text and "secret-user" not in response.text


def test_cross_origin_public_post_is_allowed(client: TestClient) -> None:
    response = client.options(
        "/reservations",
        headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type",
        },
    )
    assert response.status_code == 200
    assert "POST" in response.headers["access-control-allow-methods"]


def test_public_demo_still_needs_a_configured_store() -> None:
    reader = TestClient(create_app(Settings(reservation_database_url=None)))
    assert reader.post("/reservations", json=BOOKING).status_code == 503
