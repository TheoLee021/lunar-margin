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
from lunar_margin.engine.rf import RFScenario

PRIORITY_WEIGHTS = {
    "visibility": Weights(sun=0.25, earth=0.25, visibility=0.5),
    "balanced": Weights(sun=0.4, earth=0.4, visibility=0.2),
    "solar": Weights(sun=0.6, earth=0.2, visibility=0.2),
    "earth": Weights(sun=0.2, earth=0.6, visibility=0.2),
}
PLAN_VERSION = "6-local-visibility"
# 임무 기간은 짧으므로 30분 간격이면 24시간·6시간 한도를 충분히 가릴 수 있다
MISSION_STEP_MINUTES = 30


class MissionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    rf: RFScenario = RFScenario()
    min_communication_fraction: float | None = Field(default=None, ge=0, le=1)
    min_sunlight_fraction: float | None = Field(default=None, ge=0, le=1)
    landing_date: date
    mission_duration_days: int = Field(ge=1, le=365)
    max_continuous_darkness_hours: float | None = Field(default=None, ge=0.0)
    max_communication_blackout_hours: float | None = Field(default=None, ge=0.0)
    max_terrain_slope_degrees: float | None = Field(default=None, gt=0.0, le=90.0)
    max_terrain_roughness_m: float | None = Field(default=None, ge=0.0, allow_inf_nan=False)
    search_region: Literal["south", "global"] = "south"
    optimization_priority: Literal["balanced", "solar", "earth", "visibility"] = "balanced"
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
        # 일조율 하한이 없는 입력은 이 필드가 생기기 전과 같은 id를 가져, 저장된 결과를 그대로 쓴다
        added_later = {"min_sunlight_fraction"} if self.min_sunlight_fraction is None else None
        canonical = f"v{PLAN_VERSION}|{self.model_dump_json(exclude=added_later)}"
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
    config = base.model_copy(
        update={
            "rf": mission.rf,
            "window": AnalysisWindow(
                start=start,
                end=start + timedelta(days=mission.mission_duration_days),
                step_minutes=MISSION_STEP_MINUTES,
            ),
            "thresholds": Thresholds(
                min_sun_fraction=mission.min_sunlight_fraction,
                max_sun_dark_hours=mission.max_continuous_darkness_hours,
                max_rf_blackout_hours=mission.max_communication_blackout_hours,
                # Retain the historical LOS bound for existing consumers. RF is stricter
                # (or equal); mission windows contain whole 30-minute samples.
                max_earth_blackout_hours=mission.max_communication_blackout_hours,
                min_rf_fraction=mission.min_communication_fraction,
                max_terrain_slope_degrees=mission.max_terrain_slope_degrees,
                max_terrain_roughness_m=mission.max_terrain_roughness_m,
            ),
            "weights": PRIORITY_WEIGHTS[mission.optimization_priority],
            "observer_height_m": mission.observer_height_m or 0.0,
        }
    )
    return SearchPlan(config=config, warnings=[])
