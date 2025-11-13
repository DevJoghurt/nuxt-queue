import Queue from '../../../src/module'

export default defineNuxtConfig({
  modules: [Queue],
  queue: {
    ui: false, // Disable UI for test fixture
  },
})
