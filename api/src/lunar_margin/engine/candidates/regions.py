"""격자 위에서 서로 맞닿은 점들의 연결 영역 라벨링 (scipy 없이)."""

from collections import deque

import numpy as np
from numpy.typing import NDArray

from lunar_margin.engine.candidates.grid import SitePoints


def label_regions(
    sites: SitePoints,
    mask: NDArray[np.bool_],
    *,
    diagonal: bool = True,
) -> NDArray[np.int32]:
    """mask가 True인 점을 연결 영역별로 1, 2, ... 로 번호 매긴다. 0은 영역 없음.

    번호는 점의 저장 순서(격자 행 우선)에서 처음 나타난 순서이므로 항상 같은 결과가 나온다.
    diagonal=True면 8방향, False면 4방향 인접.
    """
    if mask.shape[0] != len(sites):
        raise ValueError("mask length must match the number of sites")
    index_of = {
        (int(i), int(j)): k
        for k, (i, j, keep) in enumerate(zip(sites.ix, sites.iy, mask, strict=True))
        if keep
    }
    steps = [(-1, 0), (1, 0), (0, -1), (0, 1)]
    if diagonal:
        steps += [(-1, -1), (-1, 1), (1, -1), (1, 1)]
    labels = np.zeros(len(sites), dtype=np.int32)
    next_label = 0
    for start in sorted(index_of.values()):
        if labels[start]:
            continue
        next_label += 1
        labels[start] = next_label
        queue = deque([start])
        while queue:
            k = queue.popleft()
            i, j = int(sites.ix[k]), int(sites.iy[k])
            for di, dj in steps:
                neighbour = index_of.get((i + di, j + dj))
                if neighbour is not None and not labels[neighbour]:
                    labels[neighbour] = next_label
                    queue.append(neighbour)
    return labels
