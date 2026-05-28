/**
 * Public surface for the LoreVault signal emission subsystem.
 */

export { getRecentSignalsView, type RecentSignalsView } from "./admin";
export { InMemoryDeadLetterStore } from "./dead-letter";
export {
  checkEntitlement,
  type EntitlementVerdict,
} from "./entitlement-gate";
export { SignalHistory } from "./history";
export {
  SignalEmissionQueue,
  type SignalEmissionQueueOptions,
} from "./queue";
export {
  defaultRetryPolicy,
  fixedRetryPolicy,
  DEFAULT_MAX_ATTEMPTS,
} from "./retry";
export type {
  DeadLetterEntry,
  DeadLetterStore,
  DeliveryStatus,
  RetryPolicy,
  SignalHistoryEntry,
} from "./types";
