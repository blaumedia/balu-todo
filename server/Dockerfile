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
FROM python:3.12-slim AS runtime

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

# uv from the official distroless image, pinned: `:latest` made every rebuild a
# different toolchain.
COPY --from=ghcr.io/astral-sh/uv:0.11.28 /uv /usr/local/bin/uv

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
USER balu

EXPOSE 8000
CMD ["uvicorn", "balu.main:app", "--host", "0.0.0.0", "--port", "8000"]
