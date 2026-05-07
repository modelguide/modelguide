"""Parse the JSON metadata that ModelGuide attaches to each LiveKit dispatch.

Contract is defined on the API side in
``modelguide-api/src/features/agents/agents.service.ts:buildVoiceTestDispatchMetadata``
— there's no shared schema, so we keep this file small and keep the test
suite (``tests/test_dispatch.py``) honest.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass

logger = logging.getLogger("dispatch")


@dataclass(frozen=True)
class DispatchMetadata:
    agent_id: str | None
    agent_slug: str | None
    session_id: str | None
    caller_email: str | None
    mode: str | None


def parse_dispatch_metadata(raw: str | None) -> DispatchMetadata | None:
    """Decode dispatch metadata. Returns None for missing/invalid input.

    Returning None (rather than raising) is deliberate — a malformed payload
    shouldn't take down the worker; the caller can fall back to env-config
    so a human can still join the room and triage.
    """
    if not raw:
        return None

    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        logger.warning("Invalid JSON in dispatch metadata: %s", raw[:120])
        return None

    if not isinstance(data, dict):
        logger.warning("Dispatch metadata is not a JSON object: %r", type(data))
        return None

    return DispatchMetadata(
        agent_id=data.get("agentId"),
        agent_slug=data.get("agentName"),
        session_id=data.get("session_id"),
        caller_email=data.get("email") or data.get("user_identifier"),
        mode=data.get("mode"),
    )
