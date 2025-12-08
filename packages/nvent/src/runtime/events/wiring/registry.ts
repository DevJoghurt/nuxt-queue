import { createFlowWiring } from './flowWiring'
import { createStreamWiring } from './streamWiring'
import { createStateWiring } from './stateWiring'
import { createTriggerWiring } from './triggerWiring'

// Use globalThis to ensure singleton survives HMR reloads when used as npm package
const WIRING_KEY = '__nvent_wiring__'

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
  // Check if wiring already exists (HMR protection)
  const existingWiring = (globalThis as any)[WIRING_KEY] as Wiring | undefined
  if (existingWiring) {
    return existingWiring
  }

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
  const wiring: Wiring = {
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
      // Clear globalThis on stop to allow fresh initialization after explicit shutdown
      ;(globalThis as any)[WIRING_KEY] = null
    },
  }

  // Store in globalThis to survive HMR
  ;(globalThis as any)[WIRING_KEY] = wiring

  return wiring
}
