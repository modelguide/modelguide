"""LiveKit POC voice agent for ModelGuide.

A Voiceblox-style minimal voice agent that fetches its system prompt
from ModelGuide on every session start so the dashboard's "Compile"
button has an immediate effect on the next call (no worker redeploy).

See README.md for the architecture and ADR-015 for the decision context.
"""

__version__ = "0.1.0"
