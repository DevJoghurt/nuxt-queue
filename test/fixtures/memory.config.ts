import NventModule from '../../packages/nvent/src/module'

export default defineNuxtConfig({
  modules: [NventModule],
  nvent: {
    dir: 'server/functions',
    ui: false,
    queue: {
      adapter: 'memory',
      worker: {
        concurrency: 2,
        autorun: true,
      },
    },
    stream: {
      adapter: 'memory',
    },
    store: {
      adapter: 'memory',
      prefix: 'nq-test',
    },
  },
})
