FROM dailyco/pipecat-base:latest

# Copy dependency files and install script
COPY pyproject.toml uv.lock pre-app.sh ./

# Copy application code
COPY src/ .
