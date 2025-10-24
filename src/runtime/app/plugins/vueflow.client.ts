import { defineNuxtPlugin } from '#app'
import { VueFlow } from '@vue-flow/core'
import { Controls } from '@vue-flow/controls'
import { MiniMap } from '@vue-flow/minimap'
import { Background } from '@vue-flow/background'

// Core styles
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'
// Optional package styles
import '@vue-flow/controls/dist/style.css'
import '@vue-flow/minimap/dist/style.css'

export default defineNuxtPlugin((nuxtApp) => {
  // Register Vue Flow components globally for client-only usage
  nuxtApp.vueApp.component('VueFlow', VueFlow)
  nuxtApp.vueApp.component('Controls', Controls)
  nuxtApp.vueApp.component('MiniMap', MiniMap)
  nuxtApp.vueApp.component('Background', Background)
})
