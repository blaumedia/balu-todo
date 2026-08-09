"""Application settings loaded from environment.

Recognised env vars: DATABASE_URL, SECRET_KEY, BALU_DEV, BALU_ALLOW_REGISTRATION,
BALU_CORS_ORIGINS, token lifetimes, notification transports
(BALU_SMTP_HOST/PORT/USER/PASSWORD/FROM, BALU_TELEGRAM_BOT_TOKEN), the
reminder loop (BALU_REMINDERS_ENABLED, BALU_REMINDER_INTERVAL), and the remote
MCP server (BALU_MCP_ENABLED).
"""

from __future__ import annotations

from functools import lru_cache

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict

#: The value shipped in the repo. Signing tokens with it means anyone can forge
#: a session for any user, so it is rejected outside developer mode.
DEFAULT_SECRET_KEY = "dev-secret-change-me"
MIN_SECRET_KEY_LENGTH = 32


class InsecureConfiguration(RuntimeError):
    """Raised at startup when the configuration would be unsafe to run."""


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore", case_sensitive=False)

    database_url: str = Field(
        default="postgresql+psycopg://balu:balu@localhost:5432/balu",
        validation_alias=AliasChoices("DATABASE_URL", "database_url"),
    )
    secret_key: str = Field(
        default=DEFAULT_SECRET_KEY,
        validation_alias=AliasChoices("SECRET_KEY", "secret_key"),
    )
    #: Escape hatch for local development: skips the startup secret-key guard.
    dev_mode: bool = Field(
        default=False,
        validation_alias=AliasChoices("BALU_DEV", "dev_mode"),
    )
    #: How many trusted proxies sit in front of Balu. 0 (the default, i.e.
    #: directly exposed) ignores `X-Forwarded-For` entirely — the header is
    #: attacker-controlled and must not key the rate limiter. Set it to the real
    #: chain depth: proxies *append*, so the value is counted from the right, and
    #: a wrong number is worse than none.
    trusted_proxy_hops: int = Field(
        default=0,
        ge=0,
        validation_alias=AliasChoices("BALU_TRUSTED_PROXY_HOPS", "trusted_proxy_hops"),
    )
    allow_registration: bool = Field(
        default=True,
        validation_alias=AliasChoices("BALU_ALLOW_REGISTRATION", "allow_registration"),
    )
    #: Empty (the default) means same-origin only — the app serves its own SPA.
    cors_origins: str = Field(
        default="",
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

    # --- Remote MCP server ----------------------------------------------------
    #: Off by default: it hands any MCP client that holds a per-user key full
    #: read/write access to that user's workspaces, over a bearer token that
    #: never expires. Opt in per deployment, not per default.
    mcp_enabled: bool = Field(
        default=False,
        validation_alias=AliasChoices("BALU_MCP_ENABLED", "mcp_enabled"),
    )

    @property
    def cors_origin_list(self) -> list[str]:
        raw = self.cors_origins.strip()
        if not raw:
            return []  # same-origin only (§13): the server serves its own SPA
        if raw == "*":
            return ["*"]
        return [o.strip() for o in raw.split(",") if o.strip()]

    @property
    def smtp_configured(self) -> bool:
        return bool(self.smtp_host and self.smtp_from)

    @property
    def telegram_configured(self) -> bool:
        return bool(self.telegram_bot_token)


def check_secret_key(settings: Settings) -> None:
    """Refuse a known-default or too-short JWT signing key.

    ``BALU_DEV=1`` opts out for local development (and for anything that
    deliberately runs with a throwaway key).
    """
    if settings.dev_mode:
        return
    hint = (
        "Generate one with: python -c \"import secrets; print(secrets.token_urlsafe(32))\" "
        "and set SECRET_KEY. Set BALU_DEV=1 to bypass this check for local development."
    )
    if settings.secret_key == DEFAULT_SECRET_KEY:
        raise InsecureConfiguration(
            f"SECRET_KEY is still the built-in default. {hint}"
        )
    if len(settings.secret_key) < MIN_SECRET_KEY_LENGTH:
        raise InsecureConfiguration(
            f"SECRET_KEY must be at least {MIN_SECRET_KEY_LENGTH} characters. {hint}"
        )


@lru_cache
def get_settings() -> Settings:
    settings = Settings()
    check_secret_key(settings)
    return settings
