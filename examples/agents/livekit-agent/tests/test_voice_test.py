"""Tests for the dashboard "Talk to agent" (voice-test) path.

The dashboard dispatches the LiveKit worker with ``mode=voice-test`` and the
agent's compiled prompt as ``prompt_override``. The worker must replace the
built-in BuildPro system prompt with that override so the caller is talking
to the latest compiled instructions without a redeploy.
"""

from unittest.mock import MagicMock, patch

from buildpro import BuildProAgent


class TestInstructionsOverride:
    def test_override_replaces_builtin_prompt(self):
        # Constructor calls ``Agent.__init__`` which bootstraps LiveKit state;
        # we only care about the ``instructions`` attribute it stores.
        with patch("buildpro.MCPAgent.__init__", return_value=None) as mock_init:
            BuildProAgent(
                session_id="sess_1",
                user_email="tester@example.com",
                instructions_override="You are a pirate. Say arrr.",
            )

        kwargs = mock_init.call_args.kwargs
        assert kwargs["instructions"] == "You are a pirate. Say arrr."
        # The built-in BuildPro prompt should NOT leak through.
        assert "BuildPro" not in kwargs["instructions"]
        assert "Sam" not in kwargs["instructions"]

    def test_override_interpolates_session_and_email(self):
        with patch("buildpro.MCPAgent.__init__", return_value=None) as mock_init:
            BuildProAgent(
                session_id="sess_abc",
                user_email="alice@example.com",
                instructions_override=(
                    "Session is {{mg_session_id}}.\n"
                    "User email is {{userEmail}}.\n"
                    "Channel is {{channel}}."
                ),
            )

        body = mock_init.call_args.kwargs["instructions"]
        assert "sess_abc" in body
        assert "alice@example.com" in body
        assert "voice" in body
        assert "{{" not in body

    def test_empty_override_falls_back_to_builtin_prompt(self):
        with patch("buildpro.MCPAgent.__init__", return_value=None) as mock_init:
            BuildProAgent(
                session_id="sess_x",
                user_email="bob@example.com",
                instructions_override="",
            )

        body = mock_init.call_args.kwargs["instructions"]
        # Falling back means we get the long built-in prompt with Sam/BuildPro.
        assert "BuildPro" in body
        assert "Sam" in body

    def test_whitespace_only_override_falls_back(self):
        with patch("buildpro.MCPAgent.__init__", return_value=None) as mock_init:
            BuildProAgent(
                session_id="sess_y",
                user_email="bob@example.com",
                instructions_override="   \n  ",
            )

        body = mock_init.call_args.kwargs["instructions"]
        assert "BuildPro" in body

    def test_none_override_falls_back_to_builtin_prompt(self):
        with patch("buildpro.MCPAgent.__init__", return_value=None) as mock_init:
            BuildProAgent(
                session_id="sess_z",
                user_email="bob@example.com",
                instructions_override=None,
            )

        body = mock_init.call_args.kwargs["instructions"]
        assert "BuildPro" in body
