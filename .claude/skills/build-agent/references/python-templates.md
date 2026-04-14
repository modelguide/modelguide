# Python Agent Templates Reference

Complete templates for the voice agent. `{{variables}}` replaced from CONTEXT.md.
Base on `examples/agents/livekit-agent/src/` — these files can be copied unchanged:
`mcp_agent.py`, `mg_client.py`, `tracing.py`, `transcript.py`, `providers.py`, `hangup.py`

## agent.py

Copy `examples/agents/livekit-agent/src/agent.py` and change the import line:
```python
# Change this line:
from buildpro import BuildProAgent
# To:
from my_agent import {{AgentClassName}}
```

Also update the two references to `BuildProAgent` → `{{AgentClassName}}` in `entrypoint`.

## my_agent.py

```python
"""{{agentName}} — MCPAgent subclass with {{N}} tools."""
from __future__ import annotations
from livekit.agents import RunContext, function_tool
from mcp_agent import MCPAgent
from prompts import build_system_prompt


class {{AgentClassName}}(MCPAgent):
    """{{agentDescription}}."""

    TOOL_NAMES = [
        "{{toolShortName1}}",
        "{{toolShortName2}}",
        # one entry per tool from CONTEXT.md
    ]

    def __init__(self, *, session_id: str | None, mcp=None) -> None:
        instructions = build_system_prompt(session_id or "")
        super().__init__(session_id=session_id, mcp=mcp, instructions=instructions)

    @function_tool()
    async def {{toolShortName1}}(self, context: RunContext, {{params}}) -> str:
        """{{toolDescription — specific, this is what the LLM reads to decide when to call it}}"""
        return await self._call_mcp_tool("{{toolShortName1}}", {
            "{{param1}}": {{param1}},
        })

    # Repeat @function_tool for each tool in TOOL_NAMES
```

**Example tool** (order lookup):
```python
    @function_tool()
    async def get_order(self, context: RunContext, orderId: str = "") -> str:
        """Look up an order by ID. Returns status, items, and estimated delivery."""
        return await self._call_mcp_tool("get_order", {"orderId": orderId})
```

## config.py

Copy `examples/agents/livekit-agent/src/config.py` and update two lines:
```python
AGENT_NAME: str = os.getenv("AGENT_NAME", "{{agentSlug}}")
CONNECTOR_PREFIX: str = os.getenv("CONNECTOR_PREFIX", "{{connectorSlug}}")
```

All other config (LLM/STT/TTS vars, ModelGuide vars) stays identical.

## prompts/__init__.py

```python
from .base import build_system_prompt

GREETING = "Hi, I'm {{agentFirstName}}. {{greetingLine}}"

__all__ = ["build_system_prompt", "GREETING"]
```

## prompts/base.py

```python
"""System prompt for {{agentName}}."""
import os


def build_system_prompt(session_id: str, **kwargs) -> str:
    compiled = os.getenv("COMPILED_PROMPT", "")
    if compiled:
        return f"{PERSONA_HEADER}\n\n{compiled}\n\n{PERSONA_FOOTER}"
    return FALLBACK_PROMPT.format(session_id=session_id or "unknown")


PERSONA_HEADER = """You are {{agentFirstName}}, a {{personaDescription}}.

Personality:
- {{personalityTrait1}}
- {{personalityTrait2}}
- {{personalityTrait3}}"""

PERSONA_FOOTER = """Voice assistant rules:
- Keep responses concise (1-3 sentences unless detail is needed).
- Never fabricate information you don't have.
- If uncertain, say so and offer to connect with a human agent."""

FALLBACK_PROMPT = """You are {{agentFirstName}}, a {{personaDescription}}.
Session: {session_id}

{{guardrailsInline}}"""
```

## pyproject.toml

```toml
[project]
name = "{{orgSlug}}-voice-agent"
version = "0.1.0"
requires-python = ">=3.11"
dependencies = [
    "livekit-agents[silero,turn-detector]~=1.4",
    "livekit-plugins-openai~=1.4",
    "livekit-plugins-deepgram~=1.4",
    "livekit-plugins-elevenlabs~=1.4",
    "livekit-plugins-cartesia~=1.4",
    "httpx",
    "python-dotenv",
    "mcp",
    "langfuse>=4.0.0",
]

[build-system]
requires = ["setuptools>=70"]
build-backend = "setuptools.backends.legacy:build"

[tool.setuptools.packages.find]
where = ["src"]
```

## .env.example

```bash
# {{agentName}} — environment variables
# Copy to .env and fill in your values. NEVER commit .env.

# LLM
OPENAI_API_KEY=sk-...           # https://platform.openai.com/api-keys

# STT
DEEPGRAM_API_KEY=...            # https://console.deepgram.com/

# TTS (choose one)
ELEVENLABS_API_KEY=...          # https://elevenlabs.io/app/settings/api-keys
# CARTESIA_API_KEY=...

# ModelGuide (filled in stage [2] after provisioning)
MODELGUIDE_API_URL=http://localhost:3000
MODELGUIDE_API_KEY=mgk_...      # printed by mg setup
MODELGUIDE_AGENT_ID=            # UUID printed by mg setup (agent summary table)

# LiveKit — local dev, no account needed
LIVEKIT_URL=ws://localhost:7880
LIVEKIT_API_KEY=devkey
LIVEKIT_API_SECRET=secret
AGENT_NAME={{agentSlug}}
CONNECTOR_PREFIX={{connectorSlug}}

# Optional — TTS voice
# TTS_PROVIDER=elevenlabs
# ELEVENLABS_VOICE_ID=iP95p4xoKVk53GoZ742B

# Optional — observability
# LANGFUSE_PUBLIC_KEY=pk-lf-...
# LANGFUSE_SECRET_KEY=sk-lf-...
# LANGFUSE_HOST=https://cloud.langfuse.com
```
