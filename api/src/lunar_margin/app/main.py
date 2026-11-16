from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from typing import Literal

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from lunar_margin.app.analysis import router as analysis_router
from lunar_margin.app.calendar_start import router as calendar_start_router
from lunar_margin.app.candidates import router as candidates_router
from lunar_margin.app.doi_pdi_reference import router as doi_pdi_reference_router
from lunar_margin.app.launch_schedule import router as launch_schedule_router
from lunar_margin.app.pricing import router as pricing_router
from lunar_margin.app.provider_pricing import router as provider_pricing_router
from lunar_margin.app.reservations import router as reservations_router
from lunar_margin.app.settings import Settings
from lunar_margin.app.sunlight import router as sunlight_router
from lunar_margin.app.tiles import router as tiles_router
from lunar_margin.app.trajectory import router as trajectory_router
from lunar_margin.pipeline.table_prefetch import start_prefetch


class Health(BaseModel):
    status: Literal["ok"]


def create_app(settings: Settings) -> FastAPI:
    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncGenerator[None]:
        start_prefetch(settings)  # 백그라운드로 시작하고 기다리지 않는다
        yield

    app = FastAPI(title="Lunar Margin API", lifespan=lifespan)
    app.state.settings = settings

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_origin_regex=settings.cors_origin_regex or None,
        allow_methods=["GET", "POST"],
        allow_headers=["*"],
    )

    app.include_router(analysis_router)
    app.include_router(candidates_router)
    app.include_router(pricing_router)
    app.include_router(provider_pricing_router)
    app.include_router(launch_schedule_router)
    app.include_router(calendar_start_router)
    app.include_router(reservations_router)
    app.include_router(trajectory_router)
    app.include_router(doi_pdi_reference_router)
    app.include_router(tiles_router)
    app.include_router(sunlight_router)

    @app.get("/health")
    def health() -> Health:  # pyright: ignore[reportUnusedFunction]
        return Health(status="ok")

    return app


app = create_app(Settings())
