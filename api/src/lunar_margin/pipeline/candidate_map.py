"""남극 탐색 결과를 한 장의 자체 완결 HTML 지도로 만든다 (외부 라이브러리·네트워크 불필요).

레이어(PNG)는 격자 한 칸이 한 픽셀이다. 경도 0°가 위쪽, 동쪽(경도 90°)이 오른쪽으로,
LOLA 극 DEM과 같은 방향이다. 거친 단계의 점은 간격만큼의 블록으로, 세밀 점은 그 위에 칠한다.
"""

import base64
import colorsys
import html
import math
from dataclasses import dataclass

import numpy as np
from numpy.typing import NDArray

from lunar_margin.pipeline.png import encode_png

# 일조·지구 가시율 색상 (낮음 -> 높음). 색각 이상에서도 구분되도록 보라 -> 청록 -> 노랑
_STOPS = np.array(
    [
        [68, 1, 84],
        [59, 82, 139],
        [33, 145, 140],
        [94, 201, 98],
        [253, 231, 37],
    ],
    dtype=np.float64,
)
_ELIGIBLE = (46, 204, 113, 255)
_EXCLUDED = (231, 76, 60, 255)
_UNEVALUATED = (127, 140, 141, 255)
_INCOMPLETE = (243, 156, 18, 255)
_PROMOTED = (243, 156, 18, 255)
_REFINED = (26, 188, 156, 255)
_COARSE_ONLY = (90, 110, 130, 255)


@dataclass(frozen=True)
class MapCandidate:
    rank: int
    id: str
    x_m: float
    y_m: float
    lat_deg: float
    lon_deg: float
    sun_fraction: float
    earth_fraction: float
    score: float
    region_id: int


@dataclass(frozen=True)
class MapCoarse:
    """거친 단계(1단계)의 결과. 세밀화된 점도 포함한 모든 거친 점."""

    ix: NDArray[np.int64]
    iy: NDArray[np.int64]
    spacing_m: float
    sun_fraction: NDArray[np.float64]
    earth_fraction: NDArray[np.float64]
    promoted: NDArray[np.bool_]  # 세밀화 대상으로 고른 점


@dataclass(frozen=True)
class MapData:
    title: str
    grid_spacing_m: float  # 가장 세밀한 격자 간격 (한 픽셀의 크기)
    rho_max_m: float  # ROI 바깥 경계까지의 투영 거리
    ix: NDArray[np.int64]
    iy: NDArray[np.int64]
    spacing_m: NDArray[np.float64]  # 점마다의 격자 간격 (거친 점 = 더 큰 값)
    sun_fraction: NDArray[np.float64]
    earth_fraction: NDArray[np.float64]
    status: NDArray[np.int8]  # 0 적격, 1 제외, 2 판정 불가
    horizon_complete: NDArray[np.bool_]
    stage: NDArray[np.int8]  # 1 세밀 점, 0 세밀화되지 않은 거친 점
    region_id: NDArray[np.int32]  # 0 = 영역 없음
    candidates: list[MapCandidate]
    stats: dict[str, int | float | str]
    coarse: MapCoarse | None = None


def _colormap(values: NDArray[np.float64]) -> NDArray[np.uint8]:
    """0~1 값을 RGBA로. 결측(NaN)은 완전 투명 (0으로 칠하지 않는다)."""
    clipped = np.clip(np.nan_to_num(values, nan=0.0), 0.0, 1.0) * (len(_STOPS) - 1)
    lower = np.minimum(clipped.astype(np.int64), len(_STOPS) - 2)
    frac = (clipped - lower)[:, None]
    rgb = _STOPS[lower] * (1.0 - frac) + _STOPS[lower + 1] * frac
    out = np.zeros((values.shape[0], 4), dtype=np.uint8)
    out[:, :3] = np.round(rgb).astype(np.uint8)
    out[:, 3] = np.where(np.isnan(values), 0, 255).astype(np.uint8)
    return out


def _half_size(data: MapData) -> int:
    return math.ceil(data.rho_max_m / data.grid_spacing_m) + 1


def _paint_cells(
    ix: NDArray[np.int64],
    iy: NDArray[np.int64],
    spacing_m: NDArray[np.float64],
    colors: NDArray[np.uint8],
    grid_spacing_m: float,
    size: int,
) -> NDArray[np.uint8]:
    n = size // 2
    image = np.zeros((size, size, 4), dtype=np.uint8)
    blocks = np.maximum(np.round(spacing_m / grid_spacing_m).astype(np.int64), 1)
    # 거친 점을 먼저, 세밀 점을 나중에 칠해서 겹치면 세밀한 값이 남는다
    for b in sorted({int(v) for v in blocks.tolist()}, reverse=True):
        sel = blocks == b
        col = ix[sel] * b + n
        row = n - iy[sel] * b
        for dr in range(-(b // 2), b - b // 2):
            for dc in range(-(b // 2), b - b // 2):
                r, c = row + dr, col + dc
                ok = (r >= 0) & (r < size) & (c >= 0) & (c < size)
                image[r[ok], c[ok]] = colors[sel][ok]
    return image


def _paint(data: MapData, colors: NDArray[np.uint8], size: int) -> NDArray[np.uint8]:
    return _paint_cells(data.ix, data.iy, data.spacing_m, colors, data.grid_spacing_m, size)


def _region_colors(region_id: NDArray[np.int32]) -> NDArray[np.uint8]:
    """영역 번호마다 서로 다른 색 (황금비 색상 간격). 0은 투명."""
    out = np.zeros((region_id.shape[0], 4), dtype=np.uint8)
    palette: dict[int, tuple[int, int, int]] = {}
    for rid in {int(v) for v in region_id.tolist() if v > 0}:
        r, g, b = colorsys.hsv_to_rgb((rid * 0.61803398875) % 1.0, 0.65, 0.95)
        palette[rid] = (round(r * 255), round(g * 255), round(b * 255))
    for rid, rgb in palette.items():
        out[region_id == rid] = (*rgb, 255)
    return out


def render_layers(data: MapData) -> dict[str, NDArray[np.uint8]]:
    size = 2 * _half_size(data) + 1
    n_sites = data.ix.shape[0]

    eligibility = np.zeros((n_sites, 4), dtype=np.uint8)
    eligibility[data.status == 0] = _ELIGIBLE
    eligibility[data.status == 1] = _EXCLUDED
    eligibility[data.status == 2] = _UNEVALUATED

    quality = np.zeros((n_sites, 4), dtype=np.uint8)
    quality[~data.horizon_complete] = _INCOMPLETE

    stage = np.zeros((n_sites, 4), dtype=np.uint8)
    stage[data.stage == 1] = _REFINED
    stage[data.stage == 0] = _COARSE_ONLY

    layers = {
        "sun": _paint(data, _colormap(data.sun_fraction), size),
        "earth": _paint(data, _colormap(data.earth_fraction), size),
        "stage": _paint(data, stage, size),
        "eligibility": _paint(data, eligibility, size),
        "regions": _paint(data, _region_colors(data.region_id), size),
        "quality": _paint(data, quality, size),
    }
    if data.coarse is not None:
        c = data.coarse
        spacing = np.full(c.ix.shape[0], c.spacing_m)
        promoted = np.zeros((c.ix.shape[0], 4), dtype=np.uint8)
        promoted[c.promoted] = _PROMOTED
        layers["coarse_sun"] = _paint_cells(
            c.ix, c.iy, spacing, _colormap(c.sun_fraction), data.grid_spacing_m, size
        )
        layers["coarse_earth"] = _paint_cells(
            c.ix, c.iy, spacing, _colormap(c.earth_fraction), data.grid_spacing_m, size
        )
        layers["coarse_promoted"] = _paint_cells(
            c.ix, c.iy, spacing, promoted, data.grid_spacing_m, size
        )
    return layers


def _data_uri(rgba: NDArray[np.uint8]) -> str:
    return "data:image/png;base64," + base64.b64encode(encode_png(rgba)).decode("ascii")


def _pct(value: float) -> str:
    return "-" if math.isnan(value) else f"{value * 100:.1f}%"


_LAYER_LABELS = {
    "sun": "태양 일조율",
    "earth": "지구 가시율",
    "eligibility": "적격 여부",
}


def render_map_html(data: MapData) -> str:
    layers = render_layers(data)
    n = _half_size(data)
    size = 2 * n + 1
    px = data.grid_spacing_m

    images = "\n".join(
        f'<img class="layer" data-layer="{name}" alt="{html.escape(label)}" '
        f'src="{_data_uri(layers[name])}"{"" if name != "sun" else " data-default"}>'
        for name, label in _LAYER_LABELS.items()
    )
    images += (
        f'\n<img class="layer overlay" data-overlay="quality" alt="수평선 불완전" '
        f'src="{_data_uri(layers["quality"])}" hidden>'
    )

    markers = "\n".join(
        f'<circle class="candidate" cx="{n + c.x_m / px + 0.5:.2f}" '
        f'cy="{n - c.y_m / px + 0.5:.2f}" r="{max(size / 150, 1.2):.2f}">'
        f"<title>#{c.rank} {html.escape(c.id)} | 위도 {c.lat_deg:.4f} 경도 {c.lon_deg:.4f} | "
        f"일조 {_pct(c.sun_fraction)} 지구 {_pct(c.earth_fraction)} "
        f"점수 {c.score:.3f}</title></circle>"
        for c in data.candidates
    )
    labels = "\n".join(
        f'<text class="rank" x="{n + c.x_m / px + 0.5:.2f}" y="{n - c.y_m / px - 1.5:.2f}">'
        f"{c.rank}</text>"
        for c in data.candidates
        if c.rank <= 20
    )
    rows = "\n".join(
        f"<tr><td>{c.rank}</td><td>{html.escape(c.id)}</td><td>{c.lat_deg:.4f}</td>"
        f"<td>{c.lon_deg:.2f}</td><td>{_pct(c.sun_fraction)}</td><td>{_pct(c.earth_fraction)}</td>"
        f"<td>{c.score:.3f}</td><td>{c.region_id}</td></tr>"
        for c in data.candidates
    )
    table = (
        "<table><thead><tr><th>순위</th><th>ID</th><th>위도</th><th>경도</th><th>일조율</th>"
        f"<th>지구 가시율</th><th>점수</th><th>영역</th></tr></thead><tbody>{rows}</tbody></table>"
        if data.candidates
        else "<p>선정된 후보가 없습니다. 임계값이나 분석 기간을 확인하세요.</p>"
    )
    stats = "".join(
        f"<li><span>{html.escape(k)}</span><b>{html.escape(str(v))}</b></li>"
        for k, v in data.stats.items()
    )
    gradient = ", ".join(f"rgb({int(r)},{int(g)},{int(b)})" for r, g, b in _STOPS)
    legend_classes = {"eligible": _ELIGIBLE, "excluded": _EXCLUDED, "unevaluated": _UNEVALUATED}
    swatches = "".join(
        f'<span class="sw" style="background:rgb({c[0]},{c[1]},{c[2]})"></span>{label}'
        for label, c in zip(("적격", "제외", "판정 불가"), legend_classes.values(), strict=True)
    )
    radios = "".join(
        f'<label><input type="radio" name="base" value="{name}"'
        f"{' checked' if name == 'sun' else ''}> {label}</label>"
        for name, label in _LAYER_LABELS.items()
    )
    return f"""<!doctype html>
<html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{html.escape(data.title)}</title>
<style>
:root{{color-scheme:dark;--bg:#0b0e13;--fg:#e8ecf1;--mut:#8b95a3;--line:#263041;--accent:#f5c518}}
*{{box-sizing:border-box}}body{{margin:0;background:var(--bg);color:var(--fg);
font:14px/1.5 system-ui,-apple-system,"Apple SD Gothic Neo",sans-serif;padding:16px}}
h1{{font-size:18px;margin:0 0 4px}}p.sub{{color:var(--mut);margin:0 0 16px}}
.wrap{{display:grid;grid-template-columns:minmax(0,720px) minmax(260px,1fr);gap:20px;
align-items:start}}
@media (max-width:900px){{.wrap{{grid-template-columns:1fr}}}}
.map{{position:relative;width:100%;aspect-ratio:1;background:#000;border:1px solid var(--line);
border-radius:8px;overflow:hidden}}
.map img,.map svg{{position:absolute;inset:0;width:100%;height:100%}}
.map img{{image-rendering:pixelated}}.map img[hidden]{{display:none}}
.roi{{fill:none;stroke:#fff;stroke-opacity:.5;stroke-dasharray:3 3;stroke-width:.4}}
.candidate{{fill:none;stroke:#fff;stroke-width:.6}}.candidate:hover{{stroke:var(--accent)}}
.rank{{fill:#fff;font-size:3px;text-anchor:middle;paint-order:stroke;stroke:#000;stroke-width:.6}}
.controls{{display:flex;flex-wrap:wrap;gap:12px;margin:0 0 10px}}label{{cursor:pointer}}
.bar{{height:10px;border-radius:5px;background:linear-gradient(90deg,{gradient});margin:6px 0}}
.sw{{display:inline-block;width:10px;height:10px;border-radius:2px;margin:0 4px 0 10px}}
.legend{{color:var(--mut);font-size:12px;margin-top:6px}}
ul.stats{{list-style:none;padding:0;margin:0 0 16px}}
ul.stats li{{display:flex;justify-content:space-between;padding:4px 0;
border-bottom:1px solid var(--line)}}
ul.stats span{{color:var(--mut)}}
table{{border-collapse:collapse;width:100%;font-size:12px}}
th,td{{text-align:right;padding:3px 6px;border-bottom:1px solid var(--line)}}
th:nth-child(2),td:nth-child(2){{text-align:left}}
.scroll{{max-height:420px;overflow:auto;border:1px solid var(--line);border-radius:8px}}
</style></head><body>
<h1>{html.escape(data.title)}</h1>
<p class="sub">남극 ROI. 경도 0°가 위쪽, 동쪽(경도 90°)이 오른쪽. 점선은 ROI 경계.</p>
<div class="wrap"><div>
<div class="controls">{radios}
<label><input type="checkbox" id="quality"> 수평선 불완전(주황)</label>
<label><input type="checkbox" id="cands" checked> 선정 후보</label></div>
<div class="map" id="map">
{images}
<svg viewBox="0 0 {size} {size}">
<circle class="roi" cx="{n + 0.5}" cy="{n + 0.5}" r="{data.rho_max_m / px:.2f}"/>
<g id="candidates">{markers}{labels}</g></svg></div>
<div class="legend"><div class="bar"></div>낮음 → 높음 (일조율·지구 가시율, 투명 = 결측)<br>
{swatches}</div></div>
<div><ul class="stats">{stats}</ul><div class="scroll">{table}</div></div></div>
<script>
const layers=[...document.querySelectorAll('img[data-layer]')];
const show=()=>{{const v=document.querySelector('input[name=base]:checked').value;
layers.forEach(i=>i.hidden=i.dataset.layer!==v);
document.querySelector('img[data-overlay=quality]').hidden=!document.getElementById('quality').checked;
document.getElementById('candidates').style.display=document.getElementById('cands').checked?'':'none';}};
document.querySelectorAll('input').forEach(i=>i.addEventListener('change',show));show();
</script></body></html>
"""
