export const config = defineQueueConfig({
  flow: {
    id: 'resize2',
    role: 'main',
    step: 'resize',
    emits: ['resize.completed'],
    triggers: 'thumbnail',
  },
})

function test() {}

export default test
