import NventModule from '../../packages/nvent/src/module'

export default defineNuxtConfig({
  modules: [NventModule],
  nvent: {
    dir: 'server/functions',
    ui: false,
    queue: {
      adapter: 'file',
      file: {
        dataDir: '.data-test',
      },
      worker: {
        concurrency: 2,
        autorun: true,
        pollingIntervalMs: 500,
      },
    },
    stream: {
      adapter: 'file',
    },
    store: {
      adapter: 'file',
      prefix: 'nq-test',
      file: {
        dataDir: '.data-test',
      },
    },
  },
})
