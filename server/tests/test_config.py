"""Startup configuration guards (S2)."""

from __future__ import annotations

import pytest

from balu.config import (
    DEFAULT_SECRET_KEY,
    InsecureConfiguration,
    Settings,
    check_secret_key,
)


def _settings(**kwargs) -> Settings:
    base = {"secret_key": DEFAULT_SECRET_KEY, "dev_mode": False}
    return Settings.model_construct(**{**base, **kwargs})


def test_default_secret_key_is_refused():
    with pytest.raises(InsecureConfiguration):
        check_secret_key(_settings())


def test_short_secret_key_is_refused():
    with pytest.raises(InsecureConfiguration):
        check_secret_key(_settings(secret_key="too-short"))


def test_dev_mode_allows_default_secret_key():
    check_secret_key(_settings(dev_mode=True))
    check_secret_key(_settings(secret_key="short", dev_mode=True))


def test_strong_secret_key_is_accepted():
    check_secret_key(_settings(secret_key="a" * 32))


def test_test_suite_key_is_accepted():
    """conftest sets a 43-char non-default key; the guard must not reject it."""
    check_secret_key(_settings(secret_key="test-secret-key-at-least-32-bytes-long-000"))


def test_cors_defaults_to_same_origin():
    assert Settings.model_construct(cors_origins="").cors_origin_list == []
    assert Settings.model_construct(cors_origins="*").cors_origin_list == ["*"]
    assert Settings.model_construct(
        cors_origins="https://a.example, https://b.example"
    ).cors_origin_list == ["https://a.example", "https://b.example"]
