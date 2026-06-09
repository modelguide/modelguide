"""Prompt assembly for the POC LiveKit agent.

Two responsibilities:

1. Hand the LLM the *compiled* prompt from ModelGuide verbatim when one
   exists. The compiler in ``modelguide-api`` already merged persona,
   language rules, and filler phrases into the compiled string — the
   worker MUST NOT re-apply them or the prompt drifts between
   compile-time and runtime.

2. When no compiled prompt is available (agent never compiled, or the
   API was unreachable), fall back to a safe generic prompt so the
   caller hears a voice instead of dead air.
"""

from __future__ import annotations

DEFAULT_PROMPT = (
    "You are a helpful voice assistant. Keep responses short and "
    "conversational — under two sentences per turn unless the user "
    "asks for more. Speak naturally and ask clarifying questions when "
    "you're unsure what the user needs."
)


def build_session_instructions(runtime_config: dict | None) -> str:
    """Pick the prompt for this session.

    Returns ``runtime_config["instructions"]`` verbatim when present,
    otherwise a default prompt — optionally prefixed with the agent's
    name so the LLM doesn't introduce itself as "an AI assistant".
    """
    if runtime_config is None:
        return DEFAULT_PROMPT

    compiled = runtime_config.get("instructions")
    if compiled:
        return compiled

    name = runtime_config.get("name")
    if name:
        return f"You are {name}. {DEFAULT_PROMPT}"
    return DEFAULT_PROMPT


def build_greeting(runtime_config: dict | None) -> str:
    """First line the agent says when the caller joins.

    Generic and short — the compiled prompt drives the rest of the
    conversation, so we don't try to inject any of it here.
    """
    name = (runtime_config or {}).get("name")
    if name:
        return f"Hi, this is {name}. How can I help you today?"
    return "Hi there, how can I help you today?"
