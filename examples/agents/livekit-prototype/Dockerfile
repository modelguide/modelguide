FROM ghcr.io/astral-sh/uv:python3.13-bookworm-slim AS builder

WORKDIR /app
COPY pyproject.toml .
RUN uv venv /app/.venv && \
    uv pip install --python /app/.venv/bin/python --no-cache "."

# Pre-download Silero VAD weights so cold-start doesn't hit the network.
ENV HF_HOME=/app/.cache/huggingface
RUN /app/.venv/bin/python -c "from livekit.plugins.silero import VAD; VAD.load()"

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
ENV PYTHONPATH=/app/src

USER agent
CMD ["python", "-m", "prototype_agent.agent", "start"]
