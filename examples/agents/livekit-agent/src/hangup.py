"""Auto-hangup state machine for voice agent sign-off detection.

Flow: agent signs off → user says goodbye → agent replies once → disconnect.
"""

import enum
import logging

logger = logging.getLogger("hangup")

SIGN_OFF_MARKERS = {"good luck", "take care"}

GOODBYE_PHRASES = {
    "bye", "goodbye", "good bye", "thanks bye", "thank you bye",
    "thank you goodbye", "cheers", "thanks", "thank you", "later",
    "see ya", "take care", "have a good one",
}


class HangupAction(enum.Enum):
    """Actions returned by ``HangupStateMachine.on_agent_speech()``."""
    SIGNED_OFF = "signed_off"
    SHUTDOWN = "shutdown"


class HangupStateMachine:
    """Tracks agent sign-off → user goodbye → final reply → disconnect.

    Returns ``HangupAction`` so the caller decides what to do (e.g. schedule
    a delayed shutdown). No framework dependency — easy to test.
    """

    def __init__(self) -> None:
        self.signed_off = False
        self.hanging_up = False
        self.shutdown_scheduled = False

    def on_agent_speech(self, text: str) -> HangupAction | None:
        """Process agent speech. Returns a ``HangupAction`` or ``None``."""
        lower = text.strip().lower()
        if not self.signed_off and any(p in lower for p in SIGN_OFF_MARKERS):
            self.signed_off = True
            logger.info("Agent signed off — will auto-hangup on user goodbye")
            return HangupAction.SIGNED_OFF
        if self.hanging_up and not self.shutdown_scheduled:
            self.shutdown_scheduled = True
            logger.info("Agent said final goodbye — shutting down after TTS")
            return HangupAction.SHUTDOWN
        return None

    def on_user_speech(self, text: str) -> bool:
        """Process user speech. Returns ``True`` if user confirmed goodbye."""
        if self.signed_off and not self.hanging_up:
            lower = text.strip().lower()
            if any(p in lower for p in GOODBYE_PHRASES):
                self.hanging_up = True
                logger.info("User confirmed goodbye — waiting for agent reply then hangup")
                return True
        return False
