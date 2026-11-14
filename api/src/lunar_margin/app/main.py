from typing import Literal

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from lunar_margin.app.settings import settings

app = FastAPI(title="Lunar Margin API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_methods=["GET"],
    allow_headers=["*"],
)


class Health(BaseModel):
    status: Literal["ok"]


@app.get("/health")
def health() -> Health:
    return Health(status="ok")
