"""Voice-test POC mode (prompt-injection) — worker-side contract.

Mirror of modelguide-api/tests/unit/agents/voice-test-poc-dispatch.test.ts.
The API carries a freshly compiled prompt in dispatch metadata under
``mode: "voice-test-poc"``; this module owns the *worker* half of that
contract: given a metadata dict, return the instructions the agent should
actually run with.

If the field name, mode marker, or fallback behavior drifts, the worker
silently runs the wrong prompt — there's no type system connecting the two
sides, so these tests are the contract.

See ADR-015.
"""

from __future__ import annotations

from voice_test_poc import resolve_instructions


class TestResolveInstructionsPocMode:
    """When ``mode == 'voice-test-poc'`` and a compiled prompt is present,
    the worker runs with the override (that's the whole point of the POC)."""

    def test_uses_compiled_instructions_when_poc_mode(self):
        md = {
            "mode": "voice-test-poc",
            "agentName": "banknowa_v1",
            "compiled_instructions": "You are a helpful voice agent.",
        }
        result = resolve_instructions(md, default="BAKED PROMPT")
        assert result == "You are a helpful voice agent."

    def test_returns_long_prompts_verbatim(self):
        prompt = "A" * 20_000
        md = {"mode": "voice-test-poc", "compiled_instructions": prompt}
        assert resolve_instructions(md, default="BAKED") == prompt


class TestResolveInstructionsFallback:
    """Any failure to honor the override must fall back to the baked prompt
    — silent-empty-override is the scariest failure mode (admin thinks
    they're testing X, worker is running Y)."""

    def test_falls_back_for_prod_voice_test_mode(self):
        # The prod voice-test path deliberately does NOT inject a prompt.
        # Seeing ``mode: "voice-test"`` (no ``-poc``) means "use baked".
        md = {
            "mode": "voice-test",
            "agentName": "banknowa_v1",
            "session_id": "s",
        }
        assert resolve_instructions(md, default="BAKED") == "BAKED"

    def test_falls_back_when_mode_missing(self):
        # Outbound SIP calls and legacy dispatches may not carry a mode.
        md = {"phone_number": "+15551234567"}
        assert resolve_instructions(md, default="BAKED") == "BAKED"

    def test_falls_back_for_empty_metadata(self):
        assert resolve_instructions({}, default="BAKED") == "BAKED"
        assert resolve_instructions(None, default="BAKED") == "BAKED"

    def test_falls_back_when_poc_mode_has_no_prompt(self):
        # Shouldn't happen — the API's size/empty guard prevents it — but
        # if it does, we NEVER want the agent to start up with no
        # instructions. Fall back, log, and let the operator notice.
        md = {"mode": "voice-test-poc"}
        assert resolve_instructions(md, default="BAKED") == "BAKED"

    def test_falls_back_when_poc_prompt_is_blank(self):
        # An empty-string override from a corrupted dispatch: same as above,
        # never run with no instructions.
        md = {"mode": "voice-test-poc", "compiled_instructions": ""}
        assert resolve_instructions(md, default="BAKED") == "BAKED"
        md2 = {"mode": "voice-test-poc", "compiled_instructions": "   \n\t "}
        assert resolve_instructions(md2, default="BAKED") == "BAKED"

    def test_falls_back_when_poc_prompt_is_wrong_type(self):
        # Defensive: JSON.parse of a malformed payload could hand us a
        # list / number / dict where a string is expected.
        for bad in (123, [], {}, True):
            md = {"mode": "voice-test-poc", "compiled_instructions": bad}
            assert resolve_instructions(md, default="BAKED") == "BAKED"

    def test_mode_is_case_sensitive(self):
        # Workers match the mode marker by exact string equality. A typo
        # upstream should fall back, not pretend to work.
        md = {
            "mode": "Voice-Test-POC",
            "compiled_instructions": "X",
        }
        assert resolve_instructions(md, default="BAKED") == "BAKED"


class TestResolveInstructionsReturnShape:
    """Worker code stringifies the result into ``Agent(instructions=...)``
    — keep the return type narrow so we never hand LiveKit a dict."""

    def test_always_returns_str(self):
        cases = [
            {},
            {"mode": "voice-test-poc", "compiled_instructions": "X"},
            {"mode": "voice-test"},
        ]
        for md in cases:
            out = resolve_instructions(md, default="BAKED")
            assert isinstance(out, str)
