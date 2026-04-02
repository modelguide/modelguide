import { AgentDispatchClient } from "livekit-server-sdk";

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
