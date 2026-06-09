FROM ghcr.io/astral-sh/uv:python3.13-bookworm-slim AS builder

WORKDIR /app
COPY pyproject.toml .
RUN uv venv /app/.venv && \
    uv pip install --python /app/.venv/bin/python --no-cache "."

# Download Silero VAD + turn-detector models at build time so the worker
# doesn't pay the cold-start cost on the first call.
ENV HF_HOME=/app/.cache/huggingface
RUN /app/.venv/bin/python -c "from livekit.plugins.silero import VAD; VAD.load()" && \
    /app/.venv/bin/python -c "from livekit.plugins.turn_detector.english import _EUORunnerEn; _EUORunnerEn._download_files()"

FROM python:3.13-slim-bookworm

RUN useradd --create-home agent
WORKDIR /app

COPY --from=builder /app/.venv /app/.venv
COPY --from=builder /app/.cache/huggingface /home/agent/.cache/huggingface
RUN chown -R agent:agent /home/agent/.cache
COPY pyproject.toml .
COPY src/ src/

ENV PATH="/app/.venv/bin:$PATH"
ENV PYTHONUNBUFFERED=1

USER agent
CMD ["python", "src/agent.py", "start"]
