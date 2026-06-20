"""In-memory transcript collector for the POC.

Tracks user utterances and assistant responses in the same shape
ModelGuide accepts on ``POST /api/sessions/:id/messages``. Kept small
so it can be replaced by the production transcript collector
(``examples/agents/livekit-agent/src/transcript.py``) if the POC ever
graduates.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Literal

Role = Literal["user", "assistant"]


@dataclass
class TranscriptMessage:
    role: Role
    content: str
    timestamp_ms: int


@dataclass
class TranscriptCollector:
    """Append-only transcript. Thread-unsafe; the LiveKit session callbacks
    run on a single event loop so synchronization isn't needed here."""

    messages: list[TranscriptMessage] = field(default_factory=list)

    def add_user_utterance(self, text: str) -> None:
        if not text.strip():
            return
        self.messages.append(
            TranscriptMessage(
                role="user", content=text, timestamp_ms=_now_ms()
            )
        )

    def add_assistant_response(self, text: str) -> None:
        if not text.strip():
            return
        self.messages.append(
            TranscriptMessage(
                role="assistant", content=text, timestamp_ms=_now_ms()
            )
        )

    def to_api_payload(self) -> list[dict]:
        """Serialize for POST /api/sessions/:id/messages."""
        return [
            {
                "role": m.role,
                "content": m.content,
                "timestamp": m.timestamp_ms,
            }
            for m in self.messages
        ]

    def __len__(self) -> int:
        return len(self.messages)


def _now_ms() -> int:
    return int(time.time() * 1000)
