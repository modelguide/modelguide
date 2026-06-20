"""Shared test setup for the livekit-poc agent.

Adds ``src/`` to sys.path so tests can import the agent modules directly
without installing the package. Sets fake env vars so the agent's config
module doesn't bail at import time during a unit-test run.
"""

import os
import sys
from pathlib import Path

# Fake env BEFORE any src import (config validates at import time).
os.environ.setdefault("OPENAI_API_KEY", "test-openai-key")
os.environ.setdefault("LIVEKIT_URL", "ws://localhost:7880")
os.environ.setdefault("LIVEKIT_API_KEY", "devkey")
os.environ.setdefault("LIVEKIT_API_SECRET", "secret")
os.environ.setdefault("AGENT_NAME", "livekit-poc")

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))
