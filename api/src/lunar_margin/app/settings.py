from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """환경변수 설정. 키 목록은 api/.env.example 참고."""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # 쉼표로 구분한 허용 origin 목록 (예: "http://localhost:5173,https://lunar-margin.vercel.app")
    cors_origins: str = "http://localhost:5173"
    # 추가로 허용할 origin 정규식 (예: Vercel PR Preview 도메인). 비우면 사용하지 않음
    cors_origin_regex: str | None = None

    # NASA 원천 데이터(DEM, SPICE 커널) 저장 위치. 배포에서는 Railway Volume 마운트 경로
    data_dir: Path = Path("data")

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]
