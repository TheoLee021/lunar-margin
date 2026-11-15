-- Return one scalar JSON array so PostgREST cannot truncate matching bookings.
CREATE OR REPLACE FUNCTION public.reservation_conflicts_complete(
    p_cell_ids text[], p_starts_at timestamptz, p_ends_at timestamptz
)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
    SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(b) ORDER BY confirmed_at, id), '[]'::jsonb)
    FROM mission_reservations.bookings AS b
    WHERE status = 'confirmed' AND cell_id = ANY(p_cell_ids)
      AND pg_catalog.tstzrange(starts_at, ends_at, '[)')
          && pg_catalog.tstzrange(p_starts_at, p_ends_at, '[)');
$$;
REVOKE EXECUTE ON FUNCTION public.reservation_conflicts_complete(text[],timestamptz,timestamptz) FROM PUBLIC;
DO $$
DECLARE role_name text;
BEGIN
    FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
        IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = role_name) THEN
            EXECUTE pg_catalog.format(
                'REVOKE EXECUTE ON FUNCTION public.reservation_conflicts_complete(text[],timestamptz,timestamptz) FROM %I',
                role_name
            );
        END IF;
    END LOOP;
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'service_role') THEN
        GRANT EXECUTE ON FUNCTION public.reservation_conflicts_complete(text[],timestamptz,timestamptz)
            TO service_role;
    END IF;
END;
$$;
NOTIFY pgrst, 'reload schema';
