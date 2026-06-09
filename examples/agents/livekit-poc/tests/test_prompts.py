"""Tests for prompt assembly.

`build_session_instructions` is the function that turns whatever the
runtime-config endpoint returned into the actual system prompt the LLM
sees. It has two failure modes that matter:

1. ModelGuide hands back `instructions=None` (agent never compiled) —
   the worker must still come up with a usable prompt or the LLM does
   nothing.
2. The endpoint returns a compiled prompt — that compiled string is the
   single source of truth and must not be silently overridden by
   defaults.
"""

import prompts


class TestBuildSessionInstructions:
    def test_uses_compiled_instructions_verbatim_when_present(self):
        compiled = "You are Sam. Greet every caller with 'Welcome to BuildPro.'"
        config = {
            "id": "agt_x",
            "name": "Sam",
            "instructions": compiled,
            "promptConfig": {},
        }
        result = prompts.build_session_instructions(config)
        # The compiled prompt is the single source of truth. The worker
        # must hand it to the LLM unchanged — no prepending, no wrapping,
        # no merging with promptConfig.
        assert result == compiled

    def test_falls_back_to_default_when_instructions_missing(self):
        # Agent exists but no compiled prompt yet (`instructions: None`).
        # The worker should not hand the LLM an empty string — that
        # bricks the session.
        config = {
            "id": "agt_x",
            "name": "Sam",
            "instructions": None,
            "promptConfig": {},
        }
        result = prompts.build_session_instructions(config)
        assert result, "Default prompt must be non-empty"
        assert prompts.DEFAULT_PROMPT in result

    def test_falls_back_to_default_when_config_is_none(self):
        # Endpoint unreachable / errored — runtime config is `None`.
        result = prompts.build_session_instructions(None)
        assert result == prompts.DEFAULT_PROMPT

    def test_fallback_includes_agent_name_when_available(self):
        # A bare default is fine, but if we know the agent's name, use it
        # so the LLM doesn't introduce itself as "an AI assistant".
        config = {
            "id": "agt_x",
            "name": "Sam",
            "instructions": None,
            "promptConfig": {},
        }
        result = prompts.build_session_instructions(config)
        assert "Sam" in result

    def test_compiled_instructions_take_precedence_over_promptconfig(self):
        # Regression guard: someone might "helpfully" merge promptConfig
        # into the compiled string. Don't. The compiler already did that.
        config = {
            "id": "agt_x",
            "name": "Sam",
            "instructions": "MUST_BE_VERBATIM",
            "promptConfig": {
                "persona": "ignored persona",
                "language": "ignored language",
            },
        }
        result = prompts.build_session_instructions(config)
        assert result == "MUST_BE_VERBATIM"
        assert "ignored" not in result


class TestBuildGreeting:
    def test_uses_agent_name_when_known(self):
        config = {"name": "Sam"}
        greeting = prompts.build_greeting(config)
        # We don't lock the exact phrasing — the agent's name has to appear.
        assert "Sam" in greeting

    def test_has_neutral_fallback_when_config_missing(self):
        greeting = prompts.build_greeting(None)
        assert greeting, "Greeting must be non-empty"
