"""Existing HTTP reservation contracts with Supabase as the external storage boundary."""

from collections import deque
from collections.abc import Iterator
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient
from test_candidates_api import served as served

from lunar_margin.app.main import create_app
from lunar_margin.app.settings import Settings

BOOKING = {
    "company": "Lunar A",
    "mission_name": "South pole 1",
    "cell_ix": 1,
    "cell_iy": -2,
    "landing_date": "2027-01-01",
    "mission_duration_days": 14,
}
RECORD = {
    "id": "88a35e36-8e7c-4c52-b277-a15e8c661d32",
    "cell_id": "SP500v1:1:-2",
    "cell_ix": 1,
    "cell_iy": -2,
    "company": "Lunar A",
    "mission_name": "South pole 1",
    "starts_at": "2027-01-01T00:00:00Z",
    "ends_at": "2027-01-15T00:00:00Z",
    "confirmed_at": "2026-11-15T00:00:00Z",
    "status": "confirmed",
    "cancelled_at": None,
}
HEADERS = {"Authorization": "Bearer private-operator"}


class RpcBoundary:
    def __init__(self) -> None:
        self.responses: deque[tuple[int, object]] = deque()
        self.calls: list[tuple[str, object]] = []

    def respond(self, body: object, status: int = 200) -> None:
        self.responses.append((status, body))

    def post(
        self,
        url: str,
        *,
        json: dict[str, object],
        headers: dict[str, str],
        timeout: float,
        follow_redirects: bool,
    ) -> httpx.Response:
        assert timeout <= 10
        assert not follow_redirects
        assert headers["apikey"] == "server-only-key"
        assert headers["Authorization"] == "Bearer server-only-key"
        self.calls.append((url, json))
        status, body = self.responses.popleft()
        return httpx.Response(status, json=body, request=httpx.Request("POST", url))


@pytest.fixture
def rpc(monkeypatch: pytest.MonkeyPatch) -> Iterator[RpcBoundary]:
    boundary = RpcBoundary()
    monkeypatch.setattr("httpx.post", boundary.post)
    yield boundary
    assert not boundary.responses, "Every queued external response must be consumed"


def supabase_client(served: Path, url: str = "https://project.supabase.co/rest/v1/") -> TestClient:
    app = create_app(
        Settings(
            data_dir=served,
            reservation_database_url=None,
            reservation_admin_token=None,
            supabase_url=url,
            supabase_service_role_key="server-only-key",
        )
    )
    return TestClient(app)


@pytest.mark.parametrize(
    "url", ["https://project.supabase.co", "https://project.supabase.co/rest/v1/"]
)
def test_availability_uses_existing_supabase_settings_without_a_database_dsn(
    served: Path, rpc: RpcBoundary, url: str
) -> None:
    rpc.respond([])
    response = supabase_client(served, url).get("/candidates/runs/demo/availability")
    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    assert response.json()["candidates"][0]["status"] == "available"
    assert response.json()["candidates"][0]["available_rank"] == 1
    assert rpc.calls[0][0] == "https://project.supabase.co/rest/v1/rpc/reservation_conflicts"
    assert "server-only-key" not in response.text


def test_operator_is_checked_by_supabase_when_no_railway_token_is_configured(
    served: Path, rpc: RpcBoundary
) -> None:
    client = supabase_client(served)
    assert client.get("/reservations").status_code == 401
    rpc.respond(False)
    assert client.get("/reservations", headers={"Authorization": "Bearer wrong"}).status_code == 401
    rpc.respond(True)
    rpc.respond([])
    response = client.get("/reservations", headers={"Authorization": "Bearer private-operator"})
    assert response.status_code == 200
    assert response.json() == {"reservations": []}
    assert "private-operator" not in response.text


def test_confirm_conflict_cancel_and_history_preserve_the_http_contract(
    served: Path, rpc: RpcBoundary
) -> None:
    client = supabase_client(served)
    rpc.respond(True)
    rpc.respond([RECORD])
    created = client.post("/reservations", json=BOOKING, headers=HEADERS)
    assert created.status_code == 201
    assert created.json() == RECORD
    rpc.respond(True)
    rpc.respond({"code": "23P01", "message": "private SQL and server-only-key"}, 409)
    conflict = client.post("/reservations", json=BOOKING, headers=HEADERS)
    assert conflict.status_code == 409
    assert "server-only-key" not in conflict.text
    cancelled = {**RECORD, "status": "cancelled", "cancelled_at": "2026-11-16T00:00:00Z"}
    rpc.respond(True)
    rpc.respond([cancelled])
    response = client.post(f"/reservations/{RECORD['id']}/cancel", headers=HEADERS)
    assert response.status_code == 200 and response.json() == cancelled
    rpc.respond(True)
    rpc.respond([cancelled])
    assert client.get("/reservations", headers=HEADERS).json() == {"reservations": [cancelled]}
    rpc.respond(True)
    rpc.respond([])
    assert client.post(f"/reservations/{RECORD['id']}/cancel", headers=HEADERS).status_code == 404


@pytest.mark.parametrize("payload", [None, {}, [{"id": "invalid"}]])
def test_malformed_upstream_availability_fails_closed(
    served: Path, rpc: RpcBoundary, payload: object
) -> None:
    rpc.respond(payload)
    response = supabase_client(served).get("/candidates/runs/demo/availability")
    assert response.status_code == 503
    assert "server-only-key" not in response.text


@pytest.mark.parametrize("payload", [None, "true", {"authorized": True}])
def test_missing_or_malformed_operator_verification_never_authorizes(
    served: Path, rpc: RpcBoundary, payload: object
) -> None:
    rpc.respond(payload)
    assert supabase_client(served).get("/reservations", headers=HEADERS).status_code == 503


def test_upstream_failure_is_sanitized(served: Path, rpc: RpcBoundary) -> None:
    rpc.respond({"message": "server-only-key and private SQL"}, 503)
    response = supabase_client(served).get("/candidates/runs/demo/availability")
    assert response.status_code == 503
    assert "server-only-key" not in response.text and "private SQL" not in response.text


def test_redirect_response_cannot_be_interpreted_as_success(served: Path, rpc: RpcBoundary) -> None:
    rpc.respond([], 302)
    assert supabase_client(served).get("/candidates/runs/demo/availability").status_code == 503


@pytest.mark.parametrize(
    "url", ["http://project.supabase.co", "https://project.supabase.co/other", "https://[broken"]
)
def test_invalid_endpoint_fails_closed(served: Path, rpc: RpcBoundary, url: str) -> None:
    assert supabase_client(served, url).get("/candidates/runs/demo/availability").status_code == 503
    assert not rpc.calls
