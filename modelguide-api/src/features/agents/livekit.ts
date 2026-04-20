import {
  AccessToken,
  AgentDispatchClient,
  RoomServiceClient,
} from "livekit-server-sdk";

export async function pingLivekit(
  livekitUrl: string,
  apiKey: string,
  apiSecret: string,
): Promise<void> {
  const client = new RoomServiceClient(livekitUrl, apiKey, apiSecret);
  await client.listRooms();
}

export async function dispatchAgentToRoom(
  livekitUrl: string,
  apiKey: string,
  apiSecret: string,
  agentName: string,
  roomName: string,
  metadata: Record<string, unknown>,
): Promise<string> {
  const client = new AgentDispatchClient(livekitUrl, apiKey, apiSecret);
  const dispatch = await client.createDispatch(roomName, agentName, {
    metadata: JSON.stringify(metadata),
  });
  return dispatch.id;
}

// ---------------------------------------------------------------------------
// Voice-test access tokens
//
// Generates a short-lived LiveKit AccessToken for a browser participant so the
// dashboard "Talk to agent" panel can join a room from WebRTC. The token
// carries a `roomJoin` grant scoped to a single room plus publish/subscribe
// perms so mic audio can flow both ways.
// ---------------------------------------------------------------------------

const DEFAULT_VOICE_TEST_TTL_SECONDS = 15 * 60;

export interface VoiceTestTokenInput {
  apiKey: string;
  apiSecret: string;
  roomName: string;
  identity: string;
  name?: string;
  ttlSeconds?: number;
}

export async function generateVoiceTestToken(
  input: VoiceTestTokenInput,
): Promise<string> {
  const ttl = input.ttlSeconds ?? DEFAULT_VOICE_TEST_TTL_SECONDS;
  const at = new AccessToken(input.apiKey, input.apiSecret, {
    identity: input.identity,
    name: input.name,
    ttl,
  });
  at.addGrant({
    roomJoin: true,
    room: input.roomName,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
  });
  return at.toJwt();
}
