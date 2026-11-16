from datetime import UTC, datetime, timedelta
from pathlib import Path

import numpy as np
import pytest
import spiceypy

from lunar_margin.engine.transfer import calculate_transfer


def test_dated_transfer_reaches_requested_arrival_and_captures(data_dir: Path) -> None:
    departure = datetime(2027, 1, 6, tzinfo=UTC)
    arrival = datetime(2027, 1, 10, tzinfo=UTC)
    result = calculate_transfer(departure, arrival, data_dir)
    assert result.departure == departure
    assert result.arrival == arrival
    assert result.transfer[0].seconds == 0
    assert result.transfer[-1].seconds == pytest.approx(345600, abs=0.001)
    assert result.metrics.arrival_position_error_km < 0.05
    end = result.transfer[-1]
    altitude = np.linalg.norm(np.array(end.spacecraft_km) - end.moon_km) - 1737.4
    assert altitude == pytest.approx(100, abs=0.05)
    assert result.capture[-1].seconds == pytest.approx(396000, abs=0.001)
    assert result.metrics.post_loi_min_altitude_km > 0
    assert result.metrics.tli_delta_v_km_s > 0
    assert result.metrics.loi_delta_v_km_s > 0
    # LOI state is an epoch-tagged Moon-centered state, never reconstructed
    # from the public (position-only) sampled display trajectory.
    handoff = result.loi_handoff
    assert handoff.epoch_utc == arrival
    assert handoff.center == "MOON"
    assert handoff.inertial_frame == "J2000"
    assert handoff.fixed_frame == "MOON_ME"
    before = np.asarray(handoff.pre_loi_j2000_km_kmps)
    after = np.asarray(handoff.post_loi_j2000_km_kmps)
    assert before.shape == after.shape == (6,)
    assert np.array_equal(before[:3], after[:3])
    assert np.linalg.norm(after[:3]) - 1737.4 == pytest.approx(100, abs=0.05)
    assert np.linalg.norm(after[3:] - before[3:]) == pytest.approx(
        result.metrics.loi_delta_v_km_s, abs=1e-10
    )
    # Verify full 6x6 state transform independently against SPICE sxform.
    et = spiceypy.str2et(arrival.strftime("%Y-%m-%dT%H:%M:%S"))
    matrix = spiceypy.sxform("J2000", "MOON_ME", et)
    expected_fixed = matrix @ (after * 1000)
    assert np.asarray(handoff.post_loi_moon_me_m_mps) == pytest.approx(expected_fixed, abs=1e-5)
    assert np.linalg.norm(handoff.post_loi_moon_me_m_mps[:3]) == pytest.approx(
        np.linalg.norm(after[:3]) * 1000, abs=1e-5
    )


def test_equal_flight_times_on_different_dates_have_different_trajectories(data_dir: Path) -> None:
    first = calculate_transfer(
        datetime(2027, 1, 6, tzinfo=UTC), datetime(2027, 1, 10, tzinfo=UTC), data_dir
    )
    second = calculate_transfer(
        datetime(2027, 1, 13, tzinfo=UTC), datetime(2027, 1, 17, tzinfo=UTC), data_dir
    )
    assert first.metrics.travel_time_days == second.metrics.travel_time_days == 4
    assert (
        np.linalg.norm(np.array(first.transfer[-1].moon_km) - second.transfer[-1].moon_km) > 100_000
    )
    assert (
        np.linalg.norm(np.array(first.transfer[0].spacecraft_km) - second.transfer[0].spacecraft_km)
        > 1000
    )
    assert first.metrics.arrival_position_error_km < 0.05
    assert second.metrics.arrival_position_error_km < 0.05


@pytest.mark.parametrize(
    "arrival", [datetime(2027, 1, 6, tzinfo=UTC), datetime(2027, 1, 20, tzinfo=UTC)]
)
def test_rejects_unsupported_intervals_before_computing(arrival: datetime, tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="1 to 10"):
        calculate_transfer(datetime(2027, 1, 6, tzinfo=UTC), arrival, tmp_path)


def test_arrival_moon_position_matches_independent_spice_query(data_dir: Path) -> None:
    departure = datetime(2027, 2, 2, tzinfo=UTC)
    arrival = datetime(2027, 2, 6, tzinfo=UTC)
    result = calculate_transfer(departure, arrival, data_dir)
    state, _ = spiceypy.spkezr(
        "MOON", spiceypy.str2et("2027-02-06T00:00:00"), "J2000", "NONE", "EARTH"
    )
    assert (
        np.linalg.norm(
            np.array(result.transfer[-1].moon_km) - np.asarray(state, dtype=np.float64)[:3]
        )
        < 0.001
    )
    assert result.metrics.arrival_position_error_km < 0.05


@pytest.mark.parametrize("day,flight_days", [(6, 1), (6, 4), (13, 5), (6, 10)])
def test_arrival_approach_is_tangent_to_the_lunar_capture_orbit(
    data_dir: Path, day: int, flight_days: int
) -> None:
    departure = datetime(2027, 1, day, tzinfo=UTC)
    arrival = departure + timedelta(days=flight_days)
    result = calculate_transfer(departure, arrival, data_dir)
    tail = result.transfer[-3:]
    times = np.array([sample.seconds - tail[-1].seconds for sample in tail])
    positions = np.array([np.array(s.spacecraft_km) - s.moon_km for s in tail], dtype=np.float64)
    velocity = np.array([np.polyfit(times, positions[:, axis], 2)[1] for axis in range(3)])
    radial = np.asarray(positions[-1], dtype=np.float64).copy()
    radial /= np.linalg.norm(radial)
    assert abs(float(np.dot(velocity, radial))) < 0.005  # <5 m/s, sampled public trajectory
    assert result.metrics.arrival_altitude_km == pytest.approx(100, abs=0.05)

    head = result.capture[:3]
    capture_times = np.array([sample.seconds - head[0].seconds for sample in head])
    capture_positions = np.array(
        [np.array(s.spacecraft_km) - s.moon_km for s in head], dtype=np.float64
    )
    capture_velocity = np.array(
        [np.polyfit(capture_times, capture_positions[:, axis], 2)[1] for axis in range(3)]
    )
    alignment = np.dot(velocity, capture_velocity) / (
        np.linalg.norm(velocity) * np.linalg.norm(capture_velocity)
    )
    assert alignment > 0.99999
    assert np.array_equal(positions[-1], capture_positions[0])
    # A tangential encounter must be the minimum distance, not an apolune.
    assert np.linalg.norm(positions[-2]) > np.linalg.norm(positions[-1])
    assert np.polyfit(times, np.linalg.norm(positions, axis=1), 2)[0] > 0
    assert result.transfer[-1].seconds == flight_days * 86400
    assert result.arrival == arrival


def test_loi_arrival_at_utc_after_leap_second(data_dir: Path) -> None:
    departure = datetime(2016, 12, 29, tzinfo=UTC)
    arrival = datetime(2017, 1, 2, tzinfo=UTC)
    result = calculate_transfer(departure, arrival, data_dir)
    moon, _ = spiceypy.spkpos(
        "MOON", spiceypy.str2et("2017-01-02T00:00:00"), "J2000", "NONE", "EARTH"
    )
    assert np.linalg.norm(moon - result.transfer[-1].moon_km) < 0.001
    assert result.transfer[-1].seconds == 345601
