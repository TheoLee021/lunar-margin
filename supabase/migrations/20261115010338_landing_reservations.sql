-- Private backend-only schema; no Supabase Data API grants.
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE SCHEMA IF NOT EXISTS mission_reservations;
REVOKE ALL ON SCHEMA mission_reservations FROM PUBLIC;
CREATE TABLE IF NOT EXISTS mission_reservations.bookings (
    id uuid PRIMARY KEY,
    cell_id text NOT NULL,
    cell_ix integer NOT NULL CHECK (cell_ix BETWEEN -610 AND 610),
    cell_iy integer NOT NULL CHECK (cell_iy BETWEEN -610 AND 610),
    company text NOT NULL CHECK (length(btrim(company)) BETWEEN 1 AND 120),
    mission_name text NOT NULL CHECK (length(btrim(mission_name)) BETWEEN 1 AND 120),
    starts_at timestamptz NOT NULL,
    ends_at timestamptz NOT NULL CHECK (ends_at > starts_at),
    confirmed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    status text NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'cancelled')),
    cancelled_at timestamptz,
    CHECK (cell_id = 'SP500v1:' || cell_ix::text || ':' || cell_iy::text),
    CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL)),
    CONSTRAINT no_overlapping_confirmed_bookings EXCLUDE USING gist (
        cell_id WITH =, tstzrange(starts_at, ends_at, '[)') WITH &&
    ) WHERE (status = 'confirmed')
);
ALTER TABLE mission_reservations.bookings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON mission_reservations.bookings FROM PUBLIC;
CREATE INDEX IF NOT EXISTS bookings_confirmed_at_idx
    ON mission_reservations.bookings (confirmed_at DESC, id);
