export default defineNuxtConfig({
  modules: [
    '../dist/module',
  ],
  devtools: {
    enabled: true,
  },
  compatibilityDate: '2024-07-03',
  queue: {
    ui: true,
    redis: {
      host: '127.0.0.1',
      port: 6379,
      password: 'medplum',
    },
    queues: {
      CronQueue: {
        origin: 'remote',
      },
      DownloadQueue: {
        origin: 'remote',
      },
      ReindexQueue: {
        origin: 'remote',
      },
      SubscriptionQueue: {
        origin: 'remote',
      },
    },
  },
})
