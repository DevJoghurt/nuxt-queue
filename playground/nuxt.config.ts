export default defineNuxtConfig({
  modules: [
    '@nuxt/ui',
    'nuxt-mcp',
    '../src/module',
  ],

  devtools: {
    enabled: true,
  },

  css: ['~/assets/css/main.css'],

  colorMode: {
    preference: 'light',
  },

  runtimeConfig: {
    queue: {
      eventStore: {
        name: 'redis',
        mode: 'streams',
      },
    },
  },

  queue: {
    debug: { events: true },
  },
})
