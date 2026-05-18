"""Dispatch-metadata parsing for the preview worker.

Extracted so the contract — "mode == preview, instructions_override is the
prompt under test" — is covered by pure unit tests instead of living only
inside the worker entrypoint. The mirroring TypeScript contract lives in
``modelguide-api/src/features/agents/agents.service.ts::buildPreviewDispatchMetadata``
and is locked behind ``tests/unit/agents/preview-voice-dispatch.test.ts``.

If either side drifts, a preview dispatch silently misses its prompt and
the operator hears the worker's empty-prompt fallback instead of what they
just compiled. This module is the worker-side guard.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass

logger = logging.getLogger("preview.dispatch")


@dataclass(frozen=True)
class PreviewDispatch:
    """Parsed preview-dispatch payload.

    ``instructions`` is the prompt the worker will feed to the LLM. If
    parsing fails or the payload is missing/invalid, ``instructions`` is
    an empty string — the entrypoint logs and bails rather than dispatching
    a worker with no prompt (which would produce a confusing voice agent
    that defaults to whatever the LLM's training data wants to talk about).
    """

    mode: str
    agent_name: str
    session_id: str | None
    user_identifier: str | None
    email: str | None
    instructions: str

    @property
    def is_preview(self) -> bool:
        return self.mode == "preview"


_EMPTY = PreviewDispatch(
    mode="",
    agent_name="",
    session_id=None,
    user_identifier=None,
    email=None,
    instructions="",
)


def parse_dispatch_metadata(raw: str | None) -> PreviewDispatch:
    """Parse the JSON dispatch metadata into a typed payload.

    Returns an empty payload (``is_preview == False``, ``instructions == ""``)
    when ``raw`` is missing, malformed, or has the wrong shape. The caller
    decides what to do — for a preview worker, the right thing is to log
    the rejection and disconnect, not to limp along with garbage.
    """
    if not raw:
        return _EMPTY
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        logger.warning(
            "Dispatch metadata is not valid JSON; first 100 chars: %s",
            raw[:100],
        )
        return _EMPTY
    if not isinstance(data, dict):
        logger.warning(
            "Dispatch metadata is not a JSON object (got %s)",
            type(data).__name__,
        )
        return _EMPTY

    instructions = data.get("instructions_override")
    if instructions is not None and not isinstance(instructions, str):
        logger.warning(
            "instructions_override is not a string (got %s); ignoring",
            type(instructions).__name__,
        )
        instructions = None

    return PreviewDispatch(
        mode=str(data.get("mode") or ""),
        agent_name=str(data.get("agentName") or ""),
        session_id=_optional_str(data.get("session_id")),
        user_identifier=_optional_str(data.get("user_identifier")),
        email=_optional_str(data.get("email")),
        instructions=instructions or "",
    )


def _optional_str(value: object) -> str | None:
    if value is None:
        return None
    if isinstance(value, str):
        return value
    return str(value)
