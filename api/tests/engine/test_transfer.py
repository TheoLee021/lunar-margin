from datetime import UTC, datetime
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
