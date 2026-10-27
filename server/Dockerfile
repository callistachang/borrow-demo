FROM node:24-bookworm-slim AS browser-dependencies
WORKDIR /dependencies
COPY providers/phone/package.json providers/phone/package-lock.json ./
RUN npm ci --omit=dev

FROM python:3.12-slim

COPY --from=ghcr.io/astral-sh/uv:0.13.5 /uv /uvx /bin/

WORKDIR /app/server

COPY server/pyproject.toml server/uv.lock ./
RUN uv sync --locked --no-dev --no-install-project

COPY server/main.py ./
COPY sdk /app/sdk
COPY providers /app/providers
COPY --from=browser-dependencies /dependencies/node_modules /app/providers/phone/node_modules

EXPOSE 8000

CMD ["/app/server/.venv/bin/uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
