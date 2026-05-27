"""Voice agent whose system prompt is loaded at runtime from ModelGuide.

The class itself is intentionally a thin holder of
``(session_id, instructions, transcript)``. The interesting work — fetch
the compiled prompt, mint a session, run the audio loop — happens in
``main.py``. Keeping this class tiny makes it easy to unit-test without
spinning up a LiveKit session.

For an agent that ALSO calls MCP tools (e.g. add_to_cart, get_order),
add ``@function_tool`` methods on a subclass and route to MCP from there
— the same pattern as the buildpro example's ``BuildProAgent``. For
this prototype we focus only on the prompt loop so the diff is small.
"""

from __future__ import annotations

from typing import Optional

from transcript import TranscriptCollector

# Defensive import: the livekit-agents package isn't installed in the
# bare unit-test environment (CI's pytest run has it, but a one-off
# `python -m pytest tests/` on a freshly cloned repo doesn't need to
# bring in the LiveKit runtime just to verify construction). Fall back
# to a minimal stand-in that holds the same ``instructions`` attribute
# the LiveKit Agent exposes.
try:
    from livekit.agents import Agent as _LiveKitAgent  # type: ignore
except ImportError:  # pragma: no cover — exercised only in bare envs
    class _LiveKitAgent:  # type: ignore[no-redef]
        def __init__(self, *, instructions: str) -> None:
            self.instructions = instructions


class DynamicAgent(_LiveKitAgent):
    """LiveKit ``Agent`` with a runtime-supplied system prompt.

    The prompt comes from ``prompt_loader.load_prompt`` in the entrypoint
    — by the time the agent is constructed, the string is already
    finalized. This class doesn't do any I/O.
    """

    def __init__(
        self,
        *,
        session_id: Optional[str],
        instructions: str,
    ) -> None:
        self.session_id = session_id
        self.transcript = TranscriptCollector()
        super().__init__(instructions=instructions)
