import type { QueueProvider } from './contracts'

let currentProvider: QueueProvider | null = null

export function setQueueProvider(p: QueueProvider) {
  currentProvider = p
}

export function useQueueProvider(): QueueProvider {
  if (!currentProvider) {
    throw new Error('[nuxt-queue] QueueProvider not initialized')
  }
  return currentProvider
}
