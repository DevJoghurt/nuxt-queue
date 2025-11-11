import { createFlowWiring } from './flowWiring'

export interface Wiring {
  start(): void
  stop(): void
}

export function createWiringRegistry(): Wiring {
  // v0.3: Simplified wiring - just flow timeline + index
  const wirings: Wiring[] = [
    createFlowWiring(),
    // add future wirings here (triggers, webhooks, etc.)
  ]
  let started = false
  return {
    start() {
      if (started) return
      started = true
      for (const w of wirings) w.start()
    },
    stop() {
      for (const w of wirings) {
        try {
          w.stop()
        }
        catch {
          // ignore
        }
      }
      started = false
    },
  }
}
