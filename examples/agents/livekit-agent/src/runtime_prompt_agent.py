"""Runtime-prompt voice-test scenario (POC for ADR-015).

The dashboard "Sync & Test" flow lets an operator compile a prompt and
talk to the live LiveKit worker without redeploying it. To make that
work the worker has to load the latest prompt at dispatch time. This
file is the wiring:

- ``RuntimePromptAgent`` — a tiny subclass of ``BuildProAgent`` that
  takes its system instructions from an explicit constructor argument.
  Keeps the full BuildPro tool surface (cart, reorder, etc.) so the
  POC reuses the production MCP plumbing.

- ``select_agent_class(dispatch_metadata)`` — picks the agent class
  based on the room's dispatch metadata. Voice-test rooms (the
  ``"voice-test"`` mode with an ``mg_agent_id``) get the runtime-prompt
  agent; everything else stays on ``BuildProAgent``.

The actual prompt fetch lives in ``mg_client.fetch_compiled_instructions``
— this module only handles class selection and construction so the
fetch can be mocked / awaited independently in tests.
"""

from __future__ import annotations

import logging
from typing import Any

from buildpro import BuildProAgent

logger = logging.getLogger("runtime_prompt_agent")


class RuntimePromptAgent(BuildProAgent):
    """BuildPro agent that uses a runtime-supplied system prompt.

    Constructor takes an extra ``instructions`` argument. If it's empty
    or ``None`` we fall through to ``BuildProAgent``'s baked-in prompt
    so a fetch hiccup never strands the operator with a blank LLM.
    """

    def __init__(
        self,
        *,
        session_id: str | None,
        user_email: str,
        instructions: str | None = None,
        mcp: Any = None,
    ) -> None:
        # Build the BuildPro agent first so its prompts module is the
        # source of truth for the fallback. We then patch ``instructions``
        # after init when the caller supplied an override.
        super().__init__(session_id=session_id, user_email=user_email, mcp=mcp)
        if isinstance(instructions, str) and instructions.strip():
            # livekit.agents.Agent exposes ``instructions`` as a property
            # backed by ``_instructions``. Set both so anything that reads
            # the cached field also sees the runtime prompt.
            self._instructions = instructions
            logger.info(
                "RuntimePromptAgent using runtime-supplied prompt (%d chars)",
                len(instructions),
            )
        else:
            logger.info(
                "RuntimePromptAgent: no runtime prompt — falling back to baked-in BuildPro prompt"
            )

    @property
    def instructions(self) -> str:  # type: ignore[override]
        # Mirror livekit.agents.Agent's API — most call sites use the
        # property, but ``_instructions`` is what's actually stored.
        return self._instructions


def select_agent_class(dispatch_metadata: dict | None) -> type[BuildProAgent]:
    """Pick the agent class for a given dispatch.

    Voice-test dispatches (``mode == "voice-test"`` AND ``mg_agent_id``
    set) → ``RuntimePromptAgent`` so the worker fetches the latest
    compiled prompt. Everything else (inbound WebRTC, outbound SIP,
    direct ``lk dispatch``) → ``BuildProAgent`` so production traffic
    keeps using the baked-in prompt.
    """
    if not dispatch_metadata:
        return BuildProAgent
    if (
        dispatch_metadata.get("mode") == "voice-test"
        and dispatch_metadata.get("mg_agent_id")
    ):
        return RuntimePromptAgent
    return BuildProAgent
