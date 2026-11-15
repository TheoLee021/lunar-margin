import numpy as np
import pytest

from lunar_margin.engine.candidates.selection import Selection, select_diverse


def pick(
    xs: list[float],
    ys: list[float],
    score: list[float],
    region: list[int],
    *,
    sep: float,
    top_k: int,
    eligible: list[bool] | None = None,
) -> Selection:
    n = len(xs)
    return select_diverse(
        np.array(xs, dtype=np.float64),
        np.array(ys, dtype=np.float64),
        np.array(score, dtype=np.float64),
        np.array(eligible if eligible is not None else [True] * n, dtype=np.bool_),
        np.array(region, dtype=np.int32),
        min_separation_m=sep,
        top_k=top_k,
    )


def test_neighbouring_points_in_the_same_region_are_suppressed() -> None:
    # 0과 1은 500 m, 0과 2는 4 km 떨어짐. 최소 간격 2 km
    result = pick([0, 500, 4000], [0, 0, 0], [0.9, 0.8, 0.5], [1, 1, 1], sep=2000, top_k=10)

    assert result.indices.tolist() == [0, 2]


def test_separation_boundary_is_inclusive() -> None:
    result = pick([0, 2000, 3999.9], [0, 0, 0], [0.9, 0.8, 0.7], [1, 1, 1], sep=2000, top_k=10)

    assert result.indices.tolist() == [0, 1]  # 정확히 2000 m는 허용, 3999.9는 1번과 1999.9 m


def test_each_region_is_represented_before_a_region_gets_a_second_pick() -> None:
    # 구역 1에 높은 점수 점이 두 개(멀리 떨어짐), 구역 2에는 낮은 점수 하나
    result = pick([0, 5000, 20000], [0, 0, 0], [0.95, 0.94, 0.30], [1, 1, 2], sep=2000, top_k=2)

    assert result.indices.tolist() == [0, 2]
    assert result.picked_as.tolist() == ["region_best", "region_best"]


def test_remaining_slots_are_filled_by_score_after_every_region_is_covered() -> None:
    result = pick([0, 5000, 20000], [0, 0, 0], [0.95, 0.94, 0.30], [1, 1, 2], sep=2000, top_k=3)

    # 순위는 점수 순이다 (0.95, 0.94, 0.30). 구역 대표 우선 규칙은 '누가 뽑히는가'만 정한다
    assert result.indices.tolist() == [0, 1, 2]
    assert result.picked_as.tolist() == ["region_best", "fill", "region_best"]


def test_top_k_is_respected_and_fewer_candidates_are_fine() -> None:
    xs = [i * 5000.0 for i in range(6)]

    capped = pick(xs, [0] * 6, [0.6] * 6, [1] * 6, sep=2000, top_k=4)
    short = pick(xs[:2], [0] * 2, [0.6] * 2, [1] * 2, sep=2000, top_k=100)

    assert len(capped.indices) == 4 and len(short.indices) == 2


def test_ineligible_and_nan_score_points_are_never_selected() -> None:
    result = pick(
        [0, 5000, 10000],
        [0, 0, 0],
        [0.9, float("nan"), 0.8],
        [1, 2, 3],
        sep=1000,
        top_k=10,
        eligible=[False, True, True],
    )

    assert result.indices.tolist() == [2]


def test_ties_are_broken_by_coordinates_so_input_order_does_not_matter() -> None:
    xs, ys = [3000.0, 0.0, 6000.0], [0.0, 0.0, 0.0]
    forward = pick(xs, ys, [0.5, 0.5, 0.5], [1, 1, 1], sep=1000, top_k=2)
    backward = pick(xs[::-1], ys[::-1], [0.5] * 3, [1] * 3, sep=1000, top_k=2)

    chosen_forward = sorted(xs[int(i)] for i in forward.indices.tolist())
    chosen_backward = sorted(xs[::-1][int(i)] for i in backward.indices.tolist())
    assert chosen_forward == chosen_backward == [0.0, 3000.0]


def test_unselected_eligible_points_get_an_exclusion_reason() -> None:
    result = pick([0, 500, 4000, 8000], [0] * 4, [0.9, 0.8, 0.7, 0.6], [1] * 4, sep=2000, top_k=2)

    assert result.indices.tolist() == [0, 2]
    assert result.reasons[1] == "within_min_separation"
    assert result.reasons[3] == "beyond_top_k"
    assert result.reasons[0] == "" and result.reasons[2] == ""


def test_zero_separation_allows_adjacent_points() -> None:
    result = pick([0, 1, 2], [0, 0, 0], [0.3, 0.2, 0.1], [1, 1, 1], sep=0, top_k=10)

    assert result.indices.tolist() == [0, 1, 2]


def test_input_arrays_must_have_the_same_length() -> None:
    with pytest.raises(ValueError, match="length"):
        select_diverse(
            np.zeros(2), np.zeros(3), np.zeros(2), np.ones(2, dtype=np.bool_),
            np.zeros(2, dtype=np.int32), min_separation_m=1.0, top_k=1,
        )  # fmt: skip
