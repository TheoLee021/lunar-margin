from typing import Literal

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from lunar_margin.app.analysis import router as analysis_router
from lunar_margin.app.site_assessment import router as site_assessment_router
from lunar_margin.app.settings import Settings


class Health(BaseModel):
    status: Literal["ok"]


def create_app(settings: Settings) -> FastAPI:
    app = FastAPI(title="Lunar Margin API")

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_origin_regex=settings.cors_origin_regex or None,
        allow_methods=["GET"],
        allow_headers=["*"],
    )

    app.include_router(analysis_router)
    app.include_router(site_assessment_router)

    @app.get("/health")
    def health() -> Health:  # pyright: ignore[reportUnusedFunction]
        return Health(status="ok")

    return app


app = create_app(Settings())
