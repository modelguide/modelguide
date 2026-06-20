"""Resolve the system prompt for a single voice-test session.

Resolution order (highest priority wins):

1. ``override`` — an explicit caller-provided prompt. Used by tests and
   the ``connect --metadata '{...}'`` developer ergonomics path.
2. ``instructions`` — read from the LiveKit job dispatch metadata.
   ModelGuide's ``buildVoiceTestDispatchMetadata`` puts the agent's
   ``compiledInstructions`` here when present (see ADR-015).
3. ``DEFAULT_INSTRUCTIONS`` — the baked-in fallback so the worker still
   boots when no override is provided (local dev, malformed metadata,
   pre-ADR-015 callers).

The resolver is pure: no I/O, no env-var reads, no logging. The caller
logs ``PromptResolution.source`` once at session start so an operator
can tell at a glance whether they are testing the latest compiled prompt
or the worker's fallback.

This file is the worker half of the ADR-015 contract. The API half lives
in ``modelguide-api/src/features/agents/agents.service.ts`` —
``buildVoiceTestDispatchMetadata``. The two files are coupled only by
the JSON field name ``instructions``; keep them in sync.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Literal

# Kept short on purpose: this is a fallback for the "we didn't get a
# compiled prompt" path. Real agents should rely on the ModelGuide
# compiler, not on this string. Stays in voice-mode rules (no
# markdown / code blocks / emojis) since the LLM output goes straight
# to TTS.
DEFAULT_INSTRUCTIONS = (
    "You are a friendly voice assistant powering the ModelGuide livekit-poc "
    "prototype. Speak in short, conversational sentences. Do not use "
    "markdown, code blocks, or emojis — your output goes directly to text "
    "to speech. If the caller asks who you are, say you are a prototype "
    "voice agent running on ModelGuide and that no compiled prompt was "
    "provided for this session."
)

Source = Literal["override", "dispatch_metadata", "default"]


@dataclass(frozen=True)
class PromptResolution:
    """Result of resolving the system prompt for a session.

    ``instructions`` is the string handed to the LLM as the system message.
    ``source`` is a short tag so the worker can log "instructions source =
    dispatch_metadata" at session start — useful when triaging "why didn't
    my latest compiled prompt take effect" reports.
    """

    instructions: str
    source: Source


def _coerce_metadata(metadata_json: str | None) -> dict:
    """Best-effort parse of the metadata JSON blob. Returns ``{}`` on any
    structural failure so the caller can treat "malformed" the same as
    "missing"."""
    if not metadata_json:
        return {}
    try:
        parsed = json.loads(metadata_json)
    except (json.JSONDecodeError, TypeError, ValueError):
        return {}
    if not isinstance(parsed, dict):
        return {}
    return parsed


def _non_empty_string(value: object) -> str | None:
    """Return ``value`` only if it is a non-whitespace string. Anything
    else (None, list, dict, number, empty string) becomes ``None``."""
    if not isinstance(value, str):
        return None
    if value.strip() == "":
        return None
    return value


def resolve_instructions(
    *,
    metadata_json: str | None,
    override: str | None = None,
) -> PromptResolution:
    """Resolve the session's system prompt.

    Args:
        metadata_json: The LiveKit ``job.metadata`` blob (a JSON string)
            or ``None`` if the job has no metadata.
        override: An explicit instructions string from the caller. Wins
            over dispatch metadata when non-empty. Used by tests and the
            ``connect --metadata`` developer ergonomics path.
    """
    explicit = _non_empty_string(override)
    if explicit is not None:
        return PromptResolution(instructions=explicit, source="override")

    metadata = _coerce_metadata(metadata_json)
    from_dispatch = _non_empty_string(metadata.get("instructions"))
    if from_dispatch is not None:
        return PromptResolution(
            instructions=from_dispatch, source="dispatch_metadata"
        )

    return PromptResolution(instructions=DEFAULT_INSTRUCTIONS, source="default")
