import { defineConfig } from 'vitest/config'
import { defineVitestProject } from '@nuxt/test-utils/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  test: {
    globals: true,
    testTimeout: 60000,
    hookTimeout: 30000,
    projects: [
      {
        test: {
          name: 'unit',
          include: ['test/unit/configuration.test.ts'],
          environment: 'node',
        },
      },
      await defineVitestProject({
        test: {
          name: 'e2e',
          include: ['test/e2e/*.test.ts'],
          environment: 'nuxt',
          environmentOptions: {
            nuxt: {
              rootDir: fileURLToPath(new URL('./test/fixtures/base', import.meta.url)),
            },
          },
        },
      }),
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['packages/*/src/**/*.ts'],
      exclude: [
        'packages/*/src/**/*.d.ts',
        'packages/*/src/**/types.ts',
        'test/**',
        '**/node_modules/**',
        '**/dist/**',
      ],
    },
  },
})
