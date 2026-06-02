"""Red-green TDD for ``compose_instructions``.

The PromptFetcher returns ``compiled_instructions`` plus a structured
``prompt_config`` (persona, language, fillerPhrases). The compiler bakes
those config fields into the compiled prompt today — but the prototype
agent keeps the structured copy around so a future iteration can A/B them
or use them to drive non-LLM behaviour (e.g. preloading filler phrases
into TTS warm cache). For now we just need a deterministic composer the
agent can call without branching at the call site.
"""

from __future__ import annotations

from instructions import compose_instructions
from prompt_fetcher import FetchedPrompt


def test_compiled_instructions_used_verbatim_when_present():
    fp = FetchedPrompt(
        instructions="You are Sam.",
        is_fallback=False,
        prompt_config={"persona": "ignored, already baked"},
    )
    assert compose_instructions(fp) == "You are Sam."


def test_fallback_instructions_get_appended_persona_when_available():
    # When the dashboard hasn't compiled yet we still have prompt_config.
    # Surface the persona so the operator's iteration loop is shorter than
    # "edit JSON → click Compile → click Talk".
    fp = FetchedPrompt(
        instructions="You are a helpful voice assistant.",
        is_fallback=True,
        prompt_config={"persona": "Talk like a friendly barista."},
    )
    out = compose_instructions(fp)
    assert out.startswith("You are a helpful voice assistant.")
    assert "Talk like a friendly barista." in out


def test_fallback_with_no_persona_returns_stub_unchanged():
    fp = FetchedPrompt(
        instructions="stub",
        is_fallback=True,
        prompt_config={},
    )
    assert compose_instructions(fp) == "stub"
