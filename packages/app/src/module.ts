import {
  defineNuxtModule,
  createResolver,
  addImportsDir,
  addComponent,
  addComponentsDir,
  addPlugin,
} from '@nuxt/kit'
import defu from 'defu'
import type {} from '@nuxt/schema'

const meta = {
  name: 'nventapp',
  version: '0.1',
  configKey: 'nventapp',
}

type ModuleOptions = Record<string, unknown>

export default defineNuxtModule<ModuleOptions>({
  meta,
  defaults: {},
  moduleDependencies: {
    'json-editor-vue/nuxt': {
      version: '0.18.1',
    },
  },
  async setup(options, nuxt) {
    const { resolve } = createResolver(import.meta.url)

    // Add shared utilities for both app and server
    addImportsDir(resolve('./runtime/shared/utils'))

    addImportsDir(resolve('./runtime/app/composables'))

    // add vueflow assets
    nuxt.options.css = nuxt.options.css || []
    nuxt.options.css.push(resolve('./runtime/app/assets/vueflow.css'))

    addPlugin({
      src: resolve('./runtime/app/plugins/vueflow.client'),
      mode: 'client',
    })
    addComponentsDir({
      path: resolve('./runtime/app/components'),
      prefix: 'Queue',
    })

    addComponent({
      name: 'QueueApp',
      filePath: resolve('./runtime/app/pages/index.vue'),
      global: true,
    })

    // add jsoneditor to vite optimize -> for esm support
    nuxt.options.vite.optimizeDeps = defu(nuxt.options.vite.optimizeDeps, {
      include: ['vanilla-jsoneditor'],
    })
  },
})
