import { useIntervalFn } from '@vueuse/core'

/**
 * Composable for auto-polling flow runs list
 * Polls continuously to keep the list fresh
 */
export function useFlowRunsPolling(
  refresh: () => Promise<void>,
  shouldPoll: Ref<boolean>,
  intervalMs = 3000, // Poll every 3 seconds
) {
  const { pause, resume } = useIntervalFn(
    async () => {
      if (shouldPoll.value) {
        await refresh()
      }
    },
    intervalMs,
    { immediate: false },
  )

  // Auto-manage polling based on shouldPoll flag
  watch(shouldPoll, (should) => {
    if (should) {
      resume()
    }
    else {
      pause()
    }
  }, { immediate: true })

  onBeforeUnmount(() => {
    pause()
  })

  return {
    pause,
    resume,
  }
}
