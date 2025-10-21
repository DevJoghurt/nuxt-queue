import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'
import { setup, $fetch } from '@nuxt/test-utils/e2e'

// Basic registry exposure test using existing basic fixture

describe('registry endpoint', async () => {
  await setup({
    rootDir: fileURLToPath(new URL('./fixtures/basic', import.meta.url)),
  })

  it('returns a compiled registry snapshot', async () => {
    const reg = await $fetch<any>('/api/_queue/registry')
    expect(reg).toBeDefined()
    expect(reg).toHaveProperty('workers')
    expect(reg).toHaveProperty('flows')
    expect(reg).toHaveProperty('eventIndex')
  })
})
