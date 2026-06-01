"""Dispatch-metadata parser for the livekit-poc worker.

Reads the JSON blob LiveKit hands to ``entrypoint(ctx)`` via
``ctx.job.metadata`` and produces a typed view of just the fields the POC
cares about. The TS-side contract is enforced by
``modelguide-api/tests/unit/agents/voice-test-dispatch.test.ts``; the
Python-side contract is in ``tests/test_metadata.py``.

Design notes:

- Empty strings collapse to ``None`` on purpose. An empty ``instructions``
  string would silently put the LLM in "no system prompt" mode, which is
  worse than falling back to the worker's baked-in default. The TS side
  drops empty strings before serialising, but this layer enforces the
  invariant locally too — the parser is the last line of defence.
- Malformed JSON does not crash the worker. A worker that comes up halfway
  and then logs a parse error is still inspectable; a worker that never
  starts is just a silent room from the user's perspective.
- ``parse_error`` is surfaced (rather than re-raised) so the agent can
  attach it to the LiveKit room metadata for debugging without losing
  the original exception.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from typing import Any

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class DispatchMetadata:
    """Typed view of the dispatch metadata blob.

    Every field is optional because the same parser handles voice-test,
    outbound, and "no metadata at all" (e.g. ``lk dispatch create`` without
    --metadata). Each consumer reads only what it needs and falls back to
    a default when missing.
    """

    mode: str | None = None
    agent_name: str | None = None
    session_id: str | None = None
    user_identifier: str | None = None
    email: str | None = None
    instructions: str | None = None
    greeting: str | None = None
    phone_number: str | None = None
    parse_error: str | None = None


def _clean_string(value: Any) -> str | None:
    """Coerce a metadata value to a usable string or ``None``.

    Treats non-strings, empty strings, and whitespace-only strings as
    "not provided" so the worker can use ``if md.instructions:`` as a
    single truthy check at the call site.
    """
    if not isinstance(value, str):
        return None
    stripped = value.strip()
    return value if stripped else None


def parse_dispatch_metadata(raw: str | None) -> DispatchMetadata:
    """Parse the JSON blob LiveKit attaches to the dispatch job.

    Returns an empty ``DispatchMetadata`` if the blob is missing or
    malformed — the worker is expected to fall back to its own defaults
    rather than refuse to run.
    """
    if not raw:
        return DispatchMetadata()

    try:
        payload = json.loads(raw)
    except (json.JSONDecodeError, TypeError) as err:
        # We deliberately don't re-raise. A worker that comes up with
        # defaults and logs an error is recoverable; a worker that crashes
        # before LiveKit's connection sequence finishes is invisible.
        logger.warning("dispatch metadata is not valid JSON: %s", err)
        return DispatchMetadata(parse_error=str(err))

    if not isinstance(payload, dict):
        logger.warning(
            "dispatch metadata root is %s, expected object", type(payload).__name__,
        )
        return DispatchMetadata(parse_error="root is not an object")

    return DispatchMetadata(
        mode=_clean_string(payload.get("mode")),
        agent_name=_clean_string(payload.get("agentName")),
        session_id=_clean_string(payload.get("session_id")),
        user_identifier=_clean_string(payload.get("user_identifier")),
        email=_clean_string(payload.get("email")),
        instructions=_clean_string(payload.get("instructions")),
        greeting=_clean_string(payload.get("greeting")),
        phone_number=_clean_string(payload.get("phone_number")),
    )
