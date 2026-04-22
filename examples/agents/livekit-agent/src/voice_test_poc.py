"""Voice-test POC (prompt-injection) — worker-side contract.

The ModelGuide API's ``/voice-test-poc-token`` endpoint dispatches this
worker with dispatch metadata that looks like::

    {
      "mode": "voice-test-poc",
      "agentName": "<agent_slug>",
      "session_id": "<uuid>",
      "user_identifier": "<email>",
      "email": "<email>",
      "compiled_instructions": "<the freshly compiled system prompt>"
    }

In that mode, the worker runs with ``compiled_instructions`` as the agent's
instructions instead of the baked-in profile default. In every other mode
(prod voice-test, outbound SIP, legacy dispatches) the worker falls back to
the default — silent-empty-override is the scariest failure, so we err on
the side of "use what we know works" whenever anything looks off.

See ADR-015. Mirror test: tests/test_voice_test_poc.py.
"""

from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger("voice_test_poc")

POC_MODE = "voice-test-poc"


def resolve_instructions(metadata: dict[str, Any] | None, *, default: str) -> str:
    """Return the system prompt to run with for this dispatch.

    - If ``metadata["mode"] == "voice-test-poc"`` AND ``compiled_instructions``
      is a non-empty string, return it (prompt override).
    - Otherwise return ``default`` (worker's baked-in prompt).

    The return is guaranteed to be a ``str`` so callers can pass it directly
    to ``Agent(instructions=...)``.
    """
    if not isinstance(metadata, dict):
        return default

    if metadata.get("mode") != POC_MODE:
        return default

    override = metadata.get("compiled_instructions")
    if not isinstance(override, str) or not override.strip():
        logger.warning(
            "voice-test-poc dispatch missing or blank compiled_instructions — "
            "falling back to baked prompt"
        )
        return default

    logger.info(
        "voice-test-poc: using injected prompt (%d chars) instead of baked default",
        len(override),
    )
    return override
