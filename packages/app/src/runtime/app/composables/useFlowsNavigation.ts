import { computed, ref, watch, useRoute, useRouter } from '#imports'

/**
 * Composable for managing flows page navigation state
 * Uses URL query params for persistence across HMR
 */
export function useFlowsNavigation() {
  const route = useRoute()
  const router = useRouter()

  // Get initial state from URL or use defaults
  const selectedFlow = computed({
    get: () => (route.query.flow as string) || '',
    set: (value: string) => {
      router.push({
        query: {
          ...route.query,
          flow: value || undefined,
          run: undefined, // Clear run when flow changes
        },
      })
    },
  })

  const selectedRunId = computed({
    get: () => (route.query.run as string) || '',
    set: (value: string) => {
      router.push({
        query: {
          ...route.query,
          run: value || undefined,
        },
      })
    },
  })

  // Use a local ref for timelineOpen instead of URL-based state
  // This allows immediate synchronous updates for the UI
  const timelineOpen = ref(route.query.timeline === 'true')

  // Sync back to URL when it changes
  watch(timelineOpen, (value) => {
    router.push({
      query: {
        ...route.query,
        timeline: value ? 'true' : undefined,
      },
    })
  })

  // Sync from URL when route changes (e.g., back button)
  watch(() => route.query.timeline, (value) => {
    timelineOpen.value = value === 'true'
  })

  const selectedTab = computed({
    get: () => (route.query.tab as string) || 'overview',
    set: (value: string) => {
      router.push({
        query: {
          ...route.query,
          tab: value !== 'overview' ? value : undefined,
        },
      })
    },
  })

  return {
    selectedFlow,
    selectedRunId,
    timelineOpen,
    selectedTab,
  }
}
