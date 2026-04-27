"""ModelGuide LiveKit prototype voice agent.

ADR-015: Reads its system prompt from dispatch metadata so an admin can
compile a prompt in the dashboard, click "Sync & Test", and immediately
talk to a worker reflecting the latest text — without redeploying.

Modules:
    metadata   — parse + validate dispatch metadata (the prompt-injection
                 contract with the MG API).
    agent      — LiveKit `entrypoint` that runs the voice session.
"""

from prototype_agent.metadata import (
    DispatchMetadata,
    InvalidDispatchMetadataError,
    parse_dispatch_metadata,
)

__all__ = [
    "DispatchMetadata",
    "InvalidDispatchMetadataError",
    "parse_dispatch_metadata",
]
