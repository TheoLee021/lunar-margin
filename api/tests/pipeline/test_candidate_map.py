import base64
import re

import numpy as np
from png_decode import decode_png

from lunar_margin.pipeline.candidate_map import (
    MapCandidate,
    MapCoarse,
    MapData,
    render_layers,
    render_map_html,
)


def small_map(with_candidates: bool = True, with_coarse: bool = False) -> MapData:
    # 격자 500 m: 거친 점(간격 1000 m) 하나와 세밀 점 세 개
    nan = float("nan")
    return MapData(
        title="테스트",
        grid_spacing_m=500.0,
        rho_max_m=2000.0,
        ix=np.array([0, 1, 2, -1, 0], dtype=np.int64),
        iy=np.array([0, 0, 0, 0, 1], dtype=np.int64),
        spacing_m=np.array([500.0, 500.0, 500.0, 500.0, 1000.0]),
        sun_fraction=np.array([0.1, 0.9, nan, 0.5, 0.4]),
        earth_fraction=np.array([0.2, 0.8, 0.6, nan, 0.4]),
        status=np.array([0, 0, 1, 2, 0], dtype=np.int8),  # 적격, 적격, 제외, 판정불가, 적격
        horizon_complete=np.array([True, True, False, True, True]),
        stage=np.array([1, 1, 1, 1, 0], dtype=np.int8),  # 마지막만 세밀화되지 않은 거친 점
        region_id=np.array([1, 1, 0, 0, 2], dtype=np.int32),
        coarse=MapCoarse(
            ix=np.array([0, 1], dtype=np.int64),
            iy=np.array([0, 0], dtype=np.int64),
            spacing_m=1000.0,
            sun_fraction=np.array([0.3, nan]),
            earth_fraction=np.array([0.7, 0.2]),
            promoted=np.array([True, False]),
        )
        if with_coarse
        else None,
        candidates=[MapCandidate(1, "SP500_+1_+0", 500.0, 0.0, -89.99, 90.0, 0.9, 0.8, 0.85, 3)]
        if with_candidates
        else [],
        stats={"샘플": 5, "적격": 3},
    )


def test_each_layer_is_a_square_png_with_the_roi_diameter() -> None:
    layers = render_layers(small_map())

    # rho_max 2000 m / 500 m = 4칸 -> 반경 5칸(여유 1) -> 한 변 11픽셀
    assert set(layers) == {"sun", "earth", "eligibility", "quality", "stage", "regions"}
    for rgba in layers.values():
        assert rgba.shape == (11, 11, 4)


def test_missing_values_are_transparent_not_zero_coloured() -> None:
    layers = render_layers(small_map())
    n = 5
    sun = layers["sun"]

    assert sun[n - 0, n + 2, 3] == 0  # (2, 0)의 일조율은 결측 -> 투명
    assert sun[n - 0, n + 1, 3] == 255  # (1, 0)은 0.9 -> 불투명
    assert not np.array_equal(sun[n, n + 1, :3], sun[n, n, :3])  # 0.9와 0.1은 색이 다르다


def test_eligibility_layer_distinguishes_the_three_states() -> None:
    layer = render_layers(small_map())["eligibility"]
    n = 5

    eligible, excluded, unevaluated = layer[n, n + 1], layer[n, n + 2], layer[n, n - 1]

    assert len({tuple(eligible[:3]), tuple(excluded[:3]), tuple(unevaluated[:3])}) == 3
    assert all(px[3] == 255 for px in (eligible, excluded, unevaluated))


def test_coarse_cells_are_painted_as_blocks_and_fine_cells_win_overlaps() -> None:
    layer = render_layers(small_map())["sun"]
    n = 5

    # 거친 점 (0, 1)은 간격 1000 m = 2칸 블록. 중심 행은 n - 2
    assert layer[n - 2, n, 3] == 255 and layer[n - 3, n, 3] == 255


def test_quality_layer_marks_only_incomplete_horizons() -> None:
    layer = render_layers(small_map())["quality"]
    n = 5

    assert layer[n, n + 2, 3] > 0  # (2, 0)만 horizon_complete=False
    assert layer[n, n + 1, 3] == 0


def test_html_is_self_contained_and_lists_candidates() -> None:
    html_text = render_map_html(small_map())

    assert "http://" not in html_text and "https://" not in html_text
    assert html_text.count("<img ") == 4
    assert len(re.findall(r'<circle class="candidate"', html_text)) == 1
    assert "SP500_+1_+0" in html_text and "테스트" in html_text
    first = re.search(r'src="data:image/png;base64,([A-Za-z0-9+/=]+)"', html_text)
    assert first is not None
    width, height, _ = decode_png(base64.b64decode(first.group(1)))
    assert (width, height) == (11, 11)


def test_html_without_candidates_still_renders() -> None:
    html_text = render_map_html(small_map(with_candidates=False))

    assert '<circle class="candidate"' not in html_text
    assert "선정된 후보가 없습니다" in html_text


def test_coarse_layers_exist_only_for_two_stage_runs() -> None:
    two_stage = render_layers(small_map(with_coarse=True))

    assert {"coarse_sun", "coarse_earth", "coarse_promoted"} <= set(two_stage)
    assert not {"coarse_sun", "coarse_earth", "coarse_promoted"} & set(render_layers(small_map()))


def test_coarse_layers_show_the_stage_one_values_and_the_promoted_cells() -> None:
    layers = render_layers(small_map(with_coarse=True))
    n = 5

    # 거친 점 (0,0): 일조 0.3, 지구 0.7 / (1,0): 일조 결측(투명), 지구 0.2. 간격 1000 m = 2칸 블록
    assert layers["coarse_sun"][n, n, 3] == 255 and layers["coarse_sun"][n, n + 2, 3] == 0
    assert layers["coarse_earth"][n, n + 2, 3] == 255
    assert layers["coarse_promoted"][n, n, 3] == 255  # 세밀화로 고른 거친 점
    assert layers["coarse_promoted"][n, n + 2, 3] == 0  # 고르지 않은 점은 투명


def test_stage_layer_separates_refined_cells_from_coarse_only_cells() -> None:
    layer = render_layers(small_map())["stage"]
    n = 5

    refined, coarse_only = layer[n, n + 1], layer[n - 2, n]  # (1,0) 세밀 / (0,1) 거친 블록
    assert refined[3] == 255 and coarse_only[3] == 255
    assert tuple(refined[:3]) != tuple(coarse_only[:3])


def test_region_layer_colours_each_region_differently_and_leaves_no_region_transparent() -> None:
    layer = render_layers(small_map())["regions"]
    n = 5

    region1_a, region1_b = layer[n, n], layer[n, n + 1]  # 둘 다 영역 1
    region2 = layer[n - 2, n]  # 영역 2 (거친 점 블록)
    no_region = layer[n, n + 2]  # 영역 0

    assert tuple(region1_a) == tuple(region1_b)
    assert tuple(region1_a[:3]) != tuple(region2[:3])
    assert no_region[3] == 0
