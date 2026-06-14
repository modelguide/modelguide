"""Shared fixtures + sys.path setup for tests.

The src package is added to sys.path so tests can import modules directly
without an editable install. Dummy env vars are set before any src import
because config.py reads them on import (validate() is opt-in).
"""

import os
import sys
from pathlib import Path

_TEST_ENV = {
    "OPENAI_API_KEY": "test_openai_key",
    "DEEPGRAM_API_KEY": "test_deepgram_key",
    "ELEVENLABS_API_KEY": "test_elevenlabs_key",
    "MODELGUIDE_API_URL": "http://localhost:3000",
    "MODELGUIDE_API_KEY": "mgk_test_key",
}

for k, v in _TEST_ENV.items():
    os.environ.setdefault(k, v)

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))
