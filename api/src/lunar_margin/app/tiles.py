"""GET /tiles/{layer}/meta.json, /tiles/{layer}/{z}/{x}/{y}.png.

타일은 `python -m lunar_margin.pipeline.overlay_tiles`가 DATA_DIR/tiles/{layer}/에 미리 굽고,
여기서는 파일을 그대로 돌려준다 (계약: docs/api.md).
"""

from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse

from lunar_margin.app.analysis import get_settings
from lunar_margin.app.settings import Settings

LAYERS = frozenset({"horizon", "normal", "normal-wide"})
SettingsDep = Annotated[Settings, Depends(get_settings)]
_CACHE = {"Cache-Control": "public, max-age=3600"}
# meta는 어떤 레벨·타일이 있는지 알려 주므로 캐시된 사본을 그냥 쓰지 못하게 한다
# (몇 kB라 매번 받아도 된다)
_REVALIDATE = {"Cache-Control": "no-cache"}

router = APIRouter(prefix="/tiles", tags=["tiles"])


def _layer_dir(settings: Settings, layer: str) -> Path:
    if layer not in LAYERS:  # 목록에 있는 이름만 경로로 쓴다
        raise HTTPException(status_code=404, detail=f"layer '{layer}' not found")
    return settings.data_dir / "tiles" / layer


def _file(path: Path, media_type: str, headers: dict[str, str]) -> FileResponse:
    if not path.is_file():
        raise HTTPException(status_code=404, detail="tile not found")
    return FileResponse(path, media_type=media_type, headers=headers)


@router.get("/{layer}/meta.json")
def get_meta(layer: str, settings: SettingsDep) -> FileResponse:
    return _file(_layer_dir(settings, layer) / "meta.json", "application/json", _REVALIDATE)


@router.get("/{layer}/{z}/{x}/{y}.png")
def get_tile(layer: str, z: int, x: int, y: int, settings: SettingsDep) -> FileResponse:
    # 경로는 목록의 레이어 이름과 정수만으로 만든다
    return _file(_layer_dir(settings, layer) / str(z) / str(x) / f"{y}.png", "image/png", _CACHE)
