"""Application settings loaded from environment.

Recognised env vars: DATABASE_URL, SECRET_KEY, BALU_ALLOW_REGISTRATION,
BALU_CORS_ORIGINS, plus token lifetimes.
"""

from __future__ import annotations

from functools import lru_cache

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore", case_sensitive=False)

    database_url: str = Field(
        default="postgresql+psycopg://balu:balu@localhost:5432/balu",
        validation_alias=AliasChoices("DATABASE_URL", "database_url"),
    )
    secret_key: str = Field(
        default="dev-secret-change-me",
        validation_alias=AliasChoices("SECRET_KEY", "secret_key"),
    )
    allow_registration: bool = Field(
        default=True,
        validation_alias=AliasChoices("BALU_ALLOW_REGISTRATION", "allow_registration"),
    )
    cors_origins: str = Field(
        default="*",
        validation_alias=AliasChoices("BALU_CORS_ORIGINS", "cors_origins"),
    )
    access_token_expire_minutes: int = 30
    refresh_token_expire_days: int = 60

    @property
    def cors_origin_list(self) -> list[str]:
        raw = self.cors_origins.strip()
        if raw == "*" or not raw:
            return ["*"]
        return [o.strip() for o in raw.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
