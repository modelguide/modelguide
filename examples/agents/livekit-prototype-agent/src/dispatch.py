"""Parser for the LiveKit dispatch metadata blob.

The ModelGuide API stuffs a JSON object into ``ctx.job.metadata`` when it
dispatches a worker. We need a tiny, defensive parser:

- Voice-test calls carry ``{mode: "voice-test", agentName, session_id, …}``
- Outbound calls carry ``{mode: "outbound", phone_number, …}``
- Inbound / WebRTC calls without a dispatch can have empty metadata

Producers live in ``modelguide-api/src/features/agents/agents.service.ts``
(``buildVoiceTestDispatchMetadata`` / ``buildOutboundDispatchMetadata``).
"""

from __future__ import annotations

import json
from dataclasses import dataclass


@dataclass(frozen=True)
class DispatchMeta:
    mode: str | None
    agent_slug: str | None
    session_id: str | None
    user_identifier: str | None
    phone_number: str | None


def parse_dispatch_metadata(raw: str | None) -> DispatchMeta:
    if not raw:
        return DispatchMeta(None, None, None, None, None)

    try:
        data = json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        # Defence in depth — only the API writes this blob, but a malformed
        # value shouldn't crash the worker before the LLM gets a chance to
        # greet the caller.
        return DispatchMeta(None, None, None, None, None)

    if not isinstance(data, dict):
        return DispatchMeta(None, None, None, None, None)

    return DispatchMeta(
        mode=data.get("mode"),
        agent_slug=data.get("agentName"),
        session_id=data.get("session_id"),
        user_identifier=data.get("user_identifier"),
        phone_number=data.get("phone_number"),
    )
