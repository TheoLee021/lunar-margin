"""서버가 시작할 때 수평선 테이블이 없으면 Storage에서 백그라운드로 받아 온다.

서버는 기다리지 않고 바로 뜬다(헬스체크가 막히지 않는다). 받는 동안 시작한 탐색은 수평선을 직접
계산하고 경고를 남긴다. 실패해도 서버는 멈추지 않는다.
"""

import logging
import threading
from collections.abc import Callable

from lunar_margin.app.settings import Settings
from lunar_margin.engine.candidates.config import SearchConfig
from lunar_margin.engine.candidates.horizon_table import find_table
from lunar_margin.pipeline.horizons import TABLES_DIR, download_for_config, table_spec_for
from lunar_margin.pipeline.table_storage import StorageConfig, StorageNotConfigured

logger = logging.getLogger(__name__)


def start_prefetch(
    settings: Settings, *, log: Callable[[str], None] = logger.info
) -> threading.Thread | None:
    """받을 필요가 있으면 백그라운드 스레드를 시작해 돌려주고, 아니면 None을 돌려준다."""
    if not settings.horizon_table_download_on_start:
        return None
    try:
        storage = StorageConfig.from_settings(settings)
    except StorageNotConfigured:
        return None  # Storage를 쓰지 않는 환경(로컬 개발 등)
    config = SearchConfig()
    try:
        spec = table_spec_for(config, settings.data_dir)
    except (FileNotFoundError, ValueError) as error:
        log(f"수평선 테이블 자동 받기를 건너뜁니다 (DEM 파일을 먼저 받아야 합니다): {error}")
        return None
    if find_table(settings.data_dir / TABLES_DIR, spec) is not None:
        return None

    def work() -> None:
        try:
            log("수평선 테이블이 없어 Storage에서 받는 중입니다 (그동안의 탐색은 직접 계산합니다)")
            path = download_for_config(config, settings.data_dir, storage, log=log)
            log(f"수평선 테이블을 받았습니다: {path}")
        except Exception as error:
            log(f"수평선 테이블을 받지 못했습니다 (직접 계산으로 계속합니다): {error}")

    thread = threading.Thread(target=work, name="horizon-table-prefetch", daemon=True)
    thread.start()
    return thread
