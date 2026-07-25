"""Unit tests for the outbound-URL SSRF guard (S3).

Only IP literals are used so the tests never touch DNS.
"""

from __future__ import annotations

import pytest

from balu.urlguard import UnsafeUrl, check_outbound_url

BLOCKED = [
    "http://127.0.0.1/x",
    "https://127.0.0.1:8443/x",
    "http://[::1]/x",
    "http://10.1.2.3/x",
    "http://172.20.0.1/x",
    "http://192.168.0.1/x",
    "http://169.254.169.254/latest/meta-data/",
    "http://0.0.0.0/x",
    "http://224.0.0.1/x",  # multicast
    "http://[::ffff:127.0.0.1]/x",  # IPv4-mapped loopback
    "http://[fe80::1]/x",  # link-local v6
    "http://[fc00::1]/x",  # unique-local v6
]

BAD_SCHEME = [
    "file:///etc/passwd",
    "gopher://127.0.0.1/",
    "ftp://198.51.100.1/",
    "//example.com/x",
    "",
    "   ",
]


@pytest.mark.parametrize("url", BLOCKED)
def test_rejects_non_public_addresses(url):
    with pytest.raises(UnsafeUrl):
        check_outbound_url(url)


@pytest.mark.parametrize("url", BAD_SCHEME)
def test_rejects_non_http_schemes(url):
    with pytest.raises(UnsafeUrl):
        check_outbound_url(url)


def test_allows_public_addresses():
    assert check_outbound_url("https://93.184.216.34/topic") == "https://93.184.216.34/topic"
    assert check_outbound_url("http://8.8.8.8:8080/topic").startswith("http://")


def test_strips_surrounding_whitespace():
    assert check_outbound_url("  https://93.184.216.34/t  ") == "https://93.184.216.34/t"
