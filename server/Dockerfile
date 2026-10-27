FROM node:22-slim AS sdk-dependencies

WORKDIR /sdk
COPY sdk/js/package.json sdk/js/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

FROM python:3.12-slim

COPY --from=ghcr.io/astral-sh/uv:0.13.5 /uv /uvx /bin/

WORKDIR /app/server

COPY server/pyproject.toml server/uv.lock ./
RUN uv sync --locked --no-dev --no-install-project

COPY server/main.py ./
COPY --from=sdk-dependencies /sdk /app/sdk/js
COPY sdk/js/index.js /app/sdk/js/index.js
COPY providers/phone /app/providers/phone

EXPOSE 8000

CMD ["/app/server/.venv/bin/uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
