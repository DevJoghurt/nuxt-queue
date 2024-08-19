export default defineNuxtConfig({
  modules: [
    '../src/module',
  ],
  devtools: {
    enabled: true,
  },
  runtimeConfig: {
    queue: {
      redis: {
        host: '127.0.0.1',
        port: 6379,
      },
      queues: {
        CronQueue: {
          origin: 'remote'
        },
        DownloadQueue: {
          origin: 'remote'
        },
        ReindexQueue: {
          origin: 'remote'
        },
        SubscriptionQueue: {
          origin: 'remote'
        },
      },
    },
  },
  compatibilityDate: '2024-07-03',
})
