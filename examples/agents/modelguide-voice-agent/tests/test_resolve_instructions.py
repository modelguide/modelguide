"""Tests for ``resolve_instructions`` — the small precedence helper that
chooses what system prompt to hand the LLM.

Precedence (highest first):

1. Compiled prompt fetched from ModelGuide (the whole point of this POC).
2. ``DEFAULT_INSTRUCTIONS`` env override (escape hatch for local dev).
3. Built-in fallback so the worker always has *something* to say even
   when ModelGuide is unreachable on first boot.

Locking this in as a unit test because the LiveKit AgentSession picks up
``instructions`` exactly once at construction — there's no second chance
to fix a wrong choice without disconnecting the caller.
"""

from runtime_config import RuntimeConfig
from agent_factory import FALLBACK_INSTRUCTIONS, resolve_instructions


def _cfg(instructions):
    return RuntimeConfig(
        id="a",
        slug="s",
        name="n",
        modality="voice",
        model_family="gpt",
        instructions=instructions,
        compiled_at=None,
    )


class TestResolveInstructions:
    def test_uses_compiled_prompt_when_available(self):
        result = resolve_instructions(
            runtime=_cfg("Compiled prompt."),
            env_default=None,
        )
        assert result == "Compiled prompt."

    def test_compiled_prompt_wins_over_env_default(self):
        # The dashboard is the source of truth; env defaults exist only so
        # the worker can boot before the agent has ever been compiled.
        result = resolve_instructions(
            runtime=_cfg("Compiled."),
            env_default="Env override.",
        )
        assert result == "Compiled."

    def test_falls_back_to_env_default_when_uncompiled(self):
        result = resolve_instructions(
            runtime=_cfg(None),
            env_default="Env override.",
        )
        assert result == "Env override."

    def test_falls_back_to_builtin_when_no_runtime_and_no_env(self):
        result = resolve_instructions(runtime=None, env_default=None)
        assert result == FALLBACK_INSTRUCTIONS

    def test_falls_back_to_builtin_when_runtime_uncompiled_and_no_env(self):
        result = resolve_instructions(runtime=_cfg(None), env_default=None)
        assert result == FALLBACK_INSTRUCTIONS

    def test_treats_empty_compiled_prompt_as_uncompiled(self):
        # A whitespace-only compiled prompt would tell the LLM nothing
        # useful; treat it the same as None and fall through.
        result = resolve_instructions(
            runtime=_cfg("   \n  "),
            env_default="Env override.",
        )
        assert result == "Env override."
