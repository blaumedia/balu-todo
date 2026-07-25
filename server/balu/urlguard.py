"""Outbound-URL safety checks (SSRF guard, §8 notification channels).

The ntfy transport POSTs to a URL the user supplies, so an unchecked URL turns
the server into a request proxy for anything reachable from the container
network (other services, cloud metadata endpoints, localhost admin ports).

:func:`check_outbound_url` is applied twice: when the channel is stored and
again at send time, because DNS can change in between.

Validation alone is not enough: resolving here and letting httpx resolve again
leaves a DNS-rebinding window, where a 0-TTL record answers public for the check
and private for the connection. :func:`pinned_resolution` closes it by forcing
the request to connect to the exact address that was validated — the hostname
stays in the URL, so TLS SNI and certificate verification are unaffected.
"""

from __future__ import annotations

import ipaddress
import socket
import threading
from collections.abc import Iterator
from contextlib import contextmanager
from urllib.parse import urlsplit

ALLOWED_SCHEMES = ("http", "https")


class UnsafeUrl(ValueError):
    """The URL is malformed or points at a non-public address."""


def _address_is_public(ip: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    # `is_global` catches the ranges an explicit list keeps missing — notably
    # CGNAT 100.64.0.0/10, which is neither `is_private` nor `is_reserved` but
    # reaches carrier infrastructure from a host behind it. It does NOT subsume
    # multicast (224.0.0.1 reports is_global=True), so that check has to stay.
    if ip.is_multicast or not ip.is_global:
        return False
    # IPv4-mapped / 6to4 / Teredo v6 addresses can smuggle a private v4 target.
    if isinstance(ip, ipaddress.IPv6Address):
        mapped = ip.ipv4_mapped or ip.sixtofour
        if mapped is not None and not _address_is_public(mapped):
            return False
        if ip.teredo is not None and not _address_is_public(ip.teredo[1]):
            return False
    return True


def resolve_host(host: str) -> list[ipaddress.IPv4Address | ipaddress.IPv6Address]:
    """Every address `host` resolves to. Raises UnsafeUrl if it cannot resolve."""
    try:
        literal = ipaddress.ip_address(host.strip("[]"))
    except ValueError:
        pass
    else:
        return [literal]
    try:
        infos = socket.getaddrinfo(host, None, proto=socket.IPPROTO_TCP)
    except socket.gaierror as exc:
        raise UnsafeUrl(f"could not resolve host: {host}") from exc
    return [ipaddress.ip_address(info[4][0]) for info in infos]


# Thread-local host -> address pins, consulted by the patched resolver below.
_pins = threading.local()
_original_getaddrinfo = socket.getaddrinfo
_patch_lock = threading.Lock()


def _pinning_getaddrinfo(host, port, family=0, type=0, proto=0, flags=0):  # noqa: A002
    pins = getattr(_pins, "map", None)
    address = pins.get(host) if pins else None
    if address is None:
        return _original_getaddrinfo(host, port, family, type, proto, flags)
    ip = ipaddress.ip_address(address)
    if ip.version == 6:
        return [(socket.AF_INET6, type or socket.SOCK_STREAM, proto, "", (address, port, 0, 0))]
    return [(socket.AF_INET, type or socket.SOCK_STREAM, proto, "", (address, port))]


def _install_pinning_resolver() -> None:
    """Install the pinning resolver, chaining to whatever is currently in place.

    Keyed on identity rather than a "did we patch?" flag: with a flag, anything
    that replaced `socket.getaddrinfo` after our install (another library, a
    test fixture) would silently disable pinning and take the SSRF guard down
    with it, with nothing to notice.
    """
    global _original_getaddrinfo
    with _patch_lock:
        current = socket.getaddrinfo
        if current is not _pinning_getaddrinfo:
            _original_getaddrinfo = current
            socket.getaddrinfo = _pinning_getaddrinfo


@contextmanager
def pinned_resolution(host: str, address: str) -> Iterator[None]:
    """Force `host` to resolve to `address` for the calling thread only.

    This is what actually closes the SSRF hole. Validating the hostname and then
    letting the HTTP client resolve it again is a check of one resolution and a
    connection to another; an attacker controlling the zone answers public for
    the first and 169.254.169.254 for the second. Pinning removes the second
    lookup entirely, while leaving the URL — and therefore SNI and certificate
    validation — untouched.
    """
    _install_pinning_resolver()
    previous = getattr(_pins, "map", None)
    _pins.map = {**(previous or {}), host: address}
    try:
        yield
    finally:
        _pins.map = previous


def check_outbound_url(raw: str) -> str:
    """Validate a user-supplied outbound URL. Returns it, or raises UnsafeUrl.

    Only http/https, and every address the hostname resolves to must be a public
    unicast address — loopback, private, link-local (incl. 169.254.169.254),
    multicast and reserved ranges are refused.
    """
    if not isinstance(raw, str) or not raw.strip():
        raise UnsafeUrl("url is required")
    parts = urlsplit(raw.strip())
    if parts.scheme.lower() not in ALLOWED_SCHEMES:
        raise UnsafeUrl("url must start with http:// or https://")
    host = parts.hostname
    if not host:
        raise UnsafeUrl("url has no host")

    addresses = resolve_host(host)
    if not addresses:
        raise UnsafeUrl(f"could not resolve host: {host}")
    for ip in addresses:
        if not _address_is_public(ip):
            raise UnsafeUrl(f"url resolves to a non-public address: {ip}")
    return raw.strip()


def checked_outbound_target(raw: str) -> tuple[str, str, str]:
    """Validate `raw` and return (url, host, address) for a pinned request.

    The address is one of the validated ones; pass it to :func:`pinned_resolution`
    so the connection cannot land anywhere else.
    """
    url = check_outbound_url(raw)
    host = urlsplit(url).hostname or ""
    addresses = resolve_host(host)
    for ip in addresses:
        if not _address_is_public(ip):
            raise UnsafeUrl(f"url resolves to a non-public address: {ip}")
    return url, host, str(addresses[0])
