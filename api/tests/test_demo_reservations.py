"""Public demo policy: any visitor can confirm, view, and cancel without credentials."""

from fastapi.testclient import TestClient
from pydantic import SecretStr
from test_reservations import BOOKING, DSN
from test_reservations import client as client

from lunar_margin.app.main import create_app
from lunar_margin.app.settings import Settings


def test_any_visitor_can_confirm_list_and_cancel_without_a_token(client: TestClient) -> None:
    assert client.get("/reservations").status_code == 200
    first = client.post("/reservations", json=BOOKING)
    assert first.status_code == 201
    booking_id = first.json()["id"]
    another = TestClient(create_app(Settings(reservation_database_url=SecretStr(DSN))))
    assert another.get("/reservations").json()["reservations"][0]["id"] == booking_id
    assert another.post("/reservations", json=BOOKING).status_code == 409
    cancelled = another.post(f"/reservations/{booking_id}/cancel")
    assert cancelled.status_code == 200 and cancelled.json()["status"] == "cancelled"
    assert client.post("/reservations", json=BOOKING).status_code == 201
    schema = client.get("/openapi.json").json()
    assert "security" not in schema["paths"]["/reservations"]["post"]
