from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """환경변수 설정. 키 목록은 api/.env.example 참고."""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # 쉼표로 구분한 허용 origin 목록 (예: "http://localhost:5173,https://lunar-margin.vercel.app")
    cors_origins: str = "http://localhost:5173"

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


settings = Settings()
