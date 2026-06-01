# Minimal image for the livekit-poc worker.
# Build:  docker build -t livekit-poc .
# Run:    docker run --env-file .env livekit-poc
FROM python:3.11-slim

WORKDIR /app

# Curl is needed by the silero/turn-detector download-files step.
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml ./
RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir .

COPY src ./src

# Pre-download VAD + turn-detector weights so cold-start latency is bounded.
RUN python src/agent.py download-files || true

ENTRYPOINT ["python", "src/agent.py"]
CMD ["start"]
