"""API error helper — produces the contract error envelope."""

from __future__ import annotations

from fastapi import HTTPException


class ApiError(HTTPException):
    """HTTPException whose detail matches {code, message} per the contract."""

    def __init__(
        self,
        status_code: int,
        code: str,
        message: str,
        headers: dict[str, str] | None = None,
    ) -> None:
        super().__init__(
            status_code=status_code,
            detail={"code": code, "message": message},
            headers=headers,
        )


def invalid_credentials() -> ApiError:
    return ApiError(401, "invalid_credentials", "Invalid email or password")


def email_taken() -> ApiError:
    return ApiError(409, "email_taken", "Email is already registered")


def registration_disabled() -> ApiError:
    return ApiError(403, "registration_disabled", "Registration is disabled")


def invalid_token() -> ApiError:
    return ApiError(401, "invalid_token", "Invalid or rotated token")


def token_expired() -> ApiError:
    return ApiError(401, "token_expired", "Token has expired")


def not_found(message: str = "Not found") -> ApiError:
    return ApiError(404, "not_found", message)


def forbidden(message: str = "Forbidden") -> ApiError:
    return ApiError(403, "forbidden", message)


def validation_error(message: str = "Validation error") -> ApiError:
    return ApiError(422, "validation_error", message)


def invalid_invite_token() -> ApiError:
    # §7: invite accept with an unknown/revoked/expired token → 400 invalid_token.
    return ApiError(400, "invalid_token", "Invite is invalid, revoked, or expired")


def last_owner() -> ApiError:
    return ApiError(400, "last_owner", "A workspace must keep at least one owner")


def channel_unavailable(message: str = "Channel transport is not configured") -> ApiError:
    return ApiError(400, "channel_unavailable", message)


def rate_limited(
    message: str = "Too many attempts, try again later", retry_after: int = 300
) -> ApiError:
    # Retry-After is what HTTP clients actually look at; without it a caller can
    # only guess, and tends to guess "immediately".
    return ApiError(429, "rate_limited", message, headers={"Retry-After": str(retry_after)})
