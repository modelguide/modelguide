"""Worker-side helper for ADR-015 voice-test prompt override.

The ModelGuide API attaches an optional ``compiledInstructions`` field
to dispatch metadata when an admin clicks "Talk to agent" on a freshly
compiled prompt. This module decides whether to honor it or fall back
to the baked profile prompt.

Cross-reference: the producer side lives in
``modelguide-api/src/features/agents/agents.service.ts`` —
``buildVoiceTestDispatchMetadata``. The contract is locked by tests on
both sides.

The override is a *single-session* swap. The worker's profile prompt
remains the canonical source of truth — we just let an operator point
that single dispatched session at a different system prompt for fast
iteration.
"""

from __future__ import annotations

from typing import Optional


def resolve_instructions(dispatch_metadata: Optional[dict], baked_prompt: str) -> str:
    """Return the system prompt for this session.

    Args:
        dispatch_metadata: The parsed JSON metadata from
            ``ctx.job.metadata`` (may be ``None`` if the job carried no
            metadata, or a dict with the field absent).
        baked_prompt: The profile's compiled-into-the-image prompt.
            Used when no override is present.

    Returns:
        The override when ``dispatch_metadata["compiledInstructions"]`` is
        a non-empty, non-whitespace string. Otherwise ``baked_prompt``.

    Notes:
        - Empty / whitespace-only strings fall back. A blank prompt
          would mute the agent — far worse than running on the baked
          prompt.
        - Non-string values fall back. Bogus payloads are treated the
          same as a missing field.
    """
    if not dispatch_metadata:
        return baked_prompt

    override = dispatch_metadata.get("compiledInstructions")
    if not isinstance(override, str):
        return baked_prompt
    if not override.strip():
        return baked_prompt
    return override
