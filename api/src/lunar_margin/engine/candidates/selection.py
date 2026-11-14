"""공간 다양성을 지키는 결정적 대표 선정.

1) 구역마다 점수가 가장 높은 점을 먼저 하나씩 (구역 최고 점수 순)
2) 남은 자리는 전체 점수 순으로 채운다
두 단계 모두 이미 뽑힌 점과 min_separation_m 이상 떨어진 점만 고른다 (경계 포함).
점수 동률은 (y, x) 좌표로 깨서 입력 순서와 무관하게 같은 결과를 낸다.
"""

from dataclasses import dataclass

import numpy as np
from numpy.typing import NDArray


@dataclass(frozen=True)
class Selection:
    indices: NDArray[np.int64]  # 선정 순서(= 순위)대로의 입력 인덱스
    picked_as: NDArray[np.str_]  # "region_best" | "fill"
    reasons: NDArray[np.str_]  # 입력 길이. 적격하지만 뽑히지 않은 점의 사유, 그 외는 ""


def select_diverse(
    x_m: NDArray[np.float64],
    y_m: NDArray[np.float64],
    score: NDArray[np.float64],
    eligible: NDArray[np.bool_],
    region_id: NDArray[np.int32],
    *,
    min_separation_m: float,
    top_k: int,
) -> Selection:
    n = x_m.shape[0]
    if not (y_m.shape[0] == score.shape[0] == eligible.shape[0] == region_id.shape[0] == n):
        raise ValueError("all input arrays must have the same length")

    candidates = np.flatnonzero(eligible & ~np.isnan(score))
    # 점수 내림차순, 동률은 y, x 오름차순
    order = candidates[np.lexsort((x_m[candidates], y_m[candidates], -score[candidates]))]

    chosen: list[int] = []
    how: list[str] = []
    chosen_xy = np.empty((0, 2), dtype=np.float64)

    def far_enough(k: int) -> bool:
        if chosen_xy.shape[0] == 0:
            return True
        distance = np.hypot(chosen_xy[:, 0] - x_m[k], chosen_xy[:, 1] - y_m[k])
        return bool(np.all(distance >= min_separation_m))

    def take(k: int, label: str) -> None:
        nonlocal chosen_xy
        chosen.append(k)
        how.append(label)
        chosen_xy = np.vstack([chosen_xy, [x_m[k], y_m[k]]])

    # 1단계: 구역마다 최고 점수 점 (구역은 최고 점수 순, 동률이면 구역 번호 순)
    regions: dict[int, list[int]] = {}
    for k in order:
        regions.setdefault(int(region_id[k]), []).append(int(k))
    region_order = sorted(regions, key=lambda r: (-score[regions[r][0]], r))
    for region in region_order:
        if len(chosen) >= top_k:
            break
        for k in regions[region]:
            if far_enough(k):
                take(k, "region_best")
                break

    # 2단계: 남은 자리를 전체 점수 순으로
    taken = set(chosen)
    for k in order:
        if len(chosen) >= top_k:
            break
        if int(k) in taken:
            continue
        if far_enough(int(k)):
            take(int(k), "fill")
            taken.add(int(k))

    # 순위는 점수 순으로 다시 매긴다 (뽑힌 방식은 점마다 유지)
    ranked = sorted(
        range(len(chosen)), key=lambda r: (-score[chosen[r]], y_m[chosen[r]], x_m[chosen[r]])
    )
    reasons = np.full(n, "", dtype="<U24")
    selected_set = set(chosen)
    if chosen:
        for k in order:
            if int(k) in selected_set:
                continue
            distance = np.hypot(chosen_xy[:, 0] - x_m[k], chosen_xy[:, 1] - y_m[k])
            reasons[k] = (
                "within_min_separation" if np.any(distance < min_separation_m) else "beyond_top_k"
            )
    else:
        reasons[order] = "beyond_top_k"
    indices = np.array([chosen[r] for r in ranked], dtype=np.int64)
    picked_as = np.array([how[r] for r in ranked], dtype="<U11")
    return Selection(indices=indices, picked_as=picked_as, reasons=reasons)
