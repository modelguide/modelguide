#!/bin/sh
# Install dependencies at runtime using PCC's native uv.
# This ensures packages match the runtime environment exactly.
echo "=== pre-app.sh: installing dependencies ==="
uv sync --locked --no-install-project --no-dev 2>&1
echo "=== pre-app.sh: verifying pipecat ==="
python -c "import pipecat; print('pipecat', pipecat.__version__)" 2>&1
echo "=== pre-app.sh: done ==="
