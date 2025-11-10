import { watch, onBeforeUnmount, type Ref } from '#imports'

/**
 * Composable for auto-polling flow runs list
 * Polls continuously to keep the list fresh
 */
export function useFlowRunsPolling(
  refresh: () => Promise<void>,
  shouldPoll: Ref<boolean>,
  intervalMs = 3000, // Poll every 3 seconds
) {
  let intervalId: NodeJS.Timeout | null = null

  const pause = () => {
    if (intervalId) {
      clearInterval(intervalId)
      intervalId = null
    }
  }

  const resume = () => {
    if (!intervalId) {
      intervalId = setInterval(async () => {
        if (shouldPoll.value) {
          await refresh()
        }
      }, intervalMs)
    }
  }

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
