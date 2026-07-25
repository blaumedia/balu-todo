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


# ── DNS rebinding: the connection must go where the check went ─────────────
def test_pinned_resolution_overrides_a_rebinding_answer(monkeypatch):
    """A hostname that answers public once and private next must not be reached.

    This is the hole that validation alone leaves: `check_outbound_url` approves
    a resolution, then the HTTP client resolves again and connects somewhere
    else. Simulated with a resolver that flips after the first call.
    """
    import socket as socket_module

    from balu.urlguard import pinned_resolution

    real_getaddrinfo = socket_module.getaddrinfo
    calls = {"n": 0}

    def flipping(host, port, *args, **kwargs):
        if host == "rebind.example":
            calls["n"] += 1
            # First answer public, every later answer the metadata endpoint.
            ip = "93.184.216.34" if calls["n"] == 1 else "169.254.169.254"
            return [(socket_module.AF_INET, socket_module.SOCK_STREAM, 6, "", (ip, port))]
        return real_getaddrinfo(host, port, *args, **kwargs)

    monkeypatch.setattr(socket_module, "getaddrinfo", flipping)

    # Unpinned, a second lookup returns the private address — the rebind lands.
    assert socket_module.getaddrinfo("rebind.example", 80)[0][4][0] == "93.184.216.34"
    assert socket_module.getaddrinfo("rebind.example", 80)[0][4][0] == "169.254.169.254"

    # Pinned to the validated address, every lookup returns it instead.
    with pinned_resolution("rebind.example", "93.184.216.34"):
        for _ in range(3):
            assert socket_module.getaddrinfo("rebind.example", 80)[0][4][0] == "93.184.216.34"

    # The pin is scoped: outside the block the resolver is untouched again.
    assert socket_module.getaddrinfo("rebind.example", 80)[0][4][0] == "169.254.169.254"


def test_pin_is_thread_local():
    """One request's pin must never redirect another thread's connection."""
    import socket as socket_module
    import threading as threading_module

    from balu.urlguard import pinned_resolution

    seen: list[str] = []

    def other_thread():
        # No pin here: this thread must fall through to the real resolver.
        try:
            seen.append(socket_module.getaddrinfo("localhost", 80)[0][4][0])
        except Exception as exc:  # noqa: BLE001
            seen.append(f"error: {exc}")

    with pinned_resolution("localhost", "93.184.216.34"):
        assert socket_module.getaddrinfo("localhost", 80)[0][4][0] == "93.184.216.34"
        t = threading_module.Thread(target=other_thread)
        t.start()
        t.join()

    assert seen and seen[0] != "93.184.216.34", "a pin leaked across threads"


def test_checked_outbound_target_returns_a_validated_address():
    from balu.urlguard import checked_outbound_target

    url, host, address = checked_outbound_target("https://93.184.216.34/topic")
    assert url == "https://93.184.216.34/topic"
    assert host == "93.184.216.34"
    assert address == "93.184.216.34"


@pytest.mark.parametrize("url", ["http://127.0.0.1/x", "http://10.0.0.1/x"])
def test_checked_outbound_target_still_rejects_internal(url):
    from balu.urlguard import UnsafeUrl, checked_outbound_target

    with pytest.raises(UnsafeUrl):
        checked_outbound_target(url)
