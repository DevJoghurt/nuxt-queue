<template>
  <section class="h-full">
    <!-- Layout container switches between column (horizontal nav top) and row (vertical nav left) -->
    <div
      :class="
        orientation === 'vertical' ? 'flex h-full' : 'flex flex-col w-full'"
      :style="containerStyle"
    >
      <!-- Navigation using UNavigationMenu -->
      <div
        :class="[
          'border-gray-200',
          orientation === 'vertical'
            ? 'min-w-[256px] border-r'
            : 'border-b',
        ]"
      >
        <UNavigationMenu
          :items="navigationItems"
          :orientation="orientation"
          content-orientation="vertical"
          :class="orientation === 'horizontal' ? 'px-4' : ''"
        />
      </div>

      <!-- Main Content -->
      <div
        class="flex-1 min-h-0 overflow-hidden"
      >
        <slot />
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useComponentRouter, useRoute, useRuntimeConfig } from '#imports'
import type { NavigationMenuItem } from '@nuxt/ui'

const props = withDefaults(
  defineProps<{
    orientation?: 'horizontal' | 'vertical'
    items?: NavigationMenuItem[][]
    activeMatch?: 'exact' | 'prefix'
    fullPage?: boolean
  }>(),
  {
    orientation: 'horizontal',
    activeMatch: 'prefix',
  },
)

const router = useComponentRouter()
const nuxtRoute = useRoute()
const config = useRuntimeConfig()

// Auto-detect if we're in a full page context (Nuxt route exists and matches configured route path)
const isFullPage = computed(() => {
  if (props.fullPage !== undefined) return props.fullPage
  // Check if we're in a Nuxt route context matching the configured nvent route path
  const nventPath = (config.public.nventapp as any)?.routePath || '/_nvent'
  return nuxtRoute?.path?.startsWith(nventPath) ?? false
})

// Container height style - full viewport minus header when full page, 100% otherwise
const containerStyle = computed(() => {
  return isFullPage.value
    ? 'height: calc(100vh - 4rem)'
    : 'height: 100vh'
})

// Transform items to include onSelect handlers for routing and active state
const navigationItems = computed(() => {
  if (!props.items) return []

  const transformItem = (item: any): any => {
    const path = (item as any).path
    const transformed: any = {
      ...item,
      onSelect: (e: Event) => {
        e.preventDefault()
        if (path) {
          router.push(path)
        }
        // Call original onSelect if provided
        if (item.onSelect) {
          item.onSelect(e)
        }
      },
      active: path ? isActive(path) : item.active,
    }

    // Handle children recursively
    if (item.children) {
      // Check if children is an array of arrays or a flat array
      if (Array.isArray(item.children[0]) && Array.isArray(item.children[0][0])) {
        // Children is array of arrays
        transformed.children = item.children.map((childGroup: any[]) =>
          childGroup.map(transformItem),
        )
      }
      else {
        // Children is a flat array
        transformed.children = item.children.map(transformItem)
      }
    }

    return transformed
  }

  return props.items.map(group =>
    group.map(transformItem),
  )
})

function isActive(path: string) {
  if (!path) return false
  const current = router.route?.value?.path || ''
  if (props.activeMatch === 'prefix') return isPrefixActive(current, path)
  return current === path
}

function isPrefixActive(current: string, base: string) {
  // Root should not match everything
  if (base === '/') return current === '/'
  if (current === base) return true
  // Ensure boundary match: '/packages' matches '/packages/...' but not '/packagesX'
  return current.startsWith(base.endsWith('/') ? base : base + '/')
}
</script>
