"""In-memory transcript collector for post-call submission to ModelGuide."""

from datetime import datetime, timezone


class TranscriptCollector:
    """Collects user utterances, assistant responses, and tool calls during a
    voice conversation, then formats them for the ModelGuide messages API."""

    def __init__(self) -> None:
        self._messages: list[dict] = []
        self._pending_tool_calls: list[dict] = []

    def add_user_utterance(self, text: str) -> None:
        if not text.strip():
            return
        self._messages.append({
            "role": "user",
            "content": text.strip(),
            "occurredAt": datetime.now(timezone.utc).isoformat(),
        })

    def add_assistant_response(self, text: str) -> None:
        if not text.strip():
            return
        # Flush any pending tool calls into the previous assistant message
        # or create a tool-call-only message first
        self._flush_tool_calls()
        self._messages.append({
            "role": "assistant",
            "content": text.strip(),
            "occurredAt": datetime.now(timezone.utc).isoformat(),
        })

    def add_tool_call(
        self,
        tool_call_id: str,
        tool_name: str,
        tool_input: dict,
        tool_output: dict,
        latency_ms: int,
        tool_status: str = "success",
    ) -> None:
        self._pending_tool_calls.append({
            "toolCallId": tool_call_id,
            "toolName": tool_name,
            "toolInput": tool_input,
            "toolOutput": tool_output,
            "latencyMs": latency_ms,
            "toolStatus": tool_status,
        })

    def _flush_tool_calls(self) -> None:
        """Write pending tool calls as an assistant message."""
        if not self._pending_tool_calls:
            return
        self._messages.append({
            "role": "assistant",
            "toolCalls": self._pending_tool_calls,
            "occurredAt": datetime.now(timezone.utc).isoformat(),
        })
        self._pending_tool_calls = []

    def get_messages(self) -> list[dict]:
        """Return all collected messages, flushing any pending tool calls."""
        self._flush_tool_calls()
        return list(self._messages)
