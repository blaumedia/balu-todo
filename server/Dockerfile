# syntax=docker/dockerfile:1
# Build context is the repo root so the web client can be built in later integration.

# ---- Stage 1: web build (guarded; apps/web may be absent for now) ----------
FROM node:22-alpine AS webbuild
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

# Drop root: the app never writes inside its own tree.
RUN useradd --system --uid 10001 --user-group --no-create-home balu \
    && chown -R balu:balu /app
USER balu

EXPOSE 8000
CMD ["uvicorn", "balu.main:app", "--host", "0.0.0.0", "--port", "8000"]
