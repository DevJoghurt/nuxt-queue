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
} from './runtime/adapters/interfaces/queue'

// Stream Adapter
export type {
  StreamAdapter,
  StreamEvent,
  SubscribeOptions,
  SubscriptionHandle,
} from './runtime/adapters/interfaces/stream'

// Store Adapter
export type {
  StoreAdapter,
  EventRecord,
  EventReadOptions,
  EventSubscription,
  ListOptions,
} from './runtime/adapters/interfaces/store'

// Adapter Registry
export { useAdapterRegistry } from './runtime/adapters/registry'
export type { AdapterRegistry } from './runtime/adapters/registry'
