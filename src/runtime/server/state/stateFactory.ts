import { useRuntimeConfig } from '#imports'
import type { StateProvider } from './types'
import { createRedisStateProvider } from './adapters/redis'

let currentStateProvider: StateProvider | null = null

export function getStateProvider(): StateProvider {
  if (currentStateProvider) return currentStateProvider
  const rc: any = useRuntimeConfig()
  const name = rc?.queue?.state?.name || 'redis'
  const ns = rc?.queue?.state?.namespace || 'nq'
  if (name === 'redis') {
    currentStateProvider = createRedisStateProvider(ns)
    return currentStateProvider
  }
  throw new Error(`[nuxt-queue] Unsupported StateProvider: ${name}`)
}

export function setStateProvider(p: StateProvider) {
  currentStateProvider = p
}
