"""Database engine and session factory."""

from __future__ import annotations

import re
from collections.abc import Iterator

import psycopg
from sqlalchemy import create_engine
from sqlalchemy.engine import URL, make_url
from sqlalchemy.exc import ArgumentError, DBAPIError
from sqlalchemy.exc import TimeoutError as PoolTimeoutError
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from .config import get_settings

_engine = None
_SessionLocal: sessionmaker[Session] | None = None


class Base(DeclarativeBase):
    pass


_LOCK_TIMEOUT_OPTION = "-c lock_timeout=15000"

# Postgres errors that go away by themselves: connection loss (08), serialization
# failure, deadlock, lock wait timeout, server shutdown/restart, too many
# connections (a failed connect has no SQLSTATE, see below).
# Everything else (program limits, object state, ...) fails the same way on every
# attempt and must stay a permanent rejection.
_TRANSIENT_SQLSTATES = frozenset(
    {"40001", "40P01", "55P03", "57P01", "57P02", "57P03", "53300"}
)


def _is_connection_level_failure(exc: DBAPIError) -> bool:
    """True for a libpq client-side connection failure (no statement, no SQLSTATE).

    Covers a failed connect, and also a connection lost during BEGIN, COMMIT or
    ROLLBACK ("the connection is closed", "server closed the connection
    unexpectedly"): those too carry no statement and no SQLSTATE.

    A failed connect: refused, server still starting, but also a wrong password or a missing
    database: psycopg 3 builds every connect failure as a bare OperationalError
    from libpq's message, so its sqlstate is None and the cases cannot be told
    apart without parsing a server-language-dependent message. They are treated
    as transient on purpose (every request fails until the operator fixes the
    configuration, retrying is free, and the client keeps its queue). Do not
    "fix" this into message parsing; the log carries the libpq reason instead,
    see describe_transient_error.

    A statement-less error is not enough: SQLAlchemy passes statement=None for
    every error at begin/commit/rollback, so a deterministic COMMIT failure
    (e.g. 54xxx, 55000, 57014) has a SQLSTATE and stays permanent. Client-side
    libpq errors for a statement (the 65535 parameter limit) carry the
    statement and stay permanent too.
    """
    return (
        exc.statement is None
        and isinstance(exc.orig, psycopg.OperationalError)
        and exc.orig.sqlstate is None
    )


def describe_transient_error(exc: BaseException) -> str:
    """Log text for a transient database error: type, SQLSTATE, libpq reason.

    For a connection-level failure the libpq message is added so an operator can
    see "password authentication failed" and the like. It names host, port, user
    and database; the configured password is redacted as a second guard, and
    newlines are folded so one error stays one log line. Errors that ran a
    statement log only the type and SQLSTATE (Postgres's DETAIL can carry row
    content).
    """
    orig = getattr(exc, "orig", None)
    text = f"{type(exc).__name__} (sqlstate {getattr(orig, 'sqlstate', None)})"
    if isinstance(exc, DBAPIError) and _is_connection_level_failure(exc):
        message = " | ".join(str(orig).strip().splitlines())
        for secret in _configured_secrets():
            message = message.replace(secret, "***")
        text += f": {message}"
    return text


def _configured_secrets() -> list[str]:
    """Strings of the configured URL to blank out of a logged libpq message.

    The parsed (percent-decoded) password. validate_database_url allows only
    one '@', and only in front of the host, so the userinfo always ends where
    the password does and no part of the password can end up in the host name.
    Defense in depth only.
    """
    try:
        url = make_url(get_settings().database_url)
    except Exception:
        return []
    return [url.password] if url.password and len(url.password) >= 3 else []


def is_transient_db_error(exc: BaseException) -> bool:
    """True for a temporary database failure that a resend can overcome."""
    if isinstance(exc, PoolTimeoutError):
        return True
    if not isinstance(exc, DBAPIError):
        return False
    if exc.connection_invalidated:
        return True
    if _is_connection_level_failure(exc):
        return True
    state = getattr(exc.orig, "sqlstate", None) or getattr(exc.orig, "pgcode", None)
    if not isinstance(state, str):
        return False
    return state.startswith("08") or state in _TRANSIENT_SQLSTATES


def validate_database_url(database_url: str) -> URL:
    """Parse the URL; reject one whose '@' placement is ambiguous.

    Ambiguous means more than one '@' in the raw text, or a single '@' that
    follows a '/', '?' or '#' after '://' (SQLAlchemy's password pattern reaches
    across those, so the tail of the password would become the host name and end
    up in error logs). One structural rule instead of parser cases: the only
    unencoded '@' is the one in front of the host; any other '@' (password,
    query value, database name) must be percent-encoded as %40. Called at
    startup (before migrations), by alembic's env.py and by the engine factory.
    The errors never repeat the URL: a URL SQLAlchemy cannot parse (older
    versions echo it) and a bad port both raise a fixed message instead.

    Port rule, on the raw text (not url.port, which int() normalises): the text
    between the ':' after the host and the next '/', '?' or '#' must be 1-5
    ASCII digits with a value of 1-65535. That rejects '_', '+', whitespace,
    full-width digits and a password with letters whose '@host' was forgotten.

    Documented boundary: a URL WITHOUT credentials (no '@') is taken literally.
    If an operator forgets '@host' and the password happens to look like a valid
    "port/dbname?query" (e.g. balu:4242/ab+cd/balu, balu:31415/db,
    balu:12?ab=cd/balu), it is indistinguishable from a legitimate
    credential-less URL and cannot be detected: the digits become the port and
    the rest the database name or query. The README requires BALU_DB_PASSWORD to
    be URL-safe; the generated hex value is always caught by the port rule. No
    heuristics go beyond the port rule.
    """
    rest = database_url.partition("://")[2]
    at = rest.find("@")
    if database_url.count("@") > 1 or (at != -1 and any(c in rest[:at] for c in "/?#")):
        raise ValueError(
            "DATABASE_URL has an ambiguous '@': percent-encode every '@' "
            "except the one before the host as %40"
        )
    hostport = re.split("[/?#]", rest, maxsplit=1)[0].rpartition("@")[2]
    _, colon, port_text = hostport.rpartition(":")
    if colon and "]" not in port_text and not (
        re.fullmatch("[0-9]{1,5}", port_text) and 1 <= int(port_text) <= 65535
    ):
        raise ValueError(
            "DATABASE_URL has an invalid port (1-5 ASCII digits, 1-65535; "
            "is '@host' missing?)"
        )
    try:
        url = make_url(database_url)
    except (ArgumentError, ValueError):
        raise ValueError(
            "DATABASE_URL cannot be parsed (expected user:password@host:port/database)"
        ) from None
    return url


def database_url_with_lock_timeout(database_url: str) -> URL:
    """The URL with our lock_timeout added to any `options` the operator set.

    connect_args={"options": ...} would replace an `options` query parameter of
    the URL; ours goes first so an operator's own lock_timeout in the URL's
    `options` still wins. Passing `options` makes libpq ignore PGOPTIONS and a
    service file's `options`, so a lock_timeout set there no longer applies.
    """
    url = validate_database_url(database_url)
    existing = url.query.get("options")
    if isinstance(existing, tuple):
        existing = " ".join(existing)
    options = f"{_LOCK_TIMEOUT_OPTION} {existing}" if existing else _LOCK_TIMEOUT_OPTION
    return url.update_query_dict({"options": options})


def get_engine():
    global _engine, _SessionLocal
    if _engine is None:
        settings = get_settings()
        _engine = create_engine(
            # One stuck lock holder (hung storage inside a command) must not stall
            # every writer behind it for ever. The wait fails as a retryable
            # OperationalError (answered 503). No statement_timeout: a long
            # legitimate command (deleting a big project) must finish.
            database_url_with_lock_timeout(settings.database_url),
            pool_pre_ping=True,
            future=True,
            # Keep bound parameters (task titles, notes) out of SQLAlchemy's error
            # text. Postgres's own DETAIL (e.g. "Failing row contains (...)") is not
            # covered; handlers that log unexpected errors log only the type for
            # StatementError (incl. DBAPIError).
            hide_parameters=True,
            # Covers the threadpool (40 threads) at one connection per request,
            # with headroom.
            pool_size=10,
            max_overflow=30,
        )
        _SessionLocal = sessionmaker(bind=_engine, expire_on_commit=False, future=True)
    return _engine


def get_sessionmaker() -> sessionmaker[Session]:
    if _SessionLocal is None:
        get_engine()
    assert _SessionLocal is not None
    return _SessionLocal


def get_db() -> Iterator[Session]:
    """FastAPI dependency yielding a session (auto-closed)."""
    sm = get_sessionmaker()
    session = sm()
    try:
        yield session
    finally:
        session.close()
