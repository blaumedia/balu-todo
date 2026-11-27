# syntax=docker/dockerfile:1
# Build context is the repo root so the web client can be built in later integration.

# ---- Stage 1: web build (guarded; apps/web may be absent for now) ----------
# Pinned to the *build* platform: the output is a pile of JS and CSS, identical
# for every target arch, and running pnpm under QEMU turned the arm64 leg of the
# multi-arch release build into the slowest thing in CI by far.
FROM --platform=$BUILDPLATFORM node:22-alpine AS webbuild
ARG SKIP_WEB=1
WORKDIR /build
COPY . .
RUN if [ "$SKIP_WEB" = "0" ] && [ -d apps/web ]; then \
        corepack enable && \
        pnpm install --frozen-lockfile && \
        pnpm --filter @balu/web build; \
    else \
        echo "skipping web build (SKIP_WEB=$SKIP_WEB)"; \
        mkdir -p apps/web/dist; \
    fi

# ---- Stage 2: python runtime ----------------------------------------------
FROM python:3.14-slim AS runtime

ARG VERSION=dev
# `image.source` is not decoration: GHCR links a package to its repository (and
# inherits that repo's visibility) by reading this label off the image. Without
# it the push 403s on a fresh package.
LABEL org.opencontainers.image.title="Balu" \
      org.opencontainers.image.description="Self-hostable, multi-tenant todo app with iOS and Android clients" \
      org.opencontainers.image.source="https://github.com/blaumedia/balu-todo" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.version="$VERSION"

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    PATH="/app/.venv/bin:$PATH"

# The official base image lags Debian's security fixes (libzstd1 CVE-2026-124851 was fixed in
# Debian before python:3.14-slim was rebuilt). Upgrade early, as root, so every rebuild of this
# image is clean regardless of the base image's age; the daily audit scans the result.
#
# The build arg only exists to bust the cache of the layer below: without it a release build can
# reuse an old cached upgrade layer and ship stale OS packages. The release workflow passes a
# fresh value on every run.
ARG OS_REFRESH=dev
RUN apt-get update \
    && apt-get upgrade -y --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# pip is not used at runtime (dependencies are installed with uv into /app/.venv), but the base
# image ships it together with vendored copies of urllib3, msgpack and others, which scanners flag
# whenever those lag. Removing it drops that attack surface and the findings. python:3.14-slim
# ships only pip (no setuptools or wheel), so nothing else needs to go; a failure here is real.
RUN python -m pip uninstall -y pip

# uv from the official distroless image, pinned: `:latest` made every rebuild a
# different toolchain.
COPY --from=ghcr.io/astral-sh/uv:0.13.10 /uv /usr/local/bin/uv

WORKDIR /app

# Install dependencies first (cached layer). A failing `--frozen` sync must fail
# the build — the old `|| uv sync` fallback silently discarded the lockfile and
# produced non-reproducible images.
COPY server/pyproject.toml server/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

# Application code
COPY server/ ./

# Web dist -> static (present only when SKIP_WEB=0)
COPY --from=webbuild /build/apps/web/dist/ ./static/

# Drop root. The app never writes inside its own tree, so it has no reason to
# own it either — root-owned, world-readable files are if anything harder to
# tamper with once the process is unprivileged.
#
# The recursive chown this replaces was the single slowest thing in the release
# build: ~40k venv files, one emulated syscall each, minutes per non-native
# architecture under QEMU, for no benefit at all.
RUN useradd --system --uid 10001 --user-group --no-create-home balu

# Attachment blobs are the one thing the app does write, and they must survive
# the container. The chown is scoped to this single directory on purpose: the
# recursive one removed above is what made every non-native release build crawl,
# and /data is one directory, not 40k venv files.
ENV BALU_DATA_DIR=/data
RUN mkdir -p /data && chown balu:balu /data
VOLUME /data

USER balu

EXPOSE 8000
CMD ["uvicorn", "balu.main:app", "--host", "0.0.0.0", "--port", "8000"]
