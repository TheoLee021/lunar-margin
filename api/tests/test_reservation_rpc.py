"""Public PostgREST RPC functions against the disposable PostgreSQL database."""

from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import psycopg
from fastapi.testclient import TestClient
from test_reservations import DSN
from test_reservations import client as client


def test_rpc_confirm_cancel_and_adjacent_dates(client: TestClient) -> None:
    with psycopg.connect(DSN, autocommit=True) as connection:
        statement = "SELECT * FROM public.reservation_confirm(1,-2,'RPC','Mission',%s,%s)"
        first = connection.execute(statement, ("2027-01-01Z", "2027-01-15Z")).fetchone()
        assert first is not None
        try:
            connection.execute(statement, ("2027-01-01Z", "2027-01-15Z"))
        except psycopg.errors.ExclusionViolation:
            pass
        else:
            raise AssertionError("RPC accepted overlapping bookings")
        assert connection.execute(statement, ("2027-01-15Z", "2027-01-16Z")).fetchone()
        cancelled = connection.execute("SELECT * FROM public.reservation_cancel(%s)", (first[0],))
        assert cancelled.fetchone() is not None
        assert connection.execute(statement, ("2027-01-01Z", "2027-01-15Z")).fetchone()
        history = connection.execute("SELECT * FROM public.reservation_list(100,0)").fetchall()
        assert len(history) == 3
        assert connection.execute(
            "SELECT count(*) FROM public.reservation_conflicts(ARRAY['SP500v1:1:-2'],%s,%s)",
            ("2027-01-01Z", "2027-01-15Z"),
        ).fetchone() == (1,)


def test_rpc_concurrent_confirmations_have_one_winner(client: TestClient) -> None:
    barrier = Barrier(2)

    def submit(_: int) -> str:
        with psycopg.connect(DSN, autocommit=True) as connection:
            barrier.wait()
            try:
                connection.execute(
                    "SELECT * FROM public.reservation_confirm(3,4,'RPC','Concurrent',%s,%s)",
                    ("2027-01-01Z", "2027-01-15Z"),
                )
                return "confirmed"
            except psycopg.errors.ExclusionViolation:
                return "conflict"

    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(submit, range(2))) == ["confirmed", "conflict"]


def test_rpc_operator_hash_and_default_execution_privileges(client: TestClient) -> None:
    with psycopg.connect(DSN) as connection:
        connection.execute("DELETE FROM mission_reservations.operator_credentials")
        assert connection.execute(
            "SELECT public.reservation_operator_authorized('rpc-test-operator')"
        ).fetchone() == (None,)
        connection.execute("""INSERT INTO mission_reservations.operator_credentials
            (singleton,token_sha256) VALUES
            (true,encode(sha256(convert_to('rpc-test-operator','UTF8')),'hex'))""")
        assert connection.execute(
            "SELECT public.reservation_operator_authorized('rpc-test-operator')"
        ).fetchone() == (True,)
        assert connection.execute(
            "SELECT public.reservation_operator_authorized('wrong')"
        ).fetchone() == (False,)
        privileges = connection.execute("""SELECT p.proname,
                has_function_privilege('pg_monitor',p.oid,'EXECUTE'),p.prosecdef
            FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
            WHERE n.nspname='public' AND p.proname LIKE 'reservation_%'""").fetchall()
        assert len(privileges) == 6
        assert all(
            not public_execution and not definer for _, public_execution, definer in privileges
        )
        connection.rollback()


def test_conflict_payload_stays_complete_when_postgrest_limits_result_rows(
    client: TestClient,
) -> None:
    with psycopg.connect(DSN) as connection:
        connection.execute("""SELECT public.reservation_confirm(ix,0,'RPC','Row limit',
            '2027-01-01T00:00:00Z','2027-01-15T00:00:00Z')
            FROM generate_series(-500,500) AS ix""")
        # PostgREST's result-row cap must not cap the contents of this one JSON value.
        result = connection.execute("""SELECT jsonb_array_length(
            public.reservation_conflicts_complete(
            ARRAY(SELECT 'SP500v1:' || ix::text || ':0' FROM generate_series(-500,500) AS ix),
            '2027-01-01T00:00:00Z','2027-01-15T00:00:00Z')) LIMIT 1""").fetchone()
        assert result == (1001,)
        connection.rollback()
