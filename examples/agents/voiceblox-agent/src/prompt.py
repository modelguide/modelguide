"""Prompt assembly for the voiceblox prototype.

The runtime endpoint (``GET /api/agents/me/runtime``) returns the compiled
system prompt verbatim — already SOP-merged, guardrail-merged, the works.
All we do here is:

1. Pick the right base (compiled vs. fallback).
2. Splice in tiny runtime tokens (session id, caller identity) so the LLM
   knows who it's talking to without us having to re-prompt mid-call.
3. Add a brief persona / language shim if the prompt_config has one — this
   lets a dashboard user tune voice without recompiling the SOPs.

Kept in its own module so the assembly logic is unit-testable without
booting LiveKit or httpx.
"""

from __future__ import annotations

from typing import Any

import config


def build_system_prompt(
    *,
    compiled_instructions: str | None,
    prompt_config: dict[str, Any] | None,
    session_id: str | None,
    user_identifier: str,
) -> str:
    """Combine the API-fetched prompt with runtime context.

    A compiled prompt takes precedence over ``FALLBACK_PROMPT``. The
    optional persona/language config from the dashboard is appended as a
    short "Voice style" note so it influences delivery without overriding
    the SOP-driven body.
    """
    base = (compiled_instructions or "").strip() or config.FALLBACK_PROMPT
    parts: list[str] = [base]

    pc = prompt_config or {}
    persona = (pc.get("persona") or "").strip()
    language = (pc.get("language") or "").strip()
    fillers = pc.get("fillerPhrases") or []

    style_lines: list[str] = []
    if persona:
        style_lines.append(f"Persona: {persona}")
    if language:
        style_lines.append(f"Language: {language}")
    if fillers:
        # Trim to a small set — voice prompts get bloated fast.
        sample = ", ".join(repr(f) for f in fillers[:5])
        style_lines.append(f"Filler phrases you may use: {sample}")

    if style_lines:
        parts.append("# Voice style\n\n" + "\n".join(style_lines))

    context_lines = [f"Caller identifier: {user_identifier}"]
    if session_id:
        context_lines.append(f"ModelGuide session id: {session_id}")
    parts.append("# Runtime context\n\n" + "\n".join(context_lines))

    return "\n\n".join(parts)


def build_greeting(template: str, user_identifier: str) -> str:
    """Format the spoken greeting.

    Uses the first segment of an email-shaped identifier so the agent
    doesn't greet someone as "alice@corp.example.com" — that's an instant
    "I'm a bot" tell. Falls back to "there" for callers with no useful
    identifier.
    """
    name = user_identifier or "there"
    if "@" in name:
        name = name.split("@", 1)[0]
    if not name or name in {"voice-caller", "anonymous", "unknown"}:
        name = "there"
    try:
        return template.format(name=name)
    except (KeyError, IndexError):
        # Operator-supplied template might not include {name}; just spit it out.
        return template
