from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    model_config = SettingsConfigDict(env_prefix="MODELGUIDE_")

    app_name: str = "ModelGuide Control Panel API"
    debug: bool = False
    host: str = "0.0.0.0"
    port: int = 8000


settings = Settings()
