-- The service key stays in FastAPI. Neither table is exposed through the Data API.
CREATE TABLE IF NOT EXISTS mission_reservations.operator_credentials (
    singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
    token_sha256 text NOT NULL CHECK (token_sha256 ~ '^[0-9a-f]{64}$')
);
ALTER TABLE mission_reservations.operator_credentials ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON mission_reservations.operator_credentials FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.reservation_operator_authorized(p_token text)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
    SELECT CASE
        WHEN EXISTS (SELECT 1 FROM mission_reservations.operator_credentials)
        THEN EXISTS (
            SELECT 1 FROM mission_reservations.operator_credentials
            WHERE token_sha256 = pg_catalog.encode(
                pg_catalog.sha256(pg_catalog.convert_to(p_token, 'UTF8')), 'hex'
            )
        )
        ELSE NULL
    END;
$$;

CREATE OR REPLACE FUNCTION public.reservation_conflicts(
    p_cell_ids text[], p_starts_at timestamptz, p_ends_at timestamptz
)
RETURNS SETOF mission_reservations.bookings
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
    SELECT * FROM mission_reservations.bookings
    WHERE status = 'confirmed' AND cell_id = ANY(p_cell_ids)
      AND pg_catalog.tstzrange(starts_at, ends_at, '[)')
          && pg_catalog.tstzrange(p_starts_at, p_ends_at, '[)')
    ORDER BY confirmed_at, id;
$$;

CREATE OR REPLACE FUNCTION public.reservation_list(p_limit integer, p_offset integer)
RETURNS SETOF mission_reservations.bookings
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
    SELECT * FROM mission_reservations.bookings
    ORDER BY confirmed_at DESC, id
    LIMIT LEAST(GREATEST(p_limit, 1), 100) OFFSET GREATEST(p_offset, 0);
$$;

CREATE OR REPLACE FUNCTION public.reservation_confirm(
    p_cell_ix integer, p_cell_iy integer, p_company text, p_mission_name text,
    p_starts_at timestamptz, p_ends_at timestamptz
)
RETURNS SETOF mission_reservations.bookings
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' SET lock_timeout = '5s' AS $$
BEGIN
    PERFORM pg_catalog.pg_advisory_xact_lock(500, (p_cell_ix + 610) * 1221 + (p_cell_iy + 610));
    RETURN QUERY INSERT INTO mission_reservations.bookings
        (id, cell_id, cell_ix, cell_iy, company, mission_name, starts_at, ends_at)
    VALUES (
        pg_catalog.gen_random_uuid(), 'SP500v1:' || p_cell_ix::text || ':' || p_cell_iy::text,
        p_cell_ix, p_cell_iy, p_company, p_mission_name, p_starts_at, p_ends_at
    ) RETURNING *;
END;
$$;

CREATE OR REPLACE FUNCTION public.reservation_cancel(p_booking_id uuid)
RETURNS SETOF mission_reservations.bookings
LANGUAGE sql SECURITY INVOKER SET search_path = '' SET lock_timeout = '5s' AS $$
    UPDATE mission_reservations.bookings
    SET status = 'cancelled', cancelled_at = COALESCE(cancelled_at, pg_catalog.clock_timestamp())
    WHERE id = p_booking_id RETURNING *;
$$;

REVOKE EXECUTE ON FUNCTION public.reservation_operator_authorized(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.reservation_conflicts(text[],timestamptz,timestamptz) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.reservation_list(integer,integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.reservation_confirm(integer,integer,text,text,timestamptz,timestamptz)
    FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.reservation_cancel(uuid) FROM PUBLIC;

-- Standalone local Postgres has no Supabase roles. It still uses the same RPC SQL in tests.
DO $$
DECLARE
    signature text;
    role_name text;
BEGIN
    FOREACH signature IN ARRAY ARRAY[
        'public.reservation_operator_authorized(text)',
        'public.reservation_conflicts(text[],timestamptz,timestamptz)',
        'public.reservation_list(integer,integer)',
        'public.reservation_confirm(integer,integer,text,text,timestamptz,timestamptz)',
        'public.reservation_cancel(uuid)'
    ] LOOP
        FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
            IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = role_name) THEN
                EXECUTE pg_catalog.format('REVOKE EXECUTE ON FUNCTION %s FROM %I', signature, role_name);
            END IF;
        END LOOP;
        IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'service_role') THEN
            EXECUTE pg_catalog.format('GRANT EXECUTE ON FUNCTION %s TO service_role', signature);
        END IF;
    END LOOP;
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'service_role') THEN
        GRANT USAGE ON SCHEMA mission_reservations TO service_role;
        GRANT SELECT, INSERT, UPDATE ON mission_reservations.bookings TO service_role;
        GRANT SELECT ON mission_reservations.operator_credentials TO service_role;
    END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';
