"""Parser + fallbacks for `GET /api/agents/me`.

Pure module — no I/O. The transport layer lives in `mg_client.py`.

The wire shape is locked by the TypeScript helper
`formatAgentRuntimeConfig` in
`modelguide-api/src/features/agents/agents.service.ts`. If you change a
field name on this side, change it on the other side (and vice versa) —
there's no shared type system across the boundary.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class RuntimeConfig:
    id: str
    slug: str
    name: str
    modality: str
    model_family: str
    agent_platform: str
    is_active: bool
    persona: str
    compiled_instructions: str | None
    compiled_at: str | None


def parse_runtime_config(payload: dict[str, Any]) -> RuntimeConfig:
    """Convert a `/api/agents/me` response into a typed RuntimeConfig.

    Pulls `persona` out of `promptConfig` so callers don't dig through nested
    dicts. Everything else is a 1:1 mapping with the wire field.
    """
    prompt_config = payload.get("promptConfig") or {}
    persona = prompt_config.get("persona") or ""

    return RuntimeConfig(
        id=payload["id"],
        slug=payload["slug"],
        name=payload["name"],
        modality=payload["modality"],
        model_family=payload["modelFamily"],
        agent_platform=payload["agentPlatform"],
        is_active=bool(payload.get("isActive", True)),
        persona=persona,
        compiled_instructions=payload.get("compiledInstructions"),
        compiled_at=payload.get("compiledAt"),
    )


def build_session_instructions(cfg: RuntimeConfig) -> str:
    """Pick the right text to seed the LLM with as the system prompt.

    Priority:
      1. ``compiledInstructions`` — what the operator clicked Compile on.
      2. ``promptConfig.persona`` — soft fallback if nothing is compiled yet
         (still useful during initial bring-up).
      3. Generic identity blurb so the agent doesn't boot mute.

    The fallback chain is deliberate so the worker can always boot something
    coherent — silence is a worse failure mode than a generic greeting.
    """
    if cfg.compiled_instructions and cfg.compiled_instructions.strip():
        return cfg.compiled_instructions

    if cfg.persona and cfg.persona.strip():
        return (
            f"You are {cfg.name}, a voice assistant.\n\n"
            f"Persona: {cfg.persona}\n\n"
            "The operator hasn't compiled a prompt yet — keep responses short "
            "and ask the caller what they need."
        )

    return (
        f"You are {cfg.name}, a voice assistant. The operator hasn't yet "
        "configured your prompt. Greet the caller politely and ask what they "
        "need help with. Keep responses brief."
    )
