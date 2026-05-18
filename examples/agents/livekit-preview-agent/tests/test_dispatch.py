"""Pure unit tests for ``parse_dispatch_metadata`` — the worker-side half
of the preview dispatch contract.

The matching producer side is
``modelguide-api/tests/unit/agents/preview-voice-dispatch.test.ts``. If a
refactor breaks either side without the other, dispatched preview rooms
go silent. The two test files together pin the contract end-to-end.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

# Make ``src`` importable without installing the package — the worker
# package layout follows the existing livekit-agent example, where ``src``
# is on the Python path via ``livekit.toml`` / pyproject src-layout.
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from dispatch import parse_dispatch_metadata  # noqa: E402


def test_parses_full_preview_payload():
    raw = json.dumps(
        {
            "mode": "preview",
            "agentName": "buildpro_sam",
            "session_id": "sess-abc",
            "user_identifier": "tester@corp.com",
            "email": "tester@corp.com",
            "instructions_override": "You are Sam. Be concise.",
        }
    )
    p = parse_dispatch_metadata(raw)
    assert p.is_preview
    assert p.mode == "preview"
    assert p.agent_name == "buildpro_sam"
    assert p.session_id == "sess-abc"
    assert p.user_identifier == "tester@corp.com"
    assert p.email == "tester@corp.com"
    assert p.instructions == "You are Sam. Be concise."


def test_returns_empty_for_missing_metadata():
    # No metadata at all: LiveKit can dispatch without it (e.g. console mode).
    # The worker should treat this as "not a preview dispatch" and bail.
    p = parse_dispatch_metadata(None)
    assert not p.is_preview
    assert p.instructions == ""


def test_returns_empty_for_blank_string():
    p = parse_dispatch_metadata("")
    assert not p.is_preview
    assert p.instructions == ""


def test_returns_empty_for_malformed_json():
    # A truncated payload should not crash the worker — it should produce
    # an empty payload so the entrypoint can disconnect cleanly.
    p = parse_dispatch_metadata("{ not valid json")
    assert not p.is_preview
    assert p.instructions == ""


def test_returns_empty_for_non_object_root():
    # JSON array / scalar — well-formed but the wrong shape.
    p = parse_dispatch_metadata("[1, 2, 3]")
    assert not p.is_preview
    assert p.instructions == ""


def test_instructions_echoed_verbatim_unicode_safe():
    prompt = "Du sprichst Deutsch. 🇩🇪\nAntworte kurz."
    raw = json.dumps(
        {
            "mode": "preview",
            "agentName": "x",
            "instructions_override": prompt,
        }
    )
    p = parse_dispatch_metadata(raw)
    assert p.instructions == prompt


def test_non_string_instructions_ignored():
    # Defensive: an upstream bug that sends a list instead of a string
    # shouldn't crash the worker — drop the field and surface "no prompt."
    raw = json.dumps(
        {
            "mode": "preview",
            "agentName": "x",
            "instructions_override": ["a", "b"],
        }
    )
    p = parse_dispatch_metadata(raw)
    assert p.is_preview  # mode is still preview
    assert p.instructions == ""  # but no prompt — entrypoint should disconnect


def test_voice_test_mode_is_not_preview():
    # The voice-test dispatch shape (ADR-014) reaches the same worker if
    # an operator misconfigures the dispatch name. The worker must not
    # silently treat it as a preview.
    raw = json.dumps(
        {
            "mode": "voice-test",
            "agentName": "buildpro_sam",
            "session_id": "s",
            "user_identifier": "c@e.com",
            "email": "c@e.com",
        }
    )
    p = parse_dispatch_metadata(raw)
    assert not p.is_preview
    assert p.mode == "voice-test"
    assert p.instructions == ""


def test_empty_instructions_string_is_treated_as_missing():
    # Edge case — operator sends ``""`` from the UI before pasting a prompt.
    # We don't need a separate "bad prompt" branch; the entrypoint just
    # checks ``instructions != ""``.
    raw = json.dumps(
        {
            "mode": "preview",
            "agentName": "x",
            "instructions_override": "",
        }
    )
    p = parse_dispatch_metadata(raw)
    assert p.is_preview
    assert p.instructions == ""
