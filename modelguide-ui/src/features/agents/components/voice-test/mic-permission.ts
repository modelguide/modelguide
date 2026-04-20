/**
 * Pre-flight microphone permission probe.
 *
 * A denied or missing mic is by far the most common failure mode for the
 * voice-test flow — this helper fails fast with an actionable error string
 * BEFORE we spend a LiveKit dispatch + token roundtrip that the operator
 * would then have to abandon.
 *
 * Why two-stage (Permissions API then getUserMedia fallback):
 *   Re-probing via `getUserMedia` when the Permissions API already says
 *   "granted" is what trips up exclusive-use devices (Bluetooth headsets)
 *   and Safari's older behaviour. We only acquire the mic for a real probe
 *   when the permission state is unknown or "prompt".
 */

export type MicPermissionState = 'granted' | 'denied' | 'prompt' | 'unknown'

async function queryMicPermission(): Promise<MicPermissionState> {
  const perms = navigator.permissions as Permissions | undefined
  if (!perms || typeof perms.query !== 'function') return 'unknown'
  try {
    // `microphone` is not in every TS lib.dom build yet — cast through
    // PermissionName to avoid narrowing errors across targets.
    const status = await perms.query({ name: 'microphone' as PermissionName })
    return status.state
  } catch {
    return 'unknown'
  }
}

/**
 * Ensure the browser has microphone access, throwing a user-friendly
 * error if not. Returns silently on success.
 */
export async function ensureMicPermission(): Promise<void> {
  const permissionState = await queryMicPermission()
  if (permissionState === 'denied') {
    throw new Error('Microphone permission denied. Enable mic access and try again.')
  }
  if (permissionState === 'granted') return

  // Either "prompt" or permissions API unavailable — do a real probe so
  // we can surface a useful error before spending a dispatch.
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    for (const t of stream.getTracks()) t.stop()
  } catch (err) {
    const name = (err as DOMException)?.name
    if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
      throw new Error('Microphone permission denied. Enable mic access and try again.')
    }
    if (name === 'NotFoundError') {
      throw new Error('No microphone detected. Plug in a mic and try again.')
    }
    throw err instanceof Error ? err : new Error('Could not access microphone.')
  }
}
