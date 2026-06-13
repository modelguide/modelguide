"""Shared pytest fixtures for the prototype agent."""

from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest

# Make `src/` importable as a flat module tree (mirrors `livekit-agent` layout)
SRC = Path(__file__).resolve().parent.parent / "src"
sys.path.insert(0, str(SRC))


@pytest.fixture(autouse=True)
def _stub_env(monkeypatch):
    """Default env vars so ``config.validate()`` succeeds in tests.

    Individual tests can override via ``monkeypatch.setenv`` before they
    call ``validate()`` themselves.
    """
    monkeypatch.setenv("OPENAI_API_KEY", "test-openai")
    monkeypatch.setenv("DEEPGRAM_API_KEY", "test-deepgram")
    monkeypatch.setenv("ELEVENLABS_API_KEY", "test-elevenlabs")
    monkeypatch.setenv("MODELGUIDE_API_URL", "http://api.test")
    monkeypatch.setenv("MODELGUIDE_API_KEY", "mgk_test")
    monkeypatch.setenv("AGENT_NAME", "modelguide-prototype-test")

    # Make config a clean slate per-test so module-level constants don't
    # leak between cases.
    import config
    config._validated = False

    yield
