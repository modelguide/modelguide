"""Dispatch-metadata helpers — pure, no livekit imports.

The LiveKit worker reads a JSON metadata blob from ``ctx.job.metadata`` on
each dispatch. The MG side puts a small contract there (mode, agentName,
session_id, user_identifier, email — see
``modelguide-api/src/features/agents/agents.service.ts``
``buildVoiceTestDispatchMetadata``).

For the Prompt Lab POC (ADR-015), the MG side may also pass
``prompt_override``. When present, the worker uses that string as the
agent's instructions for this one session instead of the baked-in profile
prompt. Everything in this file is the worker-side read half of that
contract. Keeping it pure means it's unit-testable without livekit
installed, the same way the MG side has a pure unit test on the build
half.
"""

from __future__ import annotations

from typing import Any, Callable


def extract_prompt_override(metadata: dict | None) -> str | None:
    """Return a usable Prompt Lab override, or ``None`` to fall back.

    Defensive against:
    - ``None`` / missing ``metadata`` (older MG, no override path)
    - non-string values (type-mismatched payload — we'd rather fall back
      than start the agent with garbage instructions)
    - empty / whitespace-only strings (MG-side validation rejects these,
      but if a stale MG forwards an empty string, ignore it cleanly)
    """
    if not isinstance(metadata, dict):
        return None
    value: Any = metadata.get("prompt_override")
    if not isinstance(value, str):
        return None
    if not value.strip():
        return None
    return value


def select_instructions(
    *, override: str | None, default_factory: Callable[[], str]
) -> str:
    """Pick the instructions string — override wins; otherwise build default.

    ``default_factory`` is lazy on purpose: building the baked-in prompt
    can involve file I/O and string assembly. A Prompt Lab caller has
    already supplied the full instructions, so we skip the work entirely
    when ``override`` is set.
    """
    if override is not None:
        return override
    return default_factory()
