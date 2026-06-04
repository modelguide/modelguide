"""Tests for runtime_config — the pure helper that consumes /api/agents/me.

The HTTP contract with ModelGuide is locked in `modelguide-api`'s
`tests/unit/agents/agent-runtime-config.test.ts`. These tests cover the
agent-side parsing + fallbacks: what does the worker boot with when the
prompt is missing? when only `promptConfig.persona` is set? when both?
"""

from runtime_config import RuntimeConfig, build_session_instructions, parse_runtime_config


SAMPLE = {
    "id": "00000000-0000-0000-0000-0000000000aa",
    "slug": "buildpro-sam",
    "name": "Sam",
    "modality": "voice",
    "modelFamily": "gpt",
    "agentPlatform": "livekit",
    "isActive": True,
    "promptConfig": {"persona": "Friendly contractor supply assistant"},
    "metadata": {"livekit": {"agentName": "buildpro"}},
    "compiledInstructions": "You are Sam. Help with orders.",
    "compiledAt": "2026-02-01T00:00:00.000Z",
    "updatedAt": "2026-02-01T00:00:00.000Z",
}


class TestParseRuntimeConfig:
    def test_parses_minimal_shape(self):
        cfg = parse_runtime_config(SAMPLE)
        assert isinstance(cfg, RuntimeConfig)
        assert cfg.id == SAMPLE["id"]
        assert cfg.slug == "buildpro-sam"
        assert cfg.name == "Sam"
        assert cfg.modality == "voice"
        assert cfg.compiled_instructions == "You are Sam. Help with orders."

    def test_accepts_null_compiled_fields(self):
        payload = {**SAMPLE, "compiledInstructions": None, "compiledAt": None}
        cfg = parse_runtime_config(payload)
        assert cfg.compiled_instructions is None
        assert cfg.compiled_at is None

    def test_persona_falls_back_to_empty_string_when_missing(self):
        payload = {**SAMPLE, "promptConfig": {}}
        cfg = parse_runtime_config(payload)
        assert cfg.persona == ""

    def test_extracts_persona_from_promptConfig(self):
        cfg = parse_runtime_config(SAMPLE)
        assert cfg.persona == "Friendly contractor supply assistant"


class TestBuildSessionInstructions:
    def test_uses_compiled_instructions_when_present(self):
        cfg = parse_runtime_config(SAMPLE)
        prompt = build_session_instructions(cfg)
        assert "You are Sam. Help with orders." in prompt

    def test_falls_back_to_persona_when_no_compiled_prompt(self):
        # Operator hasn't clicked Compile yet — the worker should still boot
        # with something coherent rather than an empty system prompt.
        payload = {**SAMPLE, "compiledInstructions": None}
        cfg = parse_runtime_config(payload)
        prompt = build_session_instructions(cfg)
        assert "Friendly contractor supply assistant" in prompt

    def test_uses_generic_fallback_when_nothing_configured(self):
        payload = {
            **SAMPLE,
            "compiledInstructions": None,
            "promptConfig": {},
        }
        cfg = parse_runtime_config(payload)
        prompt = build_session_instructions(cfg)
        # The fallback must mention the agent name so the worker still
        # responds with some identity rather than going silent.
        assert "Sam" in prompt

    def test_prefers_compiled_instructions_over_persona(self):
        # If both are set the compiled prompt wins — that's the operator's
        # authored prompt + SOPs, the persona is just a hint.
        cfg = parse_runtime_config(SAMPLE)
        prompt = build_session_instructions(cfg)
        # Compiled instructions live verbatim, persona is not duplicated.
        assert prompt.count("Friendly contractor supply assistant") == 0
        assert "You are Sam. Help with orders." in prompt
