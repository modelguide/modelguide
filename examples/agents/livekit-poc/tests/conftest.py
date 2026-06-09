"""Shared fixtures and sys.path setup for POC LiveKit agent tests."""

import os
import sys
from pathlib import Path

# Set dummy env vars BEFORE any src imports (config.py validates on import).
_TEST_ENV = {
    "OPENAI_API_KEY": "test_openai_key",
    "DEEPGRAM_API_KEY": "test_deepgram_key",
    "ELEVENLABS_API_KEY": "test_elevenlabs_key",
    "MODELGUIDE_API_URL": "http://localhost:3000",
    "MODELGUIDE_API_KEY": "mgk_test_key",
}

for k, v in _TEST_ENV.items():
    os.environ.setdefault(k, v)

# Make `src/` importable so tests can `import mg_client`, `import prompts`, etc.
sys.path.insert(0, str(Path(__file__).parent.parent / "src"))
