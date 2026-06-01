"""Pytest contract for which system prompt the POC worker uses.

The selection rule is deliberately simple — one branch, one fallback,
no clever merging. This file documents that rule as executable spec so
a future change can't silently flip the precedence.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from metadata import DispatchMetadata  # noqa: E402
from prompt import DEFAULT_GREETING, DEFAULT_INSTRUCTIONS, choose_greeting, choose_instructions  # noqa: E402


# ---------------------------------------------------------------------------
# choose_instructions — dispatch wins, default is the fallback
# ---------------------------------------------------------------------------


def test_dispatch_instructions_win_over_default():
    """The whole point of the POC: a fresh compile from the dashboard
    must end up as the LLM's system prompt for the next session."""
    md = DispatchMetadata(instructions="You are Sam. Be brief.")
    assert choose_instructions(md) == "You are Sam. Be brief."


def test_falls_back_to_default_when_dispatch_missing():
    """A worker dispatched the legacy way (no instructions field) gets
    the built-in default instead of an empty system prompt."""
    md = DispatchMetadata(instructions=None)
    assert choose_instructions(md) == DEFAULT_INSTRUCTIONS


def test_default_is_non_empty():
    """An empty default would be a footgun for anyone copying this
    template — assert there's actually something useful in it."""
    assert DEFAULT_INSTRUCTIONS.strip() != ""
    assert len(DEFAULT_INSTRUCTIONS) > 50


# ---------------------------------------------------------------------------
# choose_greeting — same rule
# ---------------------------------------------------------------------------


def test_dispatch_greeting_wins_over_default():
    md = DispatchMetadata(greeting="Hi, this is Sam — how can I help?")
    assert choose_greeting(md) == "Hi, this is Sam — how can I help?"


def test_falls_back_to_default_greeting():
    md = DispatchMetadata(greeting=None)
    assert choose_greeting(md) == DEFAULT_GREETING
