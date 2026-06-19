"""Dispatch metadata parser for the prototype LiveKit worker.

This module is the *worker-side* half of the contract owned by
``buildPrototypeDispatchMetadata`` in the ModelGuide API
(``modelguide-api/src/features/agents/agents.service.ts``). The API
serializes the payload as JSON in the LiveKit job metadata; we parse it
back into a typed struct here.

Kept as a pure function with no LiveKit imports so it can be unit-tested
without the agents framework installed.
"""

from __future__ import annotations

import json
from dataclasses import dataclass


class DispatchError(ValueError):
    """Raised when the dispatch metadata is missing / malformed."""


@dataclass(frozen=True)
class PrototypeDispatch:
    mode: str
    agent_name: str
    session_id: str
    user_identifier: str
    email: str
    instructions: str


def parse_prototype_dispatch(raw_metadata: str | None) -> PrototypeDispatch:
    """Parse a JSON dispatch blob into a ``PrototypeDispatch``.

    Raises ``DispatchError`` with a human-readable message on any defect:
    missing metadata, malformed JSON, wrong ``mode`` value, or missing
    required fields. The error messages are intentionally specific so an
    operator triaging a silent room can grep the worker log and see
    exactly which contract field was violated.
    """
    if not raw_metadata:
        raise DispatchError("dispatch metadata is empty")

    try:
        payload = json.loads(raw_metadata)
    except json.JSONDecodeError as exc:
        raise DispatchError(f"dispatch metadata is not valid JSON: {exc}") from exc

    if not isinstance(payload, dict):
        raise DispatchError(
            f"dispatch metadata must be a JSON object, got {type(payload).__name__}"
        )

    mode = payload.get("mode")
    if mode != "prototype":
        raise DispatchError(
            f"unexpected dispatch mode {mode!r} — prototype worker only handles mode='prototype'"
        )

    required = ("agentName", "session_id", "user_identifier", "email", "instructions")
    missing = [f for f in required if f not in payload]
    if missing:
        raise DispatchError(
            f"dispatch metadata missing required fields: {', '.join(missing)}"
        )

    instructions = payload["instructions"]
    if not isinstance(instructions, str) or not instructions.strip():
        raise DispatchError("dispatch metadata `instructions` must be a non-empty string")

    return PrototypeDispatch(
        mode=mode,
        agent_name=str(payload["agentName"]),
        session_id=str(payload["session_id"]),
        user_identifier=str(payload["user_identifier"]),
        email=str(payload["email"]),
        instructions=instructions,
    )
