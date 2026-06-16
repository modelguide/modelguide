"""In-memory transcript collector.

LiveKit emits one event per finalised user/assistant utterance. We
collect them in order and hand the list back to the entrypoint on
session close so it can post once to ``POST /api/sessions/:id/messages``.
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class TranscriptCollector:
    """Append-only ordered list of {role, content} messages."""

    _messages: list[dict] = field(default_factory=list)

    def add_user_utterance(self, text: str) -> None:
        clean = (text or "").strip()
        if not clean:
            return
        self._messages.append({"role": "user", "content": clean})

    def add_assistant_response(self, text: str) -> None:
        clean = (text or "").strip()
        if not clean:
            return
        self._messages.append({"role": "assistant", "content": clean})

    def get_messages(self) -> list[dict]:
        return list(self._messages)
