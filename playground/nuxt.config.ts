export default defineNuxtConfig({
  modules: [
    '../src/module'
  ],
  devtools: { 
    enabled: true 
  },
  runtimeConfig: {
    queue: {
      redis: {
        host: '127.0.0.1',
        port: 6379
      },
      queues: {
        'CronQueue': {
          remote: true
        },
        'DownloadQueue': {
          remote: true
        },
        'ReindexQueue': {
          remote: true
        },
        'SubscriptionQueue': {
          remote: true
        }
      }
    }
  },
  compatibilityDate: '2024-07-03',
})