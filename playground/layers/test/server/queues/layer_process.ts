import { defineQueueConfig, defineQueueWorker } from '#imports'

export const config = defineQueueConfig({
  flow: {
    name: ['resize2'],
    role: 'entry',
    step: 'resize',
    emits: ['resize.completed'],
    subscribes: ['thumbnail'],
  },
})

export default defineQueueWorker(() => {
  throw new Error('Function not implemented.')
})
