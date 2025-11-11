/**
 * Public exports for adapter interfaces
 * Used by external adapter packages
 */

// Queue Adapter
export type {
  QueueAdapter,
  JobInput,
  Job,
  JobsQuery,
  JobOptions,
  JobState,
  ScheduleOptions,
  JobCounts,
  QueueEvent,
  WorkerHandler,
  WorkerContext,
  WorkerOptions,
} from './runtime/server/adapters/interfaces/queue'

// Stream Adapter
export type {
  StreamAdapter,
  StreamEvent,
  SubscribeOptions,
  SubscriptionHandle,
} from './runtime/server/adapters/interfaces/stream'

// Store Adapter
export type {
  StoreAdapter,
  EventRecord,
  EventReadOptions,
  EventSubscription,
  ListOptions,
} from './runtime/server/adapters/interfaces/store'

// Adapter Registry
export { useAdapterRegistry } from './runtime/server/adapters/registry'
export type { AdapterRegistry } from './runtime/server/adapters/registry'
