"""System-prompt + greeting selection for the POC worker.

The rule is deliberately one branch wide: dispatch-injected value wins,
else a baked-in default. No merging, no template interpolation, no
worker-side persona. The dashboard's compiled prompt is the source of
truth; anything else is just a "the worker is alive" sanity check.

If you find yourself adding logic here, you're probably re-creating the
SOP compiler. Push the change into ``modelguide-api/src/features/compiler``
instead so every modality benefits.
"""

from __future__ import annotations

from metadata import DispatchMetadata

DEFAULT_INSTRUCTIONS = (
    "You are a friendly voice assistant running in a ModelGuide LiveKit POC. "
    "Keep answers short — one or two sentences — because they will be spoken. "
    "If the caller asks who you are, say you are a prototype agent and that "
    "the operator has not yet pushed a custom prompt to this worker."
)

DEFAULT_GREETING = "Hi there — you're connected to the ModelGuide voice POC. What can I help with?"


def choose_instructions(md: DispatchMetadata) -> str:
    return md.instructions or DEFAULT_INSTRUCTIONS


def choose_greeting(md: DispatchMetadata) -> str:
    return md.greeting or DEFAULT_GREETING
