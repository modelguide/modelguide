"""Shared fixtures and sys.path setup for the livekit-poc tests."""

import os
import sys
from pathlib import Path

# Set dummy env vars BEFORE any src imports (config.py validates eagerly via
# load_dotenv on import). Each test that needs different values can mutate
# os.environ in its own setup.
_TEST_ENV = {
    "OPENAI_API_KEY": "test_openai_key",
    "DEEPGRAM_API_KEY": "test_deepgram_key",
    "ELEVENLABS_API_KEY": "test_elevenlabs_key",
    "MODELGUIDE_API_URL": "http://localhost:3000",
    "MODELGUIDE_API_KEY": "mgk_test_key",
    "MODELGUIDE_AGENT_ID": "00000000-0000-0000-0000-000000000000",
}

for k, v in _TEST_ENV.items():
    os.environ.setdefault(k, v)

# Add src/ to sys.path so tests can `import config`, `import prompt_loader`, etc.
sys.path.insert(0, str(Path(__file__).parent.parent / "src"))
