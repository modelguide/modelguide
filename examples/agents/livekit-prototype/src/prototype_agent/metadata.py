"""Dispatch-metadata parsing — the cross-language prompt-injection contract.

The MG API endpoint `POST /api/agents/:id/prototype-voice-test-token` builds
the metadata via `buildPrototypeDispatchMetadata` (TypeScript). Both sides are
covered by their own unit tests; this module is the Python side.

Wire shape (JSON-encoded string in `JobContext.job.metadata`):

    {
      "mode":            "voice-test-prototype",
      "agentName":       "<agent slug>",
      "instructions":    "<compiled system prompt>",   # required, non-empty
      "session_id":      "<modelguide session uuid>",  # optional
      "user_identifier": "<caller email>",             # falls back to email
      "email":           "<caller email>"
    }

Field renames or shape changes break the prototype flow silently — the worker
will fail to start a session and the browser will sit on "Waking up agent…"
until the 15s timeout. Cross-language contract → unit-tested on both sides.
"""

from __future__ import annotations

import json
from dataclasses import dataclass


class InvalidDispatchMetadataError(ValueError):
    """Raised when the dispatch-metadata blob is missing, unparseable, or
    missing required fields. Caller should refuse to start the session."""


@dataclass(frozen=True)
class DispatchMetadata:
    agent_name: str
    instructions: str
    session_id: str | None
    user_identifier: str
    email: str | None
    mode: str


def parse_dispatch_metadata(raw: str | None) -> DispatchMetadata:
    """Parse the JSON dispatch-metadata blob from `JobContext.job.metadata`.

    Raises:
        InvalidDispatchMetadataError: if the payload is missing, not valid
        JSON, not an object, or missing required fields (`agentName`,
        `instructions`).
    """
    if not raw:
        raise InvalidDispatchMetadataError(
            "dispatch metadata is empty — prototype worker requires a JSON payload"
        )

    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise InvalidDispatchMetadataError(
            f"dispatch metadata is not valid JSON: {exc}"
        ) from exc

    if not isinstance(data, dict):
        raise InvalidDispatchMetadataError(
            "dispatch metadata must be a JSON object at the top level"
        )

    agent_name = data.get("agentName")
    if not isinstance(agent_name, str) or not agent_name:
        raise InvalidDispatchMetadataError(
            "dispatch metadata is missing required field `agentName`"
        )

    instructions = data.get("instructions")
    if (
        not isinstance(instructions, str)
        or not instructions
        or not instructions.strip()
    ):
        raise InvalidDispatchMetadataError(
            "dispatch metadata is missing or empty required field `instructions`"
        )

    email = data.get("email")
    if email is not None and not isinstance(email, str):
        email = None

    user_identifier = data.get("user_identifier")
    if not isinstance(user_identifier, str) or not user_identifier:
        # Fall back to email so the worker still has a stable identity.
        user_identifier = email or "anonymous"

    session_id = data.get("session_id")
    if session_id is not None and not isinstance(session_id, str):
        session_id = None

    mode = data.get("mode")
    if not isinstance(mode, str):
        mode = "voice-test-prototype"

    return DispatchMetadata(
        agent_name=agent_name,
        instructions=instructions,
        session_id=session_id,
        user_identifier=user_identifier,
        email=email,
        mode=mode,
    )
