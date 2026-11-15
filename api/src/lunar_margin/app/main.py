from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from typing import Literal

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from lunar_margin.app.analysis import router as analysis_router
from lunar_margin.app.candidates import router as candidates_router
from lunar_margin.app.settings import Settings
from lunar_margin.app.site_assessment import router as site_assessment_router
from lunar_margin.app.landing_grid import router as landing_grid_router
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
        allow_methods=["GET"],
        allow_headers=["*"],
    )

    app.include_router(analysis_router)
    app.include_router(site_assessment_router)
    app.include_router(landing_grid_router)
    app.include_router(candidates_router)
    app.include_router(trajectory_router)

    @app.get("/health")
    def health() -> Health:  # pyright: ignore[reportUnusedFunction]
        return Health(status="ok")

    return app


app = create_app(Settings())
