"""Parse the LiveKit dispatch metadata blob into a typed context.

The voice-test endpoint in ``modelguide-api`` ships the following JSON
shape as ``job.metadata`` (see ``buildVoiceTestDispatchMetadata`` and
ADR-014 / ADR-015):

    {
      "mode": "voice-test",
      "agentName": "<agent.slug>",
      "session_id": "<modelguide session id>",
      "user_identifier": "<caller email>",
      "email": "<caller email>",
      "instructions": "<compiled prompt, optional>"
    }

The prompt resolution lives in ``prompt_resolver.py``. This module
extracts the caller-context fields so the entrypoint can use them to
join the ModelGuide session and post the transcript on hangup.

Resilient to: missing metadata, malformed JSON, unexpected types. The
worker should never crash on a bad metadata blob — it should log loudly
and proceed with whatever fields it could parse.
"""

from __future__ import annotations

import json
from dataclasses import dataclass


@dataclass(frozen=True)
class DispatchContext:
    """Caller-side context decoded from LiveKit job metadata.

    All fields are optional because:
    - Local ``lk dispatch`` calls during dev may omit metadata entirely.
    - A future dispatcher may evolve the shape; defensive parsing keeps
      the worker booting on unknown shapes.

    The fields here intentionally do NOT include ``instructions`` — that
    is owned by ``prompt_resolver.py`` so the two concerns stay testable
    in isolation.
    """

    session_id: str | None
    user_identifier: str | None
    agent_name: str | None
    mode: str | None


def _str_or_none(value: object) -> str | None:
    """Return ``value`` when it's a string, ``None`` otherwise. Used to
    defend against non-string values for fields that the API contract
    declares as strings."""
    return value if isinstance(value, str) else None


def parse_dispatch_context(metadata_json: str | None) -> DispatchContext:
    """Decode the dispatch metadata blob into a ``DispatchContext``.

    Never raises. Returns an all-``None`` context for missing or
    malformed metadata so the entrypoint can decide how to log / fall
    back.
    """
    if not metadata_json:
        return _empty_context()

    try:
        parsed = json.loads(metadata_json)
    except (json.JSONDecodeError, TypeError, ValueError):
        return _empty_context()

    if not isinstance(parsed, dict):
        return _empty_context()

    # Prefer `user_identifier` (current contract) and fall back to
    # `email` for compatibility with older callers / quick smoke tests.
    user = _str_or_none(parsed.get("user_identifier")) or _str_or_none(
        parsed.get("email")
    )

    return DispatchContext(
        session_id=_str_or_none(parsed.get("session_id")),
        user_identifier=user,
        agent_name=_str_or_none(parsed.get("agentName")),
        mode=_str_or_none(parsed.get("mode")),
    )


def _empty_context() -> DispatchContext:
    return DispatchContext(
        session_id=None, user_identifier=None, agent_name=None, mode=None
    )
