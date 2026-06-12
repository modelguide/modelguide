"""Tests for PromptAgent — the prompt-driven LiveKit agent prototype.

PromptAgent is the heart of the LiveKit "Voice Prototype" flow. It takes a
compiled system prompt (sourced from ModelGuide on every dispatch) and runs
the LiveKit AgentSession with that prompt. No baked-in personality, no
hard-coded tool list — what's in the dispatch metadata is what the LLM sees.

These tests are written red-then-green: they describe the contract before
the class exists, then the implementation is filled in until they pass.
"""

from __future__ import annotations

import json

import pytest

from prompt_agent import (
    PromptAgent,
    PromptAgentConfig,
    DispatchMetadataError,
    parse_dispatch_metadata,
)


# ---------------------------------------------------------------------------
# parse_dispatch_metadata — the contract between API and worker
# ---------------------------------------------------------------------------


class TestParseDispatchMetadata:
    def test_extracts_compiled_prompt_and_session(self):
        raw = json.dumps({
            "mode": "voice-prototype",
            "agentName": "demo-bot",
            "agent_id": "agt_123",
            "session_id": "sess_abc",
            "user_identifier": "tester@example.com",
            "email": "tester@example.com",
            "compiled_prompt": "You are a helpful assistant.",
        })

        cfg = parse_dispatch_metadata(raw)

        assert cfg.compiled_prompt == "You are a helpful assistant."
        assert cfg.agent_id == "agt_123"
        assert cfg.session_id == "sess_abc"
        assert cfg.user_identifier == "tester@example.com"

    def test_raises_when_missing_compiled_prompt(self):
        raw = json.dumps({
            "mode": "voice-prototype",
            "agentName": "demo-bot",
            "agent_id": "agt_123",
            "session_id": "sess_abc",
            "user_identifier": "tester@example.com",
            "email": "tester@example.com",
        })

        # In prototype mode the prompt is the whole point — if it's missing
        # something upstream is broken and we should fail fast, not silently
        # serve a blank prompt.
        with pytest.raises(DispatchMetadataError) as exc:
            parse_dispatch_metadata(raw)

        assert "compiled_prompt" in str(exc.value)

    def test_raises_when_metadata_is_not_json(self):
        with pytest.raises(DispatchMetadataError):
            parse_dispatch_metadata("not-json-at-all")

    def test_raises_when_metadata_is_none(self):
        with pytest.raises(DispatchMetadataError):
            parse_dispatch_metadata(None)

    def test_raises_when_mode_is_not_voice_prototype(self):
        raw = json.dumps({
            "mode": "voice-test",
            "compiled_prompt": "Hi.",
            "session_id": "s",
            "agent_id": "a",
            "user_identifier": "u",
            "email": "u",
        })

        # The prototype path must refuse plain voice-test dispatches so we
        # never accidentally hijack the production "Talk to agent" flow (see
        # ADR-014 + ADR-015 for the separation rationale).
        with pytest.raises(DispatchMetadataError) as exc:
            parse_dispatch_metadata(raw)

        assert "voice-prototype" in str(exc.value)

    def test_user_identifier_falls_back_to_email_when_absent(self):
        raw = json.dumps({
            "mode": "voice-prototype",
            "compiled_prompt": "Hi.",
            "session_id": "s",
            "agent_id": "a",
            "email": "u@example.com",
        })

        cfg = parse_dispatch_metadata(raw)
        assert cfg.user_identifier == "u@example.com"


# ---------------------------------------------------------------------------
# PromptAgent — the LiveKit Agent subclass that runs the prompt
# ---------------------------------------------------------------------------


class TestPromptAgentConstruction:
    def test_uses_compiled_prompt_as_instructions(self):
        agent = PromptAgent(
            config=PromptAgentConfig(
                compiled_prompt="You are Sam, a contractor supply assistant.",
                agent_id="agt_1",
                session_id="sess_1",
                user_identifier="caller@example.com",
            ),
        )

        # LiveKit's Agent base class exposes `instructions` — the prompt the
        # LLM is initialised with.  We bind it from compiled_prompt verbatim,
        # which is the entire purpose of the prototype.
        assert agent.instructions == "You are Sam, a contractor supply assistant."

    def test_exposes_session_id_for_transcript_posting(self):
        agent = PromptAgent(
            config=PromptAgentConfig(
                compiled_prompt="Hello.",
                agent_id="agt_1",
                session_id="sess_xyz",
                user_identifier="u@example.com",
            ),
        )
        assert agent.session_id == "sess_xyz"

    def test_records_user_identifier(self):
        agent = PromptAgent(
            config=PromptAgentConfig(
                compiled_prompt="Hello.",
                agent_id="agt_1",
                session_id="sess_xyz",
                user_identifier="caller@example.com",
            ),
        )
        assert agent.user_identifier == "caller@example.com"

    def test_blank_prompt_is_rejected(self):
        # We reject blank prompts because the dispatch-metadata parser already
        # rejects missing prompts; this guards a second silent failure mode
        # where the prompt key exists but contains only whitespace.
        with pytest.raises(ValueError):
            PromptAgent(
                config=PromptAgentConfig(
                    compiled_prompt="   ",
                    agent_id="agt_1",
                    session_id="sess_xyz",
                    user_identifier="caller@example.com",
                ),
            )

    def test_collects_transcript_for_session_post(self):
        agent = PromptAgent(
            config=PromptAgentConfig(
                compiled_prompt="Hello.",
                agent_id="agt_1",
                session_id="sess_xyz",
                user_identifier="caller@example.com",
            ),
        )

        # We reuse TranscriptCollector so the session-complete cleanup path
        # already wired for BuildPro applies unchanged.
        agent.record_user_utterance("hi there")
        agent.record_agent_response("hello, how can I help?")

        messages = agent.transcript_messages()
        assert any(m.get("role") == "user" for m in messages)
        assert any(m.get("role") == "assistant" for m in messages)
