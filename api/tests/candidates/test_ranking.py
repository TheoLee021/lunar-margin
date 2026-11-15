import numpy as np
import pytest
from candidate_helpers import make_field

from lunar_margin.engine.candidates.config import Weights
from lunar_margin.engine.candidates.ranking import score_sites

NAN = float("nan")


def test_weighted_average_of_the_two_fractions() -> None:
    field = make_field(sun=[0.8, 0.2], earth=[0.4, 0.6])

    scores = score_sites(field, Weights(sun=0.75, earth=0.25))

    assert scores.total == pytest.approx([0.7, 0.3])
    assert scores.sun_component == pytest.approx([0.8, 0.2])  # 성분 점수는 그대로 보존
    assert scores.earth_component == pytest.approx([0.4, 0.6])


def test_weights_are_normalised_so_only_their_ratio_matters() -> None:
    field = make_field(sun=[0.8], earth=[0.4])

    a = score_sites(field, Weights(sun=1.0, earth=1.0)).total
    b = score_sites(field, Weights(sun=10.0, earth=10.0)).total

    assert a == pytest.approx(b)


def test_missing_component_is_dropped_and_weights_renormalised_not_zeroed() -> None:
    field = make_field(sun=[0.8], earth=[NAN])

    scores = score_sites(field, Weights(sun=0.5, earth=0.5))

    assert scores.total[0] == pytest.approx(0.8)  # 지구를 0으로 취급하면 0.4가 된다
    assert np.isnan(scores.earth_component[0])
    assert scores.components_used[0] == 1


def test_total_is_nan_when_no_component_is_available() -> None:
    scores = score_sites(make_field(sun=[NAN], earth=[NAN]), Weights())

    assert np.isnan(scores.total[0]) and scores.components_used[0] == 0


def test_zero_weight_component_is_ignored_even_if_present() -> None:
    field = make_field(sun=[0.9], earth=[0.1])

    assert score_sites(field, Weights(sun=1.0, earth=0.0)).total[0] == pytest.approx(0.9)
