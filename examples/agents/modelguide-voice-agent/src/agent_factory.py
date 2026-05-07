"""Helpers for assembling the LiveKit ``Agent`` instance from a runtime config.

Kept in a separate module from ``agent.py`` so it stays unit-testable
without importing the full ``livekit.agents`` machinery.
"""

from __future__ import annotations

from runtime_config import RuntimeConfig

FALLBACK_INSTRUCTIONS = (
    "You are a friendly voice assistant connected to ModelGuide. "
    "The dashboard hasn't compiled a prompt for this agent yet, so keep "
    "answers brief and let the caller know to compile a SOP first."
)


def resolve_instructions(
    *,
    runtime: RuntimeConfig | None,
    env_default: str | None,
) -> str:
    """Pick the system prompt with a clear precedence order.

    1. Compiled prompt from ModelGuide — the dashboard is the source of
       truth.
    2. ``DEFAULT_INSTRUCTIONS`` env var — a local-dev escape hatch.
    3. Built-in ``FALLBACK_INSTRUCTIONS`` — so the worker always boots.
    """
    if runtime and runtime.has_compiled_prompt:
        # has_compiled_prompt already filtered out empty/whitespace, so
        # ``runtime.instructions`` is a non-trivial string here.
        assert runtime.instructions is not None
        return runtime.instructions
    if env_default and env_default.strip():
        return env_default
    return FALLBACK_INSTRUCTIONS
