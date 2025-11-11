import type { QueueProvider } from './types'

let currentProvider: QueueProvider | null = null

export function setQueueProvider(p: QueueProvider) {
  currentProvider = p
}

export function getQueueProvider(): QueueProvider {
  if (!currentProvider) {
    throw new Error('[nuxt-queue] QueueProvider not initialized')
  }
  return currentProvider
}
