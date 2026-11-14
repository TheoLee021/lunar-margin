import json
import math
from datetime import UTC, datetime
from pathlib import Path

import pytest
from pydantic import TypeAdapter

from lunar_margin.engine.candidates.config import (
    AnalysisWindow,
    Roi,
    SearchConfig,
    Thresholds,
)
from lunar_margin.engine.candidates.mission import MissionRequest
from lunar_margin.pipeline.candidate_schema import CandidatesDocument, SummaryFile
from lunar_margin.pipeline.candidates import run_search, write_outputs

SMALL = SearchConfig(
    roi=Roi(min_lat_deg=-90.0, max_lat_deg=-89.95),  # 극에서 약 1.5 km
    grid_spacing_m=500.0,
    coarse_spacing_m=1000.0,
    refine_fraction=0.5,
    min_separation_m=1000.0,
    top_k=4,
    window=AnalysisWindow(
        start=datetime(2027, 1, 1, tzinfo=UTC),
        end=datetime(2027, 3, 1, tzinfo=UTC),
        step_minutes=120,
    ),
)


@pytest.fixture(scope="module")
def ran(data_dir: Path, tmp_path_factory: pytest.TempPathFactory) -> Path:
    out = tmp_path_factory.mktemp("search")
    outcome = run_search(SMALL, data_dir, log=lambda _: None)
    write_outputs(outcome, out)
    return out


def load(out: Path) -> CandidatesDocument:
    return CandidatesDocument.model_validate_json((out / "candidates.json").read_text())


def test_writes_every_output_file(ran: Path) -> None:
    names = {p.name for p in ran.iterdir()}

    assert {"candidates.json", "candidates.csv", "sites.npz", "summary.json", "map.html"} <= names


def test_candidate_records_carry_the_required_fields(ran: Path) -> None:
    candidates = load(ran).candidates
    assert 0 < len(candidates) <= SMALL.top_k
    first = candidates[0]

    assert first.rank == 1
    assert first.eligibility.status == "eligible"
    assert first.sun.fraction is not None and first.earth.fraction is not None
    assert first.sun.longest_dark_hours is not None
    assert first.earth.longest_blackout_hours is not None
    assert first.data_quality.stage == "fine"
    assert -90.0 <= first.lat_deg <= -89.95
    assert 0.0 <= first.lon_deg < 360.0
    assert first.selection.picked_as in {"region_best", "fill"}


def test_ranks_follow_score_and_candidates_are_separated(ran: Path) -> None:
    candidates = load(ran).candidates

    assert [c.rank for c in candidates] == list(range(1, len(candidates) + 1))
    totals = [c.score.total for c in candidates]
    assert all(t is not None for t in totals)
    assert totals == sorted(totals, reverse=True)  # pyright: ignore[reportArgumentType]
    for i, a in enumerate(candidates):
        for b in candidates[i + 1 :]:
            assert math.hypot(a.x_m - b.x_m, a.y_m - b.y_m) >= SMALL.min_separation_m


def test_summary_counts_are_consistent(ran: Path) -> None:
    counts = SummaryFile.model_validate_json((ran / "summary.json").read_text()).counts

    assert counts["sampled_total"] == counts["refined"] + counts["coarse_only"]
    assert (
        counts["eligible"] + counts["excluded"] + counts["unevaluated"] == counts["sampled_total"]
    )
    assert counts["selected"] <= SMALL.top_k
    # 연결 영역에 속한 점은 세밀 점 중 적격한 점뿐이고, 선정된 점은 모두 영역에 속한다
    assert counts["selected"] <= counts["in_regions"] <= counts["refined"]
    assert counts["regions"] >= 1 and counts["in_regions"] >= counts["regions"]
    assert counts["coarse_sampled"] > 0
    assert counts["promoted_coarse"] <= counts["coarse_sampled"]


def test_provenance_records_data_sources_and_parameters(ran: Path) -> None:
    source = load(ran).source

    assert source.dem.file == "ldem_80s_80m_float.img"
    assert len(source.dem.sha256) == 64
    assert any(k.name == "de440s.bsp" for k in source.spice_kernels)
    assert source.window.step_minutes == 120
    assert "polar stereographic" in source.projection


def test_two_runs_give_byte_identical_candidates(data_dir: Path, ran: Path, tmp_path: Path) -> None:
    write_outputs(run_search(SMALL, data_dir, log=lambda _: None), tmp_path)

    assert (tmp_path / "candidates.json").read_bytes() == (ran / "candidates.json").read_bytes()
    assert (tmp_path / "candidates.csv").read_bytes() == (ran / "candidates.csv").read_bytes()


def test_impossible_threshold_yields_no_candidates_but_still_writes_everything(
    data_dir: Path, tmp_path: Path
) -> None:
    strict = SMALL.model_copy(update={"thresholds": Thresholds(min_sun_fraction=1.0)})

    outcome = run_search(strict, data_dir, log=lambda _: None)
    write_outputs(outcome, tmp_path)

    doc = load(tmp_path)
    assert doc.candidates == []
    assert doc.summary.counts["selected"] == 0
    assert "선정된 후보가 없습니다" in (tmp_path / "map.html").read_text()


def test_missing_dem_points_to_the_fetch_command(tmp_path: Path) -> None:
    with pytest.raises(FileNotFoundError, match=r"pipeline\.fetch"):
        run_search(SMALL, tmp_path, log=lambda _: None)


def test_unknown_dem_name_is_rejected(data_dir: Path) -> None:
    with pytest.raises(ValueError, match="unknown DEM"):
        run_search(SMALL.model_copy(update={"dem": "nope"}), data_dir, log=lambda _: None)


def test_writes_stage_layers_and_map_meta_for_the_frontend(ran: Path) -> None:
    from png_decode import decode_png

    from lunar_margin.pipeline.candidate_schema import MapMeta

    meta = MapMeta.model_validate_json((ran / "map.json").read_text())

    assert meta.layers == [
        "coarse_sun", "coarse_earth", "coarse_promoted", "sun", "earth",
        "stage", "eligibility", "regions", "quality",
    ]  # fmt: skip
    assert meta.pixel_size_m == SMALL.grid_spacing_m
    assert meta.center_px == meta.size_px // 2
    for name in meta.layers:
        width, height, _ = decode_png((ran / "layers" / f"{name}.png").read_bytes())
        assert (width, height) == (meta.size_px, meta.size_px), name


def test_every_eligible_site_is_selected_or_has_exactly_one_unselected_reason(ran: Path) -> None:
    summary = SummaryFile.model_validate_json((ran / "summary.json").read_text())
    counts, reasons = summary.counts, summary.reasons

    unselected = reasons["not_refined"] + reasons["within_min_separation"] + reasons["beyond_top_k"]
    assert counts["selected"] + unselected == counts["eligible"]
    for key in ("sun_fraction_below_min", "no_metrics", "horizon_incomplete"):
        assert key in reasons  # 0이어도 키는 항상 있다


def test_single_stage_run_has_no_coarse_layers(data_dir: Path, tmp_path: Path) -> None:
    from lunar_margin.pipeline.candidate_schema import MapMeta

    single = SMALL.model_copy(update={"coarse_spacing_m": None})

    write_outputs(run_search(single, data_dir, log=lambda _: None), tmp_path)

    meta = MapMeta.model_validate_json((tmp_path / "map.json").read_text())
    assert not any(name.startswith("coarse_") for name in meta.layers)
    assert not (tmp_path / "layers" / "coarse_sun.png").exists()
    counts = SummaryFile.model_validate_json((tmp_path / "summary.json").read_text()).counts
    assert counts["coarse_sampled"] == 0 and counts["coarse_only"] == 0


def test_output_dir_defaults_to_the_directory_the_api_serves(tmp_path: Path) -> None:
    from lunar_margin.pipeline.candidates import resolve_out_dir

    assert resolve_out_dir(None, "default", tmp_path) == tmp_path / "candidates" / "default"
    assert resolve_out_dir(tmp_path / "x", "default", tmp_path) == tmp_path / "x"


def test_run_id_must_be_safe_for_the_api(tmp_path: Path) -> None:
    from lunar_margin.pipeline.candidates import resolve_out_dir

    for bad in ("../x", "a b", "", "x" * 65, "a.b"):
        with pytest.raises(ValueError, match="run id"):
            resolve_out_dir(None, bad, tmp_path)


def test_simple_export_lists_lat_lon_e_and_the_headline_metrics(ran: Path) -> None:
    from lunar_margin.pipeline.candidates_export import SimpleCandidate

    simple = TypeAdapter(list[SimpleCandidate]).validate_json(
        (ran / "candidates_simple.json").read_text()
    )
    full = load(ran).candidates

    assert len(simple) == len(full) > 0
    for s, f in zip(simple, full, strict=True):
        assert s.rank == f.rank and s.id == f.id
        assert s.lat == round(f.lat_deg, 3) and s.lon_e == round(f.lon_deg, 3)
        assert 0.0 <= s.lon_e < 360.0
        assert s.sun_fraction == f.sun.fraction
        assert s.earth_longest_blackout_hours == f.earth.longest_blackout_hours
        assert s.score == f.score.total
        assert s.horizon_complete == f.data_quality.horizon_complete


def test_simple_export_keys_match_the_requested_shape(ran: Path) -> None:
    first = json.loads((ran / "candidates_simple.json").read_text())[0]

    assert list(first)[:4] == ["rank", "id", "lat", "lon_e"]
    assert {"sun_fraction", "sun_longest_dark_hours", "earth_fraction",
            "earth_longest_blackout_hours", "score"} <= set(first)  # fmt: skip


def test_export_can_be_rebuilt_from_an_existing_run(ran: Path, tmp_path: Path) -> None:
    import shutil

    from lunar_margin.pipeline.candidates_export import export_simple

    run_copy = tmp_path / "run"
    run_copy.mkdir()
    shutil.copy(ran / "candidates.json", run_copy / "candidates.json")

    out = export_simple(run_copy)

    assert out.name == "candidates_simple.json"
    assert out.read_bytes() == (ran / "candidates_simple.json").read_bytes()


# --- 사용자 임무 입력으로 실행 ---------------------------------------------------------

MISSION_TINY = SMALL.model_copy(update={"top_k": 6})  # 극에서 약 1.5 km만 훑는 작은 ROI


def mission(**overrides: object) -> MissionRequest:
    base: dict[str, object] = {
        "landing_date": "2027-01-01",
        "mission_duration_days": 7,
        "max_continuous_darkness_hours": None,
        "max_communication_blackout_hours": None,
        "max_terrain_slope_degrees": None,
        "search_region": "south",
        "optimization_priority": "balanced",
        "observer_height_m": None,
    }
    return MissionRequest.model_validate({**base, **overrides})


def test_run_mission_records_the_request_status_and_window(data_dir: Path, tmp_path: Path) -> None:
    from lunar_margin.pipeline.candidate_status import read_status
    from lunar_margin.pipeline.candidates import run_mission

    request = mission()
    run_dir = tmp_path / request.run_id()

    run_mission(request, data_dir, run_dir, base=MISSION_TINY, log=lambda _: None)

    status = read_status(run_dir)
    assert status is not None and status.state == "done" and status.stage == "done"
    assert status.done == status.total > 0
    assert json.loads((run_dir / "mission.json").read_text())["mission_duration_days"] == 7
    window = load(run_dir).source.window
    assert window.start.startswith("2027-01-01") and window.end.startswith("2027-01-08")
    assert window.step_minutes == 30


def test_run_mission_reports_progress_through_both_stages(data_dir: Path, tmp_path: Path) -> None:
    from lunar_margin.pipeline.candidates import run_mission

    stages: list[str] = []
    request = mission()

    run_mission(
        request,
        data_dir,
        tmp_path / "run",
        base=MISSION_TINY,
        log=lambda _: None,
        on_progress=lambda stage, done, total: stages.append(stage),
    )

    assert stages[0] == "coarse" and "fine" in stages
    assert stages.index("fine") > stages.index("coarse")


def test_selected_candidates_respect_the_mission_constraints(
    data_dir: Path, tmp_path: Path
) -> None:
    from lunar_margin.pipeline.candidates import run_mission

    # 극점 부근은 일조 한도 24시간을 못 지키는 곳이 많다. 선정된 후보는 모두 지켜야 한다
    request = mission(max_continuous_darkness_hours=200, max_communication_blackout_hours=200)

    run_mission(request, data_dir, tmp_path / "run", base=MISSION_TINY, log=lambda _: None)

    for c in load(tmp_path / "run").candidates:
        assert c.sun.longest_dark_hours is not None and c.sun.longest_dark_hours <= 200
        assert c.earth.longest_blackout_hours is not None
        assert c.earth.longest_blackout_hours <= 200


def test_an_impossible_constraint_excludes_everything_and_says_why(
    data_dir: Path, tmp_path: Path
) -> None:
    from lunar_margin.pipeline.candidates import run_mission

    request = mission(max_continuous_darkness_hours=0)  # 한 번도 어두우면 안 된다

    run_mission(request, data_dir, tmp_path / "run", base=MISSION_TINY, log=lambda _: None)

    summary = SummaryFile.model_validate_json((tmp_path / "run" / "summary.json").read_text())
    assert load(tmp_path / "run").candidates == []
    assert summary.counts["selected"] == 0
    assert summary.reasons["sun_dark_hours_above_max"] > 0


def test_the_slope_warning_reaches_the_summary(data_dir: Path, tmp_path: Path) -> None:
    from lunar_margin.pipeline.candidates import run_mission

    request = mission(max_terrain_slope_degrees=10)

    run_mission(request, data_dir, tmp_path / "run", base=MISSION_TINY, log=lambda _: None)

    warnings = SummaryFile.model_validate_json(
        (tmp_path / "run" / "summary.json").read_text()
    ).warnings
    assert any("max_terrain_slope_degrees" in w for w in warnings)


def test_a_failing_run_is_marked_failed_with_the_reason(tmp_path: Path) -> None:
    from lunar_margin.pipeline.candidate_status import read_status
    from lunar_margin.pipeline.candidates import run_mission

    run_dir = tmp_path / "run"

    with pytest.raises(FileNotFoundError):
        run_mission(mission(), tmp_path / "no-data", run_dir, base=MISSION_TINY, log=lambda _: None)

    status = read_status(run_dir)
    assert status is not None and status.state == "failed"
    assert "pipeline.fetch" in (status.error or "")


def test_every_reason_key_is_a_known_reason_and_none_is_truncated(
    data_dir: Path, tmp_path: Path
) -> None:
    from lunar_margin.pipeline.candidates import _REASON_KEYS  # pyright: ignore[reportPrivateUsage]

    # 두 조건을 모두 위반하는 점은 "a;b" 처럼 사유가 이어 붙는다. 이어 붙인 문자열이 잘리면 안 된다
    both = SMALL.model_copy(
        update={"thresholds": Thresholds(max_sun_dark_hours=0.0, max_earth_blackout_hours=0.0)}
    )

    write_outputs(run_search(both, data_dir, log=lambda _: None), tmp_path)

    reasons = SummaryFile.model_validate_json((tmp_path / "summary.json").read_text()).reasons
    assert set(reasons) <= set(_REASON_KEYS)
    assert reasons["sun_dark_hours_above_max"] > 0
    assert reasons["earth_blackout_hours_above_max"] > 0


def test_sites_near_the_limits_are_refined_even_when_none_is_eligible_at_coarse_scale(
    data_dir: Path, tmp_path: Path
) -> None:
    # 1시간 한도는 거친 점 중 어느 것도 못 지킨다. 그래도 한도에 가까운 점 주변은 세밀하게 다시 본다
    strict = SMALL.model_copy(
        update={"thresholds": Thresholds(max_sun_dark_hours=1.0), "refine_fraction": 0.5}
    )

    write_outputs(run_search(strict, data_dir, log=lambda _: None), tmp_path)

    counts = SummaryFile.model_validate_json((tmp_path / "summary.json").read_text()).counts
    assert counts["promoted_coarse"] > 0 and counts["refined"] > 0


def test_mission_total_timing_includes_output_and_is_saved(data_dir: Path, tmp_path: Path) -> None:
    from lunar_margin.pipeline.candidate_status import read_status
    from lunar_margin.pipeline.candidates import run_mission

    run_mission(mission(), data_dir, tmp_path, base=MISSION_TINY, log=lambda _: None)
    status = read_status(tmp_path)
    assert status is not None
    assert status.completed_at is not None and status.elapsed_seconds is not None
    assert status.elapsed_seconds > 0
    summary = SummaryFile.model_validate_json((tmp_path / "summary.json").read_text())
    assert status.elapsed_seconds >= summary.run.elapsed_seconds
    assert status.started_at is not None and status.completed_at >= status.started_at


def test_failed_mission_also_records_completion_time(tmp_path: Path) -> None:
    from lunar_margin.pipeline.candidate_status import read_status
    from lunar_margin.pipeline.candidates import run_mission

    with pytest.raises(FileNotFoundError):
        run_mission(mission(), tmp_path / "missing", tmp_path / "run", base=MISSION_TINY)
    status = read_status(tmp_path / "run")
    assert status is not None and status.state == "failed"
    assert status.completed_at is not None and status.elapsed_seconds is not None
    assert status.elapsed_seconds > 0


def test_the_fallback_dem_removes_every_incomplete_horizon(data_dir: Path, tmp_path: Path) -> None:
    from lunar_margin.pipeline.fetch import fetch_all

    fetch_all(data_dir, "75s_120m")  # 보충 DEM (이미 있으면 검증만 한다)
    # ROI 바깥 경계(남위 85°) 근처의 가는 띠: 80°S DEM만으로는 일부 방향의 탐색이 DEM 밖으로 나간다
    ring = SMALL.model_copy(
        update={
            "roi": Roi(min_lat_deg=-85.03, max_lat_deg=-85.0),
            "grid_spacing_m": 2000.0,
            "coarse_spacing_m": None,
            "window": AnalysisWindow(
                start=datetime(2027, 1, 1, tzinfo=UTC),
                end=datetime(2027, 1, 3, tzinfo=UTC),
                step_minutes=120,
            ),
        }
    )

    without = run_search(
        ring.model_copy(update={"fallback_dem": None}), data_dir, log=lambda _: None
    )
    with_fallback = run_search(ring, data_dir, log=lambda _: None)

    assert without.summary.counts["horizon_incomplete"] > 0
    assert with_fallback.summary.counts["horizon_incomplete"] == 0
    assert with_fallback.source.dem_fallback is not None
    assert with_fallback.source.dem_fallback.file == "ldem_75s_120m_float.img"
    assert without.source.dem_fallback is None


def test_a_missing_fallback_dem_only_warns(data_dir: Path, tmp_path: Path) -> None:
    import shutil

    shutil.copytree(data_dir / "spice", tmp_path / "spice")
    (tmp_path / "dem").mkdir()
    for name in ("ldem_80s_80m_float.img", "ldem_80s_80m_float.lbl"):
        (tmp_path / "dem" / name).symlink_to((data_dir / "dem" / name).resolve())

    outcome = run_search(SMALL, tmp_path, log=lambda _: None)  # 기본값: 75s_120m 보충, 파일은 없다

    assert outcome.source.dem_fallback is None
    assert any("보충 DEM" in w and "pipeline.fetch" in w for w in outcome.summary.warnings)
