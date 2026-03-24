"""Langfuse OpenTelemetry tracing setup.

Tracing is opt-in: set LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY in .env.
Never pass debug=True to Langfuse() — it adds ~2-3s latency per voice turn.
"""

import contextlib
import logging

import config

logger = logging.getLogger("tracing")

_langfuse_instance = None  # prevent GC
_trace_provider = None


def setup_langfuse(session_metadata: dict | None = None):
    """Configure Langfuse tracing via OpenTelemetry. No-op if keys are not set."""
    global _langfuse_instance, _trace_provider

    if not config.LANGFUSE_PUBLIC_KEY or not config.LANGFUSE_SECRET_KEY:
        logger.info("Langfuse keys not set — tracing disabled")
        return None

    from langfuse import Langfuse
    from opentelemetry.sdk.trace import TracerProvider
    from livekit.agents.telemetry import set_tracer_provider

    trace_provider = TracerProvider()
    _trace_provider = trace_provider
    set_tracer_provider(trace_provider, metadata=session_metadata)
    _langfuse_instance = Langfuse(
        public_key=config.LANGFUSE_PUBLIC_KEY,
        secret_key=config.LANGFUSE_SECRET_KEY,
        base_url=config.LANGFUSE_HOST,
        tracer_provider=trace_provider,
        should_export_span=lambda span: True,
    )
    logger.info("Langfuse tracing enabled → %s", config.LANGFUSE_HOST)
    return trace_provider


def tool_span(tool_name: str, mcp_name: str):
    """Create an OTel span for a tool call so it shows in Langfuse."""
    if _trace_provider is None:
        return contextlib.nullcontext()
    try:
        tracer = _trace_provider.get_tracer(config.AGENT_NAME)
        return tracer.start_as_current_span(
            f"mcp_tool:{tool_name}",
            attributes={"tool.name": tool_name, "tool.mcp_name": mcp_name},
        )
    except Exception:
        return contextlib.nullcontext()
