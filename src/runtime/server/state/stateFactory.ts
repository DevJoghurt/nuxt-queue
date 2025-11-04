import { useRuntimeConfig } from '#imports'
import type { StateProvider } from './types'
import { createRedisStateProvider } from './adapters/redis'

let currentStateProvider: StateProvider | null = null

export function getStateProvider(): StateProvider {
  if (currentStateProvider) return currentStateProvider
  const rc: any = useRuntimeConfig()
  const adapter = rc?.queue?.state?.adapter || 'redis'
  const ns = rc?.queue?.state?.namespace || 'nq'
  if (adapter === 'redis') {
    currentStateProvider = createRedisStateProvider(ns)
    return currentStateProvider
  }
  throw new Error(`[nuxt-queue] Unsupported StateProvider: ${adapter}`)
}

export function setStateProvider(p: StateProvider) {
  currentStateProvider = p
}
