"""Tests for the compiled-prompt interpolation helper.

Covers the override path used when the worker pulls a compiled prompt from
ModelGuide via ``mg_client.fetch_runtime()`` instead of building one from
the local ``prompts/`` package.
"""

from buildpro import interpolate_runtime_prompt


class TestInterpolateRuntimePrompt:
    def test_replaces_session_id(self):
        result = interpolate_runtime_prompt(
            "Session: {{mg_session_id}}", "sess_123", "alice@example.com"
        )
        assert result == "Session: sess_123"

    def test_replaces_user_email(self):
        result = interpolate_runtime_prompt(
            "Caller: {{userEmail}}", "sess_1", "alice@example.com"
        )
        assert result == "Caller: alice@example.com"

    def test_replaces_channel(self):
        result = interpolate_runtime_prompt(
            "Channel: {{channel}}", "sess_1", "alice@example.com"
        )
        assert result == "Channel: voice"

    def test_replaces_all_placeholders(self):
        prompt = "S={{mg_session_id}} U={{userEmail}} C={{channel}}"
        result = interpolate_runtime_prompt(prompt, "sess_1", "u@e.com")
        assert result == "S=sess_1 U=u@e.com C=voice"

    def test_handles_none_session_id(self):
        # Worker can be in a degraded path where session creation failed —
        # interpolation should not crash, just produce an empty string for
        # the placeholder. Beats a NoneError taking down the call.
        result = interpolate_runtime_prompt(
            "Session: {{mg_session_id}}.", None, "u@e.com"
        )
        assert result == "Session: ."

    def test_passthrough_when_no_placeholders(self):
        # SOP-compiled prompts may not contain any placeholders at all. The
        # helper must be a no-op in that case.
        result = interpolate_runtime_prompt(
            "Hello, you are a helpful assistant.", "sess_1", "u@e.com"
        )
        assert result == "Hello, you are a helpful assistant."

    def test_does_not_invent_substitutions(self):
        # Make sure we don't accidentally substitute look-alike tokens.
        result = interpolate_runtime_prompt(
            "Use {mg_session_id} or {{session}} as labels", "sess_1", "u@e.com"
        )
        assert result == "Use {mg_session_id} or {{session}} as labels"
