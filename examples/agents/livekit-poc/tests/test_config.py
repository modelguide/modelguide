"""Tests for env loading.

``config.validate()`` is the gatekeeper at entrypoint — if required vars
are missing, the worker should fail fast with a readable error rather
than crashing inside a LiveKit plugin three frames deep.
"""

from __future__ import annotations

import importlib
import os

import pytest

import config


def _reload_config_with(env: dict[str, str | None], *, validate: bool = True):
    """Reload config.py with a specific env snapshot.

    If ``validate=True``, also runs ``config.validate()`` inside the env
    window so the module's globals are populated from the test values
    before they're rolled back. Set ``validate=False`` when the test is
    asserting the validate() call itself (e.g. expecting it to raise).
    """
    snapshot = {k: os.environ.get(k) for k in env}
    try:
        for k, v in env.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
        importlib.reload(config)
        if validate:
            config.validate()
        return config
    finally:
        for k, v in snapshot.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v


class TestValidate:
    def test_passes_with_required_vars(self):
        cfg = _reload_config_with(
            {
                "OPENAI_API_KEY": "ok",
                "DEEPGRAM_API_KEY": "ok",
                "ELEVENLABS_API_KEY": "ok",
                "MODELGUIDE_API_URL": "http://localhost:3000",
                "MODELGUIDE_API_KEY": "mgk_abc",
            }
        )
        assert cfg.MODELGUIDE_API_URL == "http://localhost:3000"
        assert cfg.MODELGUIDE_API_KEY == "mgk_abc"

    def test_strips_trailing_slash_on_api_url(self):
        # mg_client builds URLs by concatenation — a trailing slash silently
        # double-slashes the path. Strip at validate() so consumers don't
        # each need to remember.
        cfg = _reload_config_with(
            {
                "OPENAI_API_KEY": "ok",
                "DEEPGRAM_API_KEY": "ok",
                "ELEVENLABS_API_KEY": "ok",
                "MODELGUIDE_API_URL": "http://localhost:3000/",
                "MODELGUIDE_API_KEY": "mgk_abc",
            }
        )
        assert cfg.MODELGUIDE_API_URL == "http://localhost:3000"

    def test_raises_when_required_missing(self):
        # `_reload_config_with` runs validate() inside its env window — a
        # ConfigError raised there propagates up through the try/finally.
        # We match on the parent (RuntimeError) because importlib.reload
        # re-creates the ConfigError class, and pytest.raises captures the
        # class reference before the reload runs.
        with pytest.raises(RuntimeError, match="OPENAI_API_KEY"):
            _reload_config_with(
                {
                    "OPENAI_API_KEY": None,
                    "DEEPGRAM_API_KEY": "ok",
                    "ELEVENLABS_API_KEY": "ok",
                    "MODELGUIDE_API_URL": "http://localhost:3000",
                    "MODELGUIDE_API_KEY": "mgk_abc",
                },
            )

    def test_validate_is_idempotent(self):
        # Called twice (e.g. on first job + by an import in a test) — second
        # call must be a no-op, not a re-validation that re-reads env.
        cfg = _reload_config_with(
            {
                "OPENAI_API_KEY": "ok",
                "DEEPGRAM_API_KEY": "ok",
                "ELEVENLABS_API_KEY": "ok",
                "MODELGUIDE_API_URL": "http://localhost:3000",
                "MODELGUIDE_API_KEY": "mgk_abc",
            }
        )
        # Mutate env after the first validate — second call must not
        # re-read.
        os.environ["OPENAI_API_KEY"] = "different_after_first_validate"
        cfg.validate()
        assert cfg.OPENAI_API_KEY == "ok"
