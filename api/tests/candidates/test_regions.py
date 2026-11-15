import numpy as np
import pytest
from numpy.typing import NDArray

from lunar_margin.engine.candidates.grid import SitePoints
from lunar_margin.engine.candidates.regions import label_regions


def sites_from(cells: list[tuple[int, int]], spacing: float = 500.0) -> SitePoints:
    ix = np.array([c[0] for c in cells], dtype=np.int64)
    iy = np.array([c[1] for c in cells], dtype=np.int64)
    zeros = np.zeros(len(cells))
    return SitePoints(
        ix,
        iy,
        (ix * spacing).astype(np.float64),
        (iy * spacing).astype(np.float64),
        zeros,
        zeros,
        spacing,
        "test",
    )


def labels(
    cells: list[tuple[int, int]], mask: list[bool], diagonal: bool = True
) -> NDArray[np.int32]:
    return label_regions(sites_from(cells), np.array(mask, dtype=np.bool_), diagonal=diagonal)


def test_two_separate_blobs_get_two_labels() -> None:
    cells = [(0, 0), (1, 0), (5, 5), (5, 6)]

    result = labels(cells, [True] * 4)

    assert result.tolist() == [1, 1, 2, 2]


def test_diagonal_neighbours_join_under_8_connectivity_but_not_4() -> None:
    cells = [(0, 0), (1, 1)]

    assert labels(cells, [True, True], diagonal=True).tolist() == [1, 1]
    assert labels(cells, [True, True], diagonal=False).tolist() == [1, 2]


def test_masked_out_points_get_label_zero_and_do_not_bridge_regions() -> None:
    cells = [(0, 0), (1, 0), (2, 0)]

    result = labels(cells, [True, False, True])

    assert result.tolist() == [1, 0, 2]


def test_labels_are_numbered_in_row_major_first_appearance_order() -> None:
    cells = [(0, 0), (9, 0), (0, 3)]  # (iy, ix) 순서로 이미 정렬된 입력

    assert labels(cells, [True, True, True]).tolist() == [1, 2, 3]


def test_empty_mask_gives_all_zero() -> None:
    assert labels([(0, 0), (1, 0)], [False, False]).tolist() == [0, 0]


def test_mask_length_must_match() -> None:
    with pytest.raises(ValueError, match="length"):
        label_regions(sites_from([(0, 0)]), np.array([True, False]))
