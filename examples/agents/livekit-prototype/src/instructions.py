"""Compose the final system prompt for the LLM.

Right now the logic is intentionally trivial — the compiler already bakes
persona/language/filler phrases into ``compiled_instructions`` on the
ModelGuide side, so when we got a compiled prompt we just pass it through.

The interesting branch is the *fallback* case (uncompiled agent or
unreachable API): we splice the operator's ``persona`` from prompt_config
onto the stub so the very first sentence is still in-character. Keeps the
"talk now, compile later" iteration loop short.
"""

from __future__ import annotations

from prompt_fetcher import FetchedPrompt


def compose_instructions(fetched: FetchedPrompt) -> str:
    if not fetched.is_fallback:
        return fetched.instructions

    persona = (fetched.prompt_config or {}).get("persona")
    if not persona:
        return fetched.instructions

    return f"{fetched.instructions}\n\nPersona: {persona}"
