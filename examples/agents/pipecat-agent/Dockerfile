# Stage 1: Install packages with real Python (base image has 0-byte stubs)
FROM ghcr.io/astral-sh/uv:python3.12-trixie-slim AS builder

WORKDIR /deps
COPY requirements.txt .
RUN uv venv /deps/.venv && \
    uv pip install --python /deps/.venv/bin/python --no-cache -r requirements.txt

# Stage 2: Merge into PCC base image
FROM dailyco/pipecat-base:latest

COPY --from=builder /deps/.venv/lib/python3.12/site-packages/ /app/.venv/lib/python3.12/site-packages/

COPY requirements.txt requirements.txt
COPY src/ .
