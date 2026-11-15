"""사용자 임무 입력(MissionRequest)을 탐색 설정(SearchConfig)으로 바꾼다.

착륙 날짜 + 임무 기간이 곧 분석 기간이고, 연속 암흑·통신 두절 한도는 필수 적격 조건이 된다.
최적화 우선순위는 점수 가중치가 된다.
"""

import hashlib
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from typing import Literal, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator

from lunar_margin.engine.candidates.config import (
    EPHEMERIS_END,
    EPHEMERIS_START,
    AnalysisWindow,
    SearchConfig,
    Thresholds,
    Weights,
)

# 우선순위별 점수 가중치 (일조, 지구).
# 값이 바뀌면 같은 입력의 결과가 달라지므로 PLAN_VERSION도 함께 올린다
PRIORITY_WEIGHTS: dict[str, tuple[float, float]] = {
    "balanced": (0.5, 0.5),
    "solar": (0.75, 0.25),
    "earth": (0.25, 0.75),
}
PLAN_VERSION = "3"  # Do not reuse historical runs that ignored regional roughness.
# 임무 기간은 짧으므로 30분 간격이면 24시간·6시간 한도를 충분히 가릴 수 있다
MISSION_STEP_MINUTES = 30


class MissionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    landing_date: date
    mission_duration_days: int = Field(ge=1, le=365)
    max_continuous_darkness_hours: float | None = Field(default=None, ge=0.0)
    max_communication_blackout_hours: float | None = Field(default=None, ge=0.0)
    max_terrain_slope_degrees: float | None = Field(default=None, gt=0.0, le=90.0)
    max_terrain_roughness_m: float | None = Field(default=None, ge=0.0, allow_inf_nan=False)
    search_region: Literal["south", "global"] = "south"
    optimization_priority: Literal["balanced", "solar", "earth"] = "balanced"
    observer_height_m: float | None = Field(default=None, ge=0.0, le=100.0)

    @model_validator(mode="after")
    def _check(self) -> Self:
        if self.search_region == "global":
            raise ValueError("hybrid global search is planned and not available yet")
        start = datetime(
            self.landing_date.year, self.landing_date.month, self.landing_date.day, tzinfo=UTC
        )
        if (
            start < EPHEMERIS_START
            or start + timedelta(days=self.mission_duration_days) > EPHEMERIS_END
        ):
            raise ValueError("the mission must stay inside the ephemeris coverage (1850-2150)")
        return self

    def run_id(self) -> str:
        """같은 입력은 항상 같은 id를 갖는다 (결과 재사용). API가 그대로 폴더 이름으로 쓴다."""
        canonical = f"v{PLAN_VERSION}|{self.model_dump_json()}"
        return "m-" + hashlib.sha256(canonical.encode()).hexdigest()[:10]


@dataclass(frozen=True)
class SearchPlan:
    config: SearchConfig
    warnings: list[str]


def plan_search(mission: MissionRequest, base: SearchConfig | None = None) -> SearchPlan:
    base = base or SearchConfig()
    start = datetime(
        mission.landing_date.year, mission.landing_date.month, mission.landing_date.day, tzinfo=UTC
    )
    sun_weight, earth_weight = PRIORITY_WEIGHTS[mission.optimization_priority]
    config = base.model_copy(
        update={
            "window": AnalysisWindow(
                start=start,
                end=start + timedelta(days=mission.mission_duration_days),
                step_minutes=MISSION_STEP_MINUTES,
            ),
            "thresholds": Thresholds(
                max_sun_dark_hours=mission.max_continuous_darkness_hours,
                max_earth_blackout_hours=mission.max_communication_blackout_hours,
                max_terrain_slope_degrees=mission.max_terrain_slope_degrees,
                max_terrain_roughness_m=mission.max_terrain_roughness_m,
            ),
            "weights": Weights(sun=sun_weight, earth=earth_weight),
            "observer_height_m": mission.observer_height_m or 0.0,
        }
    )
    return SearchPlan(config=config, warnings=[])
