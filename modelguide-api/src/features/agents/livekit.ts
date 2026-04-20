import {
  AccessToken,
  AgentDispatchClient,
  RoomServiceClient,
} from "livekit-server-sdk";
import { nanoid } from "nanoid";

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

/**
 * Mint a short-lived LiveKit access token for a browser participant to
 * join a specific room. Used by the "Test in Browser" flow — the token
 * is handed to the UI which then connects via the LiveKit JS client.
 *
 * The grant allows joining the named room, publishing the caller's mic,
 * and subscribing to the agent's audio. No room admin privileges.
 */
export async function generateBrowserAccessToken(params: {
  apiKey: string;
  apiSecret: string;
  roomName: string;
  identity?: string;
  name?: string;
  ttlSeconds?: number;
}): Promise<string> {
  const identity = params.identity ?? `web-${nanoid(10)}`;
  const ttl = params.ttlSeconds ?? 10 * 60;

  const at = new AccessToken(params.apiKey, params.apiSecret, {
    identity,
    name: params.name,
    ttl,
  });
  at.addGrant({
    room: params.roomName,
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
  });
  return at.toJwt();
}
