"""남극 착륙 후보지 탐색: 거친 격자 -> 유망 영역 세밀화 -> 필터 -> 영역 -> 점수 -> 대표 선정.

실행: uv run python -m lunar_margin.pipeline.candidates [--run-id default] [--config cfg.json]
"""

import argparse
import csv
import json
import math
import os
import re
import time
from collections import Counter
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import cast

import numpy as np
from numpy.typing import NDArray
from pydantic import TypeAdapter

from lunar_margin.app.settings import Settings
from lunar_margin.engine.candidates.config import SearchConfig, Thresholds
from lunar_margin.engine.candidates.field import FieldSettings, MetricField, compute_field, open_dem
from lunar_margin.engine.candidates.filtering import (
    FilterResult,
    Status,
    constraint_ratio,
    evaluate,
    reason_names,
)
from lunar_margin.engine.candidates.grid import SitePoints, polar_grid, refine_points
from lunar_margin.engine.candidates.horizon_table import find_table
from lunar_margin.engine.candidates.mission import MissionRequest, plan_search
from lunar_margin.engine.candidates.projection import polar_radius_m
from lunar_margin.engine.candidates.ranking import RankScores, score_sites
from lunar_margin.engine.candidates.regions import label_regions
from lunar_margin.engine.candidates.selection import select_diverse
from lunar_margin.engine.ephemeris import load_kernels
from lunar_margin.pipeline.candidate_map import (
    MapCandidate,
    MapCoarse,
    MapData,
    render_layers,
    render_map_html,
)
from lunar_margin.pipeline.candidate_schema import (
    CandidateRecord,
    CandidatesDocument,
    DataQuality,
    DemSource,
    EarthMetrics,
    Eligibility,
    KernelSource,
    MapMeta,
    RunInfo,
    Score,
    Selection,
    Source,
    Summary,
    SummaryFile,
    SunMetrics,
    TerrainMetrics,
    WindowSource,
)
from lunar_margin.pipeline.candidate_status import RunStatus, StatusKeeper
from lunar_margin.pipeline.candidates_export import simple_json
from lunar_margin.pipeline.horizons import TABLES_DIR, resolve_dems, table_spec_for
from lunar_margin.pipeline.png import encode_png
from lunar_margin.pipeline.sources import SPICE_SOURCES

_REASON_KEYS = (
    "sun_fraction_below_min",
    "sun_dark_hours_above_max",
    "earth_fraction_below_min",
    "earth_blackout_hours_above_max",
    "horizon_incomplete",
    "terrain_slope_above_max",
    "terrain_incomplete",
    "no_metrics",
    "not_refined",
    "within_min_separation",
    "beyond_top_k",
)
_LAYER_ORDER = (
    "coarse_sun",
    "coarse_earth",
    "coarse_promoted",
    "sun",
    "earth",
    "stage",
    "eligibility",
    "regions",
    "quality",
)
_MANIFEST = TypeAdapter(dict[str, dict[str, str | int]])
STAGE_COARSE_ONLY = 0
STAGE_FINE = 1
_STATUS_NAMES = {int(Status.ELIGIBLE): "eligible", int(Status.EXCLUDED): "excluded",
                 int(Status.UNEVALUATED): "unevaluated"}  # fmt: skip
_PROJECTION = (
    "polar stereographic, scale 1 at the south pole, sphere R=1737.4 km, "
    "x=rho*sin(lon), y=rho*cos(lon) (lon 0 = +y, east = +x), meters"
)


@dataclass(frozen=True)
class SearchOutcome:
    config: SearchConfig
    ix: NDArray[np.int64]
    iy: NDArray[np.int64]
    x_m: NDArray[np.float64]
    y_m: NDArray[np.float64]
    lat_deg: NDArray[np.float64]
    lon_deg: NDArray[np.float64]
    spacing_m: NDArray[np.float64]
    stage: NDArray[np.int8]
    field: MetricField
    filtered: FilterResult
    scores: RankScores
    region_id: NDArray[np.int32]
    rank: NDArray[np.int32]  # 0이면 선정되지 않음
    picked_as: NDArray[np.str_]
    note: NDArray[np.str_]  # 선정되지 않은 이유 (선정된 점은 "")
    source: Source
    summary: Summary
    run: RunInfo
    coarse: MapCoarse | None  # 거친 단계(1단계) 결과. 한 단계 실행이면 None


def _json_float(value: float) -> float | None:
    return None if math.isnan(value) else round(float(value), 6)


def _fallback_resolution(dem: object) -> float:
    fallback = getattr(dem, "fallback", None)
    return float(fallback.label.map_scale_m) if fallback is not None else 0.0


def _hashes(directory: Path, names: list[str]) -> dict[str, str]:
    manifest = directory / "manifest.json"
    entries = _MANIFEST.validate_json(manifest.read_text()) if manifest.exists() else {}
    return {name: str(entries.get(name, {}).get("sha256", "")) for name in names}


def _field_settings(config: SearchConfig, azimuth_step_deg: float) -> FieldSettings:
    return FieldSettings(
        window=config.window,
        azimuth_step_deg=azimuth_step_deg,
        max_range_m=config.max_range_m,
        observer_height_m=config.observer_height_m,
        assess_terrain=config.thresholds.max_terrain_slope_degrees is not None,
    )


def _promotion_mask(
    field: MetricField,
    filtered: FilterResult,
    scores: RankScores,
    thresholds: Thresholds,
    fraction: float,
) -> NDArray[np.bool_]:
    """거친 점 중 세밀하게 다시 볼 점. 거친 격자는 폭이 좁은 좋은 곳을 놓칠 수 있으므로,
    적격한 점뿐 아니라 제약에 가까운 점도 고른다.

    - 적격한 점 중 점수 상위 `fraction`
    - 제약이 있으면, 제약에 가장 가까운 점(constraint_ratio가 낮은 순) 상위 `fraction`
    - 그래도 하나도 없으면 점수 상위 `fraction` (계산된 점 중)
    fraction이 1.0이면 계산된 점을 모두 고른다.
    """
    computed = field.computed
    if fraction >= 1.0:
        return computed.copy()
    promoted = np.zeros(len(field), dtype=np.bool_)
    eligible = (filtered.status == Status.ELIGIBLE) & ~np.isnan(scores.total)
    if eligible.any():
        cutoff = np.quantile(scores.total[eligible], 1.0 - fraction)
        promoted |= eligible & (scores.total >= cutoff)
    ratio = constraint_ratio(field, thresholds)
    finite = computed & np.isfinite(ratio)
    if finite.any():
        cutoff = np.quantile(ratio[finite], fraction)
        promoted |= finite & (ratio <= cutoff)
    if not promoted.any():
        scored = computed & ~np.isnan(scores.total)
        if scored.any():
            cutoff = np.quantile(scores.total[scored], 1.0 - fraction)
            promoted = scored & (scores.total >= cutoff)
    return promoted


def _note(status: int, failed: int, stage: int, selection_reason: str, selected: bool) -> str:
    if selected:
        return ""
    if status == Status.EXCLUDED:
        return ";".join(reason_names(failed))
    if status == Status.UNEVALUATED:
        return "no_metrics"
    if stage == STAGE_COARSE_ONLY:
        return "not_refined"
    return selection_reason


ProgressFn = Callable[[str, int, int], None]  # (단계, 완료한 지점 수, 그 단계의 전체 지점 수)


def run_search(
    config: SearchConfig,
    data_dir: Path,
    *,
    log: Callable[[str], None] = print,
    progress: ProgressFn | None = None,
    extra_warnings: list[str] | None = None,
) -> SearchOutcome:
    started = time.perf_counter()
    selection = resolve_dems(config, data_dir)
    img_source = selection.primary
    dem_pairs = selection.pairs
    fallback_source = selection.fallback
    warnings: list[str] = list(extra_warnings or [])
    table_spec = table_spec_for(config, data_dir)
    table = find_table(data_dir / TABLES_DIR, table_spec)
    if table is None:
        warnings.append(
            "수평선 테이블이 없어 지점마다 수평선을 직접 계산했습니다(느림). "
            "`uv run python -m lunar_margin.pipeline.horizons --download`로 Storage에서 받거나 "
            "`uv run python -m lunar_margin.pipeline.horizons`로 미리 계산해 두면 "
            "같은 조건의 이후 탐색이 훨씬 빨라집니다."
        )
    load_kernels(data_dir / "spice")
    dem = open_dem(dem_pairs)
    workers = config.workers or os.cpu_count() or 1

    def reporter(stage: str) -> Callable[[int, int], None] | None:
        callback = progress
        if callback is None:
            return None
        return lambda done, total: callback(stage, done, total)

    ratio = config.grid_spacing_m / dem.label.map_scale_m
    if ratio > 1.0:
        warnings.append(
            f"격자 간격 {config.grid_spacing_m:g} m는 DEM 해상도 {dem.label.map_scale_m:g} m의 "
            f"{ratio:.2f}배로 더 거칩니다. 수십 m 폭의 좁은 일조 지점은 놓칠 수 있습니다."
        )
    elif ratio < 1.0:
        warnings.append(
            f"격자 간격 {config.grid_spacing_m:g} m는 DEM 해상도 {dem.label.map_scale_m:g} m보다 "
            "촘촘합니다. 이웃 점들의 값은 같은 DEM 픽셀을 보간한 것이라 독립적이지 않습니다."
        )
    years = (config.window.end - config.window.start).days / 365.25
    if years > 1.5:
        warnings.append(
            f"분석 기간이 {years:.0f}년입니다. 평균 지표는 장기 평균이고, 최장 암흑·두절 시간은 "
            "그 기간 중 최악값입니다."
        )

    single_stage = (
        config.coarse_spacing_m is None or config.coarse_spacing_m == config.grid_spacing_m
    )
    coarse: SitePoints | None = None
    coarse_field: MetricField | None = None
    coarse_filter: FilterResult | None = None
    coarse_scores: RankScores | None = None
    promoted = np.zeros(0, dtype=np.bool_)
    coarse_view: MapCoarse | None = None

    if single_stage:
        fine = polar_grid(config.roi, config.grid_spacing_m)
    else:
        assert config.coarse_spacing_m is not None
        coarse = polar_grid(config.roi, config.coarse_spacing_m)
        log(f"[1/2] 거친 격자 {config.coarse_spacing_m:g} m: {len(coarse):,}개 지점 계산")
        coarse_field = compute_field(
            dem,
            coarse,
            _field_settings(config, config.coarse_azimuth_step_deg),
            workers=workers,
            dem_files=dem_pairs,
            on_progress=reporter("coarse"),
            table=table,
        )
        coarse_filter = evaluate(
            coarse_field,
            config.thresholds,
            exclude_incomplete_horizon=config.exclude_incomplete_horizon,
        )
        coarse_scores = score_sites(coarse_field, config.weights)
        promoted = _promotion_mask(
            coarse_field, coarse_filter, coarse_scores, config.thresholds, config.refine_fraction
        )
        fine = refine_points(coarse, promoted, config.roi, config.grid_spacing_m)
        coarse_view = MapCoarse(
            ix=coarse.ix,
            iy=coarse.iy,
            spacing_m=coarse.spacing_m,
            sun_fraction=coarse_field.sun_fraction,
            earth_fraction=coarse_field.earth_fraction,
            promoted=promoted,
        )

    log(f"[2/2] 세밀 격자 {config.grid_spacing_m:g} m: {len(fine):,}개 지점 계산")
    fine_field = compute_field(
        dem,
        fine,
        _field_settings(config, config.fine_azimuth_step_deg),
        workers=workers,
        dem_files=dem_pairs,
        on_progress=reporter("fine"),
        table=table,
    )
    fine_filter = evaluate(
        fine_field, config.thresholds, exclude_incomplete_horizon=config.exclude_incomplete_horizon
    )
    fine_scores = score_sites(fine_field, config.weights)
    eligible_f = (fine_filter.status == Status.ELIGIBLE) & ~np.isnan(fine_scores.total)
    fine_region = label_regions(fine, eligible_f)
    selection = select_diverse(
        fine.x_m,
        fine.y_m,
        fine_scores.total,
        eligible_f,
        fine_region,
        min_separation_m=config.min_separation_m,
        top_k=config.top_k,
    )
    fine_rank = np.zeros(len(fine), dtype=np.int32)
    fine_picked = np.full(len(fine), "", dtype="<U11")
    for position, index in enumerate(selection.indices.tolist(), start=1):
        fine_rank[index] = position
        fine_picked[index] = str(selection.picked_as[position - 1])

    # 표: 세밀 점 + (세밀화되지 않은 거친 점)
    parts_site = [fine]
    parts_field = [fine_field]
    stage_parts = [np.full(len(fine), STAGE_FINE, dtype=np.int8)]
    status_parts = [fine_filter.status]
    failed_parts = [fine_filter.failed]
    skipped_parts = [fine_filter.skipped]
    score_parts = [fine_scores]
    region_parts = [fine_region]
    rank_parts = [fine_rank]
    picked_parts = [fine_picked]
    reason_parts = [selection.reasons]
    if coarse is not None and coarse_field is not None and coarse_filter and coarse_scores:
        keep = ~promoted  # 세밀화된 거친 점은 세밀 결과로 대체된다
        parts_site.append(coarse.subset(keep))
        parts_field.append(coarse_field.subset(keep))
        stage_parts.append(np.full(int(np.count_nonzero(keep)), STAGE_COARSE_ONLY, dtype=np.int8))
        status_parts.append(coarse_filter.status[keep])
        failed_parts.append(coarse_filter.failed[keep])
        skipped_parts.append(coarse_filter.skipped[keep])
        score_parts.append(
            RankScores(
                total=coarse_scores.total[keep],
                sun_component=coarse_scores.sun_component[keep],
                earth_component=coarse_scores.earth_component[keep],
                components_used=coarse_scores.components_used[keep],
            )
        )
        region_parts.append(np.zeros(int(np.count_nonzero(keep)), dtype=np.int32))
        rank_parts.append(np.zeros(int(np.count_nonzero(keep)), dtype=np.int32))
        picked_parts.append(np.full(int(np.count_nonzero(keep)), "", dtype="<U11"))
        reason_parts.append(np.full(int(np.count_nonzero(keep)), "", dtype="<U24"))

    ix = np.concatenate([p.ix for p in parts_site])
    iy = np.concatenate([p.iy for p in parts_site])
    spacing = np.concatenate([np.full(len(p), p.spacing_m) for p in parts_site])
    field = MetricField.concat(parts_field)
    stage: NDArray[np.int8] = np.concatenate(stage_parts)
    status: NDArray[np.int8] = np.concatenate(status_parts)
    failed: NDArray[np.uint8] = np.concatenate(failed_parts)
    skipped: NDArray[np.uint8] = np.concatenate(skipped_parts)
    scores = RankScores(
        total=np.concatenate([s.total for s in score_parts]),
        sun_component=np.concatenate([s.sun_component for s in score_parts]),
        earth_component=np.concatenate([s.earth_component for s in score_parts]),
        components_used=np.concatenate([s.components_used for s in score_parts]),
    )
    rank: NDArray[np.int32] = np.concatenate(rank_parts)
    reasons: NDArray[np.str_] = np.concatenate(reason_parts)
    notes = np.array(
        [
            _note(int(st), int(f), int(sg), str(r), bool(k))
            for st, f, sg, r, k in zip(status, failed, stage, reasons, rank > 0, strict=True)
        ],
        dtype=np.str_,  # 길이를 고정하지 않는다 (이어 붙인 사유가 잘리면 집계가 틀어진다)
    )

    counts: dict[str, int] = {
        "coarse_sampled": 0 if coarse is None else len(coarse),
        "promoted_coarse": int(np.count_nonzero(promoted)),
        "refined": len(fine),
        "coarse_only": int(np.count_nonzero(stage == STAGE_COARSE_ONLY)),
        "sampled_total": int(ix.shape[0]),
        "computed": int(np.count_nonzero(field.computed)),
        "missing_all_metrics": int(np.count_nonzero(~field.computed)),
        "eligible": int(np.count_nonzero(status == Status.ELIGIBLE)),
        "excluded": int(np.count_nonzero(status == Status.EXCLUDED)),
        "unevaluated": int(np.count_nonzero(status == Status.UNEVALUATED)),
        "horizon_incomplete": int(np.count_nonzero(field.computed & ~field.horizon_complete)),
        "regions": int(fine_region.max()) if fine_region.size else 0,
        "in_regions": int(np.count_nonzero(fine_region > 0)),
        "selected": int(np.count_nonzero(rank > 0)),
    }
    if counts["horizon_incomplete"]:
        share = 100.0 * counts["horizon_incomplete"] / max(counts["computed"], 1)
        warnings.append(
            f"{counts['horizon_incomplete']}개 지점({share:.0f}%)의 수평선이 DEM 범위 밖으로 "
            "나갑니다. DEM 밖 지형은 알 수 없어 수평선이 낮게 계산됐을 수 있습니다"
            "(data_quality.horizon_complete=false). 이 지점들은 "
            "탐색 거리 안에 DEM이 없는 방향이 있습니다."
        )
    if config.thresholds.max_terrain_slope_degrees is not None:
        warnings.append(
            "지형 경사는 후보 중심 250 m 원의 DEM 경사 P95로 판정합니다(160 m 기준). "
            "유효 표본이 100%인 지점만 통과합니다. DEM 규모 환경 선별이며 "
            "미세 장애물·발판·지반 안전성은 검증하지 않습니다."
        )
    if counts["missing_all_metrics"]:
        warnings.append(
            f"{counts['missing_all_metrics']}개 지점은 DEM 밖이라 지표를 계산하지 못했습니다."
        )

    distributions: dict[str, dict[str, float]] = {}
    names = ("sun_fraction", "sun_longest_dark_h", "earth_fraction", "earth_longest_blackout_h")
    for name in names:
        values: NDArray[np.float64] = getattr(field, name)[field.computed]
        values = values[~np.isnan(values)]
        if values.size:
            q = np.percentile(values, [0, 10, 25, 50, 75, 90, 100])
            keys = ("min", "p10", "p25", "p50", "p75", "p90", "max")
            distributions[name] = {k: round(float(v), 4) for k, v in zip(keys, q, strict=True)}

    reason_counts: Counter[str] = Counter({name: 0 for name in _REASON_KEYS})
    for note in notes.tolist():
        for part in str(note).split(";"):
            if part:
                reason_counts[part] += 1
    summary = Summary(
        counts=counts,
        reasons=dict(reason_counts),
        distributions=distributions,
        warnings=warnings,
    )
    run = RunInfo(
        generated_at=datetime.now(UTC).isoformat(timespec="seconds"),
        elapsed_seconds=time.perf_counter() - started,
        workers=workers,
    )
    source = Source(
        dem=DemSource(
            name=config.dem,
            file=img_source.filename,
            sha256=_hashes(data_dir / "dem", [img_source.filename])[img_source.filename],
            resolution_m=dem.label.map_scale_m,
        ),
        dem_fallback=None
        if fallback_source is None
        else DemSource(
            name=str(config.fallback_dem),
            file=fallback_source.filename,
            sha256=_hashes(data_dir / "dem", [fallback_source.filename])[fallback_source.filename],
            resolution_m=_fallback_resolution(dem),
        ),
        spice_kernels=[
            KernelSource(
                name=k.filename, sha256=_hashes(data_dir / "spice", [k.filename])[k.filename]
            )
            for k in SPICE_SOURCES
        ],
        window=WindowSource(
            start=config.window.start.isoformat(),
            end=config.window.end.isoformat(),
            step_minutes=config.window.step_minutes,
        ),
        projection=_PROJECTION,
        plan_id=fine.plan_id,
        horizon_table=None if table is None else table.directory.name,
    )
    return SearchOutcome(
        config=config,
        ix=ix,
        iy=iy,
        x_m=np.concatenate([p.x_m for p in parts_site]),
        y_m=np.concatenate([p.y_m for p in parts_site]),
        lat_deg=np.concatenate([p.lat_deg for p in parts_site]),
        lon_deg=np.concatenate([p.lon_deg for p in parts_site]),
        spacing_m=spacing,
        stage=stage,
        field=field,
        filtered=FilterResult(status=status, failed=failed, skipped=skipped),
        scores=scores,
        region_id=np.concatenate(region_parts),
        rank=rank,
        picked_as=np.concatenate(picked_parts),
        note=notes,
        source=source,
        summary=summary,
        run=run,
        coarse=coarse_view,
    )


def _missing_metrics(outcome: SearchOutcome, k: int) -> list[str]:
    f = outcome.field
    names = {
        "sun_fraction": f.sun_fraction,
        "sun_longest_dark_h": f.sun_longest_dark_h,
        "earth_fraction": f.earth_fraction,
        "earth_longest_blackout_h": f.earth_longest_blackout_h,
    }
    return [name for name, arr in names.items() if math.isnan(float(arr[k]))]


def _record(outcome: SearchOutcome, k: int) -> CandidateRecord:
    f, sc = outcome.field, outcome.scores
    spacing = float(outcome.spacing_m[k])
    return CandidateRecord(
        id=f"SP{spacing:g}_{int(outcome.ix[k]):+d}_{int(outcome.iy[k]):+d}",
        rank=int(outcome.rank[k]),
        lat_deg=round(float(outcome.lat_deg[k]), 6),
        lon_deg=round(float(outcome.lon_deg[k]), 6),
        x_m=round(float(outcome.x_m[k]), 3),
        y_m=round(float(outcome.y_m[k]), 3),
        grid_spacing_m=spacing,
        terrain=None
        if outcome.config.thresholds.max_terrain_slope_degrees is None
        else TerrainMetrics(
            slope_p95_deg=_json_float(f.terrain_slope_p95_deg[k]),
            coverage_fraction=_json_float(f.terrain_coverage_fraction[k]),
            dem_pixel_m=outcome.source.dem.resolution_m,
        ),
        sun=SunMetrics(
            fraction=_json_float(f.sun_fraction[k]),
            longest_dark_hours=_json_float(f.sun_longest_dark_h[k]),
            windows_per_24h=_json_float(f.sun_windows_per_24h[k]),
            mean_elevation_deg=_json_float(f.sun_mean_elevation_deg[k]),
        ),
        earth=EarthMetrics(
            fraction=_json_float(f.earth_fraction[k]),
            longest_blackout_hours=_json_float(f.earth_longest_blackout_h[k]),
            windows_per_24h=_json_float(f.earth_windows_per_24h[k]),
            mean_elevation_deg=_json_float(f.earth_mean_elevation_deg[k]),
        ),
        eligibility=Eligibility(
            status="eligible"
            if outcome.filtered.status[k] == Status.ELIGIBLE
            else "excluded"
            if outcome.filtered.status[k] == Status.EXCLUDED
            else "unevaluated",
            failed=reason_names(int(outcome.filtered.failed[k])),
            not_applied=reason_names(int(outcome.filtered.skipped[k])),
        ),
        score=Score(
            total=_json_float(sc.total[k]),
            sun_component=_json_float(sc.sun_component[k]),
            earth_component=_json_float(sc.earth_component[k]),
            components_used=int(sc.components_used[k]),
        ),
        region_id=int(outcome.region_id[k]),
        data_quality=DataQuality(
            horizon_complete=bool(f.horizon_complete[k]),
            horizon_max_deg=_json_float(f.horizon_max_deg[k]),
            missing_metrics=_missing_metrics(outcome, k),
            stage="fine" if outcome.stage[k] == STAGE_FINE else "coarse",
        ),
        selection=Selection(picked_as=str(outcome.picked_as[k]), note=str(outcome.note[k])),
    )


def _flat(record: CandidateRecord) -> dict[str, object]:
    """CSV용으로 한 단계만 펼친다. 목록은 ';'로 이어 붙인다."""
    out: dict[str, object] = {}
    for key, value in record.model_dump().items():
        if isinstance(value, dict):
            for sub_key, sub in cast(dict[str, object], value).items():
                if isinstance(sub, list):
                    out[f"{key}_{sub_key}"] = ";".join(str(v) for v in cast(list[object], sub))
                else:
                    out[f"{key}_{sub_key}"] = sub
        else:
            out[key] = value
    return out


def write_outputs(outcome: SearchOutcome, out_dir: Path) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    order = np.flatnonzero(outcome.rank > 0)
    order = order[np.argsort(outcome.rank[order], kind="stable")]
    records = [_record(outcome, int(k)) for k in order]
    # 실행 시각·소요 시간은 결과를 비결정적으로 만들므로 candidates.json에는 넣지 않는다
    document = CandidatesDocument(
        source=outcome.source,
        config=json.loads(outcome.config.model_dump_json()),
        summary=outcome.summary,
        candidates=records,
    )
    (out_dir / "candidates.json").write_text(
        document.model_dump_json(indent=2) + "\n", encoding="utf-8"
    )
    (out_dir / "candidates_simple.json").write_bytes(simple_json(document))
    summary_file = SummaryFile(**outcome.summary.model_dump(), run=outcome.run)
    (out_dir / "summary.json").write_text(
        summary_file.model_dump_json(indent=2) + "\n", encoding="utf-8"
    )
    with (out_dir / "candidates.csv").open("w", newline="", encoding="utf-8") as handle:
        if records:
            rows = [_flat(r) for r in records]
            writer = csv.DictWriter(handle, fieldnames=list(rows[0]))
            writer.writeheader()
            for row in rows:
                writer.writerow({k: "" if v is None else v for k, v in row.items()})

    np.savez_compressed(
        out_dir / "sites.npz",
        ix=outcome.ix,
        iy=outcome.iy,
        x_m=outcome.x_m,
        y_m=outcome.y_m,
        lat_deg=outcome.lat_deg,
        lon_deg=outcome.lon_deg,
        spacing_m=outcome.spacing_m,
        stage=outcome.stage,
        status=outcome.filtered.status,
        failed_mask=outcome.filtered.failed,
        skipped_mask=outcome.filtered.skipped,
        score=outcome.scores.total,
        region_id=outcome.region_id,
        rank=outcome.rank,
        sun_fraction=outcome.field.sun_fraction,
        sun_longest_dark_h=outcome.field.sun_longest_dark_h,
        earth_fraction=outcome.field.earth_fraction,
        earth_longest_blackout_h=outcome.field.earth_longest_blackout_h,
        horizon_complete=outcome.field.horizon_complete,
        terrain_slope_p95_deg=outcome.field.terrain_slope_p95_deg,
        terrain_coverage_fraction=outcome.field.terrain_coverage_fraction,
    )

    counts = outcome.summary.counts
    stats: dict[str, int | float | str] = {
        "샘플 지점": counts["sampled_total"],
        "세밀화 지점": counts["refined"],
        "적격": counts["eligible"],
        "제외": counts["excluded"],
        "판정 불가": counts["unevaluated"],
        "수평선 불완전": counts["horizon_incomplete"],
        "연결 영역": counts["regions"],
        "선정 후보": counts["selected"],
    }
    candidates = [
        MapCandidate(
            rank=int(outcome.rank[k]),
            id=records[i].id,
            x_m=float(outcome.x_m[k]),
            y_m=float(outcome.y_m[k]),
            lat_deg=float(outcome.lat_deg[k]),
            lon_deg=float(outcome.lon_deg[k]),
            sun_fraction=float(outcome.field.sun_fraction[k]),
            earth_fraction=float(outcome.field.earth_fraction[k]),
            score=float(outcome.scores.total[k]),
            region_id=int(outcome.region_id[k]),
        )
        for i, k in enumerate(order.tolist())
    ]
    config = outcome.config
    data = MapData(
        title="남극 착륙 후보지 탐색",
        grid_spacing_m=config.grid_spacing_m,
        rho_max_m=polar_radius_m(config.roi.max_lat_deg),
        ix=outcome.ix,
        iy=outcome.iy,
        spacing_m=outcome.spacing_m,
        sun_fraction=outcome.field.sun_fraction,
        earth_fraction=outcome.field.earth_fraction,
        status=outcome.filtered.status,
        horizon_complete=outcome.field.horizon_complete,
        stage=outcome.stage,
        region_id=outcome.region_id,
        candidates=candidates,
        stats=stats,
        coarse=outcome.coarse,
    )
    (out_dir / "map.html").write_text(render_map_html(data), encoding="utf-8")

    # 화면(프론트엔드)이 단계별로 재생할 레이어 PNG와 지도 메타데이터
    layers = render_layers(data)
    (out_dir / "layers").mkdir(exist_ok=True)
    for name, rgba in layers.items():
        (out_dir / "layers" / f"{name}.png").write_bytes(encode_png(rgba))
    size = next(iter(layers.values())).shape[0]
    meta = MapMeta(
        size_px=size,
        center_px=size // 2,
        pixel_size_m=data.grid_spacing_m,
        rho_max_m=data.rho_max_m,
        layers=[n for n in _LAYER_ORDER if n in layers],
    )
    (out_dir / "map.json").write_text(meta.model_dump_json(indent=2) + "\n", encoding="utf-8")


def run_mission(
    mission: MissionRequest,
    data_dir: Path,
    run_dir: Path,
    *,
    base: SearchConfig | None = None,
    workers: int | None = None,
    log: Callable[[str], None] = print,
    on_progress: ProgressFn | None = None,
) -> SearchOutcome:
    """사용자 임무 입력으로 탐색을 돌리고 결과·입력·진행 상태를 run_dir에 남긴다."""
    started_clock = time.perf_counter()
    plan = plan_search(mission, base)
    if run_dir.name.startswith("dev-"):
        plan.warnings.append(
            "개발용 빠른 탐색(20 km → 10 km)입니다. "
            "좁은 유망 지점을 놓칠 수 있어 정밀 후보 판정에 사용하지 마세요."
        )
    config = plan.config if workers is None else plan.config.model_copy(update={"workers": workers})
    run_dir.mkdir(parents=True, exist_ok=True)
    (run_dir / "mission.json").write_text(
        mission.model_dump_json(indent=2) + "\n", encoding="utf-8"
    )
    status = RunStatus(
        state="running",
        stage="starting",
        done=0,
        total=0,
        pid=os.getpid(),
        started_at=datetime.now(UTC).isoformat(timespec="seconds"),
    )
    with StatusKeeper(run_dir, status) as keeper:

        def progress(stage: str, done: int, total: int) -> None:
            keeper.update(
                stage=stage,
                done=done,
                total=total,
                elapsed_seconds=time.perf_counter() - started_clock,
            )
            if on_progress is not None:
                on_progress(stage, done, total)

        try:
            outcome = run_search(
                config, data_dir, log=log, progress=progress, extra_warnings=plan.warnings
            )
            keeper.update(stage="writing")
            write_outputs(outcome, run_dir)
        except BaseException as error:
            keeper.update(
                state="failed",
                stage="failed",
                error=str(error),
                completed_at=datetime.now(UTC).isoformat(),
                elapsed_seconds=time.perf_counter() - started_clock,
            )
            raise
        sampled = outcome.summary.counts["sampled_total"]
        keeper.update(
            state="done",
            stage="done",
            done=sampled,
            total=sampled,
            completed_at=datetime.now(UTC).isoformat(),
            elapsed_seconds=time.perf_counter() - started_clock,
        )
    return outcome


def resolve_out_dir(out: Path | None, run_id: str, data_dir: Path) -> Path:
    """--out이 없으면 API가 읽는 DATA_DIR/candidates/{run_id}를 쓴다."""
    if out is not None:
        return out
    if re.fullmatch(r"[A-Za-z0-9_-]{1,64}", run_id) is None:
        raise ValueError("run id must match [A-Za-z0-9_-]{1,64} so the API can serve it")
    return data_dir / "candidates" / run_id


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, help="SearchConfig JSON (생략하면 기본값)")
    parser.add_argument(
        "--mission", type=Path, help="사용자 임무 입력 JSON (착륙 날짜, 임무 기간, 제약 ...)"
    )
    parser.add_argument("--run-id", default="default", help="결과 이름. API의 {run_id}가 된다")
    parser.add_argument(
        "--out", type=Path, help="출력 폴더 (생략하면 DATA_DIR/candidates/{run-id})"
    )
    parser.add_argument("--dem", help="config의 dem을 덮어쓴다 (예: 75s_120m)")
    parser.add_argument("--workers", type=int, help="프로세스 수 (기본: CPU 코어 수)")
    args = parser.parse_args()
    config = (
        SearchConfig.model_validate_json(args.config.read_text()) if args.config else SearchConfig()
    )
    overrides: dict[str, object] = {}
    if args.dem:
        overrides["dem"] = args.dem
    if args.workers:
        overrides["workers"] = args.workers
    if overrides:
        config = config.model_copy(update=overrides)
    data_dir = Settings().data_dir
    if args.mission:
        request = MissionRequest.model_validate_json(args.mission.read_text())
        run_id = request.run_id() if args.run_id == "default" else args.run_id
        out_dir = resolve_out_dir(args.out, run_id, data_dir)
        outcome = run_mission(request, data_dir, out_dir, base=config, workers=args.workers)
    else:
        out_dir = resolve_out_dir(args.out, args.run_id, data_dir)
        outcome = run_search(config, data_dir)
        write_outputs(outcome, out_dir)
    print(f"완료: {outcome.summary.counts}")
    for warning in outcome.summary.warnings:
        print(f"경고: {warning}")
    print(f"출력: {out_dir.resolve()}")


if __name__ == "__main__":
    main()
