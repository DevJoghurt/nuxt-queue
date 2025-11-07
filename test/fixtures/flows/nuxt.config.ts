import { defineNuxtConfig } from 'nuxt/config'
import Queue from '../../../src/module'

export default defineNuxtConfig({
  modules: [Queue],
  queue: {
    ui: false, // Disable UI for test fixture
    store: {
      adapter: 'redis',
      redis: {
        host: '127.0.0.1',
        port: 6379,
      },
    },
  },
})
