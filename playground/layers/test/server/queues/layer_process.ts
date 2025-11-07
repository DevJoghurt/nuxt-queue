export const config = defineQueueConfig({
  flow: {
    name: ['resize2'],
    role: 'entry',
    step: 'resize',
    emits: ['resize.completed'],
    subscribes: ['thumbnail'],
  },
})

function test() {}

export default test
