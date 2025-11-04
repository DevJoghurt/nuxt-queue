import { defineNitroPlugin } from '#imports'
import { getEventStoreFactory } from '../events/eventStoreFactory'

/**
 * Flow Run Snapshots (stream-based)
 *
 * Writes append-only snapshot events to nq:proj:flow:<flowName>:<runId>
 * for key lifecycle kinds:
 *  - flow.start -> status=running
 *  - flow.complete -> status=completed
 *  - runner.log (with correlationId) -> logsCount++ (as a patch)
 *
 * Consumers reduce the small snapshot stream to a final object.
 */
// This plugin is responsible for persisting flow-related events and derived projections.
// It listens to ingress events on the Internal Bus (messages without id/stream) and writes:
// - Raw timeline: nq:flow:<flowId> (append original event)
// - Projections:
//   - flow.snapshot.patch
//   - flow.run.indexed
//   - flow.step.patch
export default defineNitroPlugin(() => {
  // Start event store wiring; EventStoreFactory handles idempotence
  const factory = getEventStoreFactory()
  factory.start()
  return {
    hooks: {
      close: async () => {
        try {
          factory.stop()
        }
        catch {
          // ignore
        }
      },
    },
  }
})
