"""Pytest fixtures and path setup.

We expose the `src/` directory on ``sys.path`` so tests can import the
agent modules with their plain names (e.g. ``import dispatch``) — same
convention used by ``examples/agents/livekit-agent/tests/conftest.py``.
"""

import sys
from pathlib import Path

SRC = Path(__file__).resolve().parents[1] / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))
