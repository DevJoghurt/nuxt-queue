import { createFlowWiring } from './flowWiring'
import { createStreamWiring } from './streamWiring'
import { createStateWiring } from './stateWiring'
import { createTriggerWiring } from './triggerWiring'

export interface Wiring {
  start(): void | Promise<void>
  stop(): void | Promise<void>
}

export interface WiringRegistryOptions {
  /**
   * Stream wiring options
   */
  streamWiring?: {
    enabled?: boolean
  }
  /**
   * State wiring options
   */
  stateWiring?: {
    strategy?: 'never' | 'on-complete' | 'immediate' | 'ttl'
  }
}

export function createWiringRegistry(opts?: WiringRegistryOptions): Wiring {
  // Multiple wirings
  const wirings: Wiring[] = [
    // 1. Flow orchestration (persistence, completion tracking, step triggering)
    createFlowWiring(),

    // 2. Stream wiring (publish persisted events to UI clients)
    createStreamWiring(opts?.streamWiring || {
      enabled: true,
    }),

    // 3. State wiring (automatic state cleanup)
    createStateWiring(opts?.stateWiring),

    // 4. Trigger wiring (v0.5: trigger.fired, await.registered, await.resolved)
    createTriggerWiring(),
  ]
  let started = false
  return {
    async start() {
      if (started) return
      started = true
      for (const w of wirings) await w.start()
    },
    async stop() {
      for (const w of wirings) {
        try {
          await w.stop()
        }
        catch {
          // ignore
        }
      }
      started = false
    },
  }
}
