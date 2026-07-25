"""Outbound-URL safety checks (SSRF guard, §8 notification channels).

The ntfy transport POSTs to a URL the user supplies, so an unchecked URL turns
the server into a request proxy for anything reachable from the container
network (other services, cloud metadata endpoints, localhost admin ports).

:func:`check_outbound_url` is applied twice: when the channel is stored and
again at send time, because DNS can change in between.

Residual risk: this validates a *resolution*, then hands the hostname to httpx,
which resolves again. A 0-TTL DNS record can therefore answer public here and
private at connect time (rebinding). Re-checking at send time narrows the window
from days to milliseconds but does not close it — closing it means connecting to
the validated address directly, via a transport that re-checks `getpeername()`
before writing the request.
"""

from __future__ import annotations

import ipaddress
import socket
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
