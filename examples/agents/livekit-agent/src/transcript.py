"""In-memory transcript collector for post-call submission to ModelGuide."""

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
        if self._messages and self._messages[-1]["role"] == "user":
            self._messages[-1]["content"] += " " + text.strip()
        else:
            self._messages.append({
                "role": "user",
                "content": text.strip(),
                "occurredAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            })

    def add_assistant_response(self, text: str) -> None:
        if not text.strip():
            return
        self._messages.append({
            "role": "assistant",
            "content": text.strip(),
            "occurredAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
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
        call: dict = {
            "toolCallId": tool_call_id,
            "toolName": tool_name,
            "toolInput": tool_input,
            "toolOutput": tool_output,
            "toolStatus": tool_status,
        }
        if latency_ms > 0:
            call["latencyMs"] = latency_ms
        self._messages.append({
            "role": "assistant",
            "toolCalls": [call],
            "occurredAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        })

    def get_messages(self) -> list[dict]:
        """Return all collected messages."""
        return list(self._messages)
