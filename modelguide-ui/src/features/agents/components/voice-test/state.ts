/**
 * Widget phase labels for the Voice Test panel.
 *
 * Shared across the panel shell and the RoomController child so both can
 * surface consistent status strings without reimplementing the map.
 */

export type WidgetState =
  | 'IDLE'
  | 'CHECKING_MIC'
  | 'REQUESTING_TOKEN'
  | 'CONNECTING'
  | 'CONNECTED'
  | 'ENDING'
  | 'ENDED'
  | 'ERROR'

/** User-visible label for each phase — drives the Badge on the panel header. */
export const PHASE_LABEL: Record<WidgetState, string> = {
  IDLE: 'Ready',
  CHECKING_MIC: 'Checking microphone…',
  REQUESTING_TOKEN: 'Requesting token…',
  CONNECTING: 'Joining LiveKit room…',
  CONNECTED: 'Connected',
  ENDING: 'Hanging up…',
  ENDED: 'Call ended',
  ERROR: 'Error',
}

/**
 * Matches the public-site voice-demo timeout. If no LiveKit Agent-kind
 * participant joins the room within this window, we disconnect and surface
 * an actionable error instead of leaving the operator staring at
 * "Joining LiveKit room…" for minutes.
 */
export const AGENT_JOIN_TIMEOUT_MS = 15_000
