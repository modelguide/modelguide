"""Unit tests for the prompt assembly module.

These cover the rules in ``prompt.py`` that decide which prompt is used and
how runtime context is spliced in. They're the regression net for the
"compile → talk" loop's core behaviour:

  * a fresh compile must appear in the next-call's system prompt
  * a missing compile must fall back gracefully without crashing the agent
  * runtime context must be carried so the LLM can address the caller
"""

from prompt import build_greeting, build_system_prompt


class TestBuildSystemPrompt:
    def test_uses_compiled_prompt_verbatim_when_present(self):
        """The compiled prompt from the dashboard wins — no rewriting."""
        out = build_system_prompt(
            compiled_instructions="You are Sam. Speak warmly.",
            prompt_config=None,
            session_id="sess-1",
            user_identifier="alice@example.com",
        )
        assert out.startswith("You are Sam. Speak warmly.")

    def test_falls_back_when_compiled_is_none(self):
        """If the operator never compiled a prompt we must still produce
        something — the agent ships the fallback so the caller hears a
        coherent "not configured" reply instead of LLM hallucinations."""
        import config

        out = build_system_prompt(
            compiled_instructions=None,
            prompt_config=None,
            session_id=None,
            user_identifier="caller",
        )
        assert config.FALLBACK_PROMPT in out

    def test_falls_back_when_compiled_is_blank(self):
        """A whitespace-only compile is treated as no compile — guarding
        against a dashboard bug that persists an empty string."""
        import config

        out = build_system_prompt(
            compiled_instructions="   \n  ",
            prompt_config=None,
            session_id=None,
            user_identifier="caller",
        )
        assert config.FALLBACK_PROMPT in out

    def test_includes_runtime_context_block(self):
        out = build_system_prompt(
            compiled_instructions="Base.",
            prompt_config=None,
            session_id="sess-abc",
            user_identifier="alice@example.com",
        )
        assert "Runtime context" in out
        assert "alice@example.com" in out
        assert "sess-abc" in out

    def test_omits_session_id_line_when_missing(self):
        out = build_system_prompt(
            compiled_instructions="Base.",
            prompt_config=None,
            session_id=None,
            user_identifier="alice@example.com",
        )
        assert "session id" not in out.lower()

    def test_appends_voice_style_block_from_prompt_config(self):
        out = build_system_prompt(
            compiled_instructions="Base.",
            prompt_config={
                "persona": "Warm and concise",
                "language": "en-US",
                "fillerPhrases": ["let me check", "one sec"],
            },
            session_id=None,
            user_identifier="caller",
        )
        assert "Voice style" in out
        assert "Warm and concise" in out
        assert "en-US" in out
        assert "let me check" in out

    def test_no_voice_style_block_when_prompt_config_empty(self):
        out = build_system_prompt(
            compiled_instructions="Base.",
            prompt_config={},
            session_id=None,
            user_identifier="caller",
        )
        assert "Voice style" not in out

    def test_caps_filler_phrases_to_avoid_prompt_bloat(self):
        # If a dashboard user pastes 20 filler phrases we don't want them all
        # in the prompt — voice latency budget is tight. We expect the top 5.
        out = build_system_prompt(
            compiled_instructions="Base.",
            prompt_config={
                "fillerPhrases": [f"phrase-{i}" for i in range(10)],
            },
            session_id=None,
            user_identifier="caller",
        )
        assert "phrase-4" in out
        assert "phrase-5" not in out


class TestBuildGreeting:
    def test_uses_email_local_part(self):
        assert build_greeting("Hey {name}!", "alice@example.com") == "Hey alice!"

    def test_handles_non_email_identifier(self):
        assert build_greeting("Hey {name}!", "sam") == "Hey sam!"

    def test_falls_back_to_there_for_empty_identifier(self):
        assert build_greeting("Hey {name}!", "") == "Hey there!"

    def test_falls_back_to_there_for_voice_caller_placeholder(self):
        # "voice-caller" is the API's default identifier — it would be
        # weird to greet a customer literally as "Hey voice-caller".
        assert build_greeting("Hey {name}!", "voice-caller") == "Hey there!"

    def test_template_without_name_placeholder_passes_through(self):
        assert build_greeting("Hello!", "alice") == "Hello!"
