"""Prompt-driven LiveKit Agent — the prototype "Voice Prototype" surface.

Unlike ``BuildProAgent`` (which bakes prompts + tools into Python at deploy
time), ``PromptAgent`` takes the compiled system prompt off the dispatch
metadata and uses that verbatim. The ModelGuide API attaches the agent's
latest ``compiledInstructions`` field to every voice-prototype dispatch, so
clicking "Talk to agent (prototype)" after a prompt compile always
exercises the prompt that's actually saved in the database.

See ``docs/decisions/015-livekit-prompt-driven-voice-prototype.md`` for why
this is a separate code path from the production voice-test flow defined in
ADR-014.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from typing import Any

from livekit.agents import Agent

from transcript import TranscriptCollector

logger = logging.getLogger("prompt_agent")


VOICE_PROTOTYPE_MODE = "voice-prototype"


# ---------------------------------------------------------------------------
# Errors
# ---------------------------------------------------------------------------


class DispatchMetadataError(ValueError):
    """Raised when LiveKit dispatch metadata is missing or malformed.

    Surfaced as an actionable startup error so an operator can see at a
    glance that the API and worker are out of sync — far better than a
    silent fall-through into a blank LLM session.
    """


# ---------------------------------------------------------------------------
# Config carrier
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class PromptAgentConfig:
    compiled_prompt: str
    agent_id: str
    session_id: str
    user_identifier: str


# ---------------------------------------------------------------------------
# Parse
# ---------------------------------------------------------------------------


def parse_dispatch_metadata(raw: str | None) -> PromptAgentConfig:
    """Parse the JSON dispatch metadata into a ``PromptAgentConfig``.

    Required keys: ``compiled_prompt``, ``agent_id``, ``session_id``, and
    one of ``user_identifier`` / ``email``. ``mode`` must equal
    ``voice-prototype`` so a routine "voice-test" dispatch never lands in
    this entrypoint by mistake.
    """
    if raw is None:
        raise DispatchMetadataError("Dispatch metadata is missing")

    try:
        data: dict[str, Any] = json.loads(raw)
    except (TypeError, json.JSONDecodeError) as exc:
        raise DispatchMetadataError(
            f"Dispatch metadata is not valid JSON: {exc}"
        ) from exc

    mode = data.get("mode")
    if mode != VOICE_PROTOTYPE_MODE:
        raise DispatchMetadataError(
            f"Expected mode=voice-prototype, got mode={mode!r}. "
            "This entrypoint only services voice-prototype dispatches."
        )

    compiled_prompt = data.get("compiled_prompt")
    if not compiled_prompt or not str(compiled_prompt).strip():
        raise DispatchMetadataError(
            "Dispatch metadata is missing required field: compiled_prompt"
        )

    agent_id = data.get("agent_id")
    if not agent_id:
        raise DispatchMetadataError(
            "Dispatch metadata is missing required field: agent_id"
        )

    session_id = data.get("session_id")
    if not session_id:
        raise DispatchMetadataError(
            "Dispatch metadata is missing required field: session_id"
        )

    user_identifier = data.get("user_identifier") or data.get("email")
    if not user_identifier:
        raise DispatchMetadataError(
            "Dispatch metadata is missing required field: user_identifier (or email)"
        )

    return PromptAgentConfig(
        compiled_prompt=str(compiled_prompt),
        agent_id=str(agent_id),
        session_id=str(session_id),
        user_identifier=str(user_identifier),
    )


# ---------------------------------------------------------------------------
# Agent
# ---------------------------------------------------------------------------


class PromptAgent(Agent):
    """LiveKit Agent driven solely by a ModelGuide-compiled system prompt.

    Has no ``@function_tool`` methods on purpose — the prototype's job is to
    let an admin hear how the latest compiled prompt sounds in voice, not to
    re-exercise the whole tool stack. When tool wiring is needed too, copy
    ``BuildProAgent`` instead.
    """

    def __init__(self, *, config: PromptAgentConfig) -> None:
        prompt = config.compiled_prompt
        if not prompt or not prompt.strip():
            raise ValueError(
                "PromptAgent requires a non-empty compiled_prompt"
            )

        self._config = config
        self._transcript = TranscriptCollector()
        super().__init__(instructions=prompt)

    # ------------------------------------------------------------------
    # Accessors (kept simple so they're easy to mock in tests)
    # ------------------------------------------------------------------

    @property
    def session_id(self) -> str:
        return self._config.session_id

    @property
    def agent_id(self) -> str:
        return self._config.agent_id

    @property
    def user_identifier(self) -> str:
        return self._config.user_identifier

    # ------------------------------------------------------------------
    # Transcript helpers — thin wrappers so the entrypoint doesn't have to
    # know about TranscriptCollector internals.
    # ------------------------------------------------------------------

    def record_user_utterance(self, text: str) -> None:
        self._transcript.add_user_utterance(text)

    def record_agent_response(self, text: str) -> None:
        self._transcript.add_assistant_response(text)

    def transcript_messages(self) -> list[dict]:
        return self._transcript.get_messages()
