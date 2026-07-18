"""Application settings loaded from environment.

Recognised env vars: DATABASE_URL, SECRET_KEY, BALU_ALLOW_REGISTRATION,
BALU_CORS_ORIGINS, token lifetimes, notification transports
(BALU_SMTP_HOST/PORT/USER/PASSWORD/FROM, BALU_TELEGRAM_BOT_TOKEN), and the
reminder loop (BALU_REMINDERS_ENABLED, BALU_REMINDER_INTERVAL).
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

    # --- Notification transports (env-gated) ---------------------------------
    smtp_host: str = Field(
        default="", validation_alias=AliasChoices("BALU_SMTP_HOST", "smtp_host")
    )
    smtp_port: int = Field(
        default=587, validation_alias=AliasChoices("BALU_SMTP_PORT", "smtp_port")
    )
    smtp_user: str = Field(
        default="", validation_alias=AliasChoices("BALU_SMTP_USER", "smtp_user")
    )
    smtp_password: str = Field(
        default="", validation_alias=AliasChoices("BALU_SMTP_PASSWORD", "smtp_password")
    )
    smtp_from: str = Field(
        default="", validation_alias=AliasChoices("BALU_SMTP_FROM", "smtp_from")
    )
    telegram_bot_token: str = Field(
        default="",
        validation_alias=AliasChoices("BALU_TELEGRAM_BOT_TOKEN", "telegram_bot_token"),
    )

    # --- Reminder background loop --------------------------------------------
    reminders_enabled: bool = Field(
        default=True,
        validation_alias=AliasChoices("BALU_REMINDERS_ENABLED", "reminders_enabled"),
    )
    reminder_interval: float = Field(
        default=30.0,
        validation_alias=AliasChoices("BALU_REMINDER_INTERVAL", "reminder_interval"),
    )

    @property
    def cors_origin_list(self) -> list[str]:
        raw = self.cors_origins.strip()
        if raw == "*" or not raw:
            return ["*"]
        return [o.strip() for o in raw.split(",") if o.strip()]

    @property
    def smtp_configured(self) -> bool:
        return bool(self.smtp_host and self.smtp_from)

    @property
    def telegram_configured(self) -> bool:
        return bool(self.telegram_bot_token)


@lru_cache
def get_settings() -> Settings:
    return Settings()
