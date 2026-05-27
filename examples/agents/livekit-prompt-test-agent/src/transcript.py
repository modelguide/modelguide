"""In-memory transcript collector for post-call submission to ModelGuide.

Mirrors the implementation used by the buildpro example so transcripts
posted by both workers have an identical shape on the ModelGuide side.
"""

from datetime import datetime, timezone


class TranscriptCollector:
    """Collects user utterances, assistant responses, and tool calls during a
    voice conversation, then formats them for the ModelGuide messages API."""

    def __init__(self) -> None:
        self._messages: list[dict] = []

    def add_user_utterance(self, text: str) -> None:
        if not text.strip():
            return
        # Merge consecutive user utterances (STT sends fragments)
        if self._messages and self._messages[-1].get("role") == "user":
            self._messages[-1]["content"] += " " + text.strip()
        else:
            self._messages.append({
                "role": "user",
                "content": text.strip(),
                "occurredAt": _now_iso(),
            })

    def add_assistant_response(self, text: str) -> None:
        if not text.strip():
            return
        self._messages.append({
            "role": "assistant",
            "content": text.strip(),
            "occurredAt": _now_iso(),
        })

    def get_messages(self) -> list[dict]:
        """Return all collected messages."""
        return list(self._messages)


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
