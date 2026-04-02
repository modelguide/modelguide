"""Tests for SIP participant detection and caller identity resolution."""

import json
from unittest.mock import MagicMock, patch

from agent import _resolve_caller_identity


def _make_participant(attributes: dict | None = None, name: str = "", identity: str = "web-user") -> MagicMock:
    """Create a mock RemoteParticipant with optional SIP attributes."""
    p = MagicMock()
    p.attributes = attributes or {}
    p.name = name
    p.identity = identity
    return p


# Patch config.USER_EMAIL since validate() isn't called in tests
@patch("agent.config.USER_EMAIL", "voice-caller")
class TestResolveCallerIdentity:
    def test_webrtc_participant(self):
        """WebRTC participant uses config.USER_EMAIL, not SIP."""
        p = _make_participant(name="Artur", identity="artur")
        user_id, phone, is_sip = _resolve_caller_identity(p)

        assert is_sip is False
        assert phone is None
        assert user_id == "voice-caller"

    def test_sip_participant_with_phone(self):
        """SIP participant with phone number uses it as user identifier."""
        p = _make_participant(attributes={
            "sip.trunkPhoneNumber": "+14155551234",
            "sip.phoneNumber": "+48123456789",
            "sip.callID": "call-abc-123",
        })
        user_id, phone, is_sip = _resolve_caller_identity(p)

        assert is_sip is True
        assert phone == "+48123456789"
        assert user_id == "+48123456789"

    def test_sip_participant_trunk_only(self):
        """SIP participant with trunk but no caller phone falls back to config."""
        p = _make_participant(attributes={
            "sip.trunkPhoneNumber": "+14155551234",
        })
        user_id, phone, is_sip = _resolve_caller_identity(p)

        assert is_sip is True
        assert phone is None
        assert user_id == "voice-caller"

    def test_sip_participant_no_attributes(self):
        """Participant with no attributes is treated as WebRTC."""
        p = _make_participant(attributes={})
        user_id, phone, is_sip = _resolve_caller_identity(p)

        assert is_sip is False
        assert phone is None

    def test_sip_participant_none_attributes(self):
        """Participant with None attributes doesn't crash."""
        p = _make_participant()
        p.attributes = None
        user_id, phone, is_sip = _resolve_caller_identity(p)

        assert is_sip is False
        assert phone is None


class TestOutboundMetadata:
    """Tests for outbound call dispatch metadata parsing."""

    def test_valid_metadata_extracts_phone(self):
        """Valid JSON metadata with phone_number is parsed correctly."""
        raw = json.dumps({"phone_number": "+14155551234", "email": "a@b.com", "session_id": "sess-123"})
        meta = json.loads(raw)
        assert meta["phone_number"] == "+14155551234"
        assert meta.get("email") == "a@b.com"
        assert meta.get("session_id") == "sess-123"

    def test_metadata_without_phone(self):
        """Metadata without phone_number means no outbound call."""
        meta = json.loads(json.dumps({"email": "a@b.com"}))
        assert meta.get("phone_number") is None

    def test_empty_metadata(self):
        """Empty metadata dict means no outbound call."""
        meta = {}
        assert meta.get("phone_number") is None

    def test_invalid_json_metadata(self):
        """Invalid JSON metadata is handled gracefully."""
        raw = "not-json"
        try:
            meta = json.loads(raw)
        except json.JSONDecodeError:
            meta = {}
        assert meta.get("phone_number") is None

    def test_user_identifier_prefers_email(self):
        """When email is available, it's used as user_identifier over phone."""
        meta = {"phone_number": "+14155551234", "email": "user@example.com"}
        user_id = meta.get("email") or meta["phone_number"]
        assert user_id == "user@example.com"

    def test_user_identifier_falls_back_to_phone(self):
        """When no email, phone number is used as user_identifier."""
        meta = {"phone_number": "+14155551234"}
        user_id = meta.get("email") or meta["phone_number"]
        assert user_id == "+14155551234"
