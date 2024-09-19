export default defineNuxtConfig({
  modules: [
    '../src/module',
    '@nuxt/ui',
  ],
  devtools: {
    enabled: true,
  },
  queue: {
    ui: true,
    redis: {
      host: '127.0.0.1',
      port: 6379,
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
  compatibilityDate: '2024-07-03',
})
