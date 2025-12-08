import { ref, computed, watch, onMounted, onUnmounted, type Ref } from '#imports'
import { useFlowWebSocket } from './useFlowWebSocket'

interface FlowRunsState {
  shouldRefreshRuns: boolean
  lastUpdate: number | null
}

/**
 * Composable for real-time flow runs updates via WebSocket
 * Similar to useQueueUpdates - triggers refresh flag when flow stats change
 */
export function useFlowRunsUpdates(flowName: Ref<string>) {
  const flowWs = useFlowWebSocket()
  const state = ref<FlowRunsState>({
    shouldRefreshRuns: false,
    lastUpdate: null,
  })

  // Track previous stats to detect changes
  let previousStats: { total?: number, running?: number } | null = null

  // Subscribe to flow stats updates
  const setupSubscription = () => {
    if (!import.meta.client) return

    flowWs.subscribeStats({
      onInitial: (data: any) => {
        // Only care about our flow
        if (data.id !== flowName.value) return

        const stats = data?.metadata?.stats
        if (stats) {
          previousStats = { total: stats.total, running: stats.running }
        }
      },
      onUpdate: (data: any) => {
        // Only care about our flow
        if (data.id !== flowName.value) return

        const stats = data?.metadata?.stats
        if (!stats) return

        // Check if stats changed in a way that affects the runs list
        const hasNewRuns = previousStats && stats.total !== previousStats.total
        const runningChanged = previousStats && stats.running !== previousStats.running

        if (hasNewRuns || runningChanged) {
          state.value.shouldRefreshRuns = true
          state.value.lastUpdate = Date.now()
        }

        // Update previous stats
        previousStats = { total: stats.total, running: stats.running }
      },
    })
  }

  // Reset the refresh flag after consuming it
  const resetRefreshFlag = () => {
    state.value.shouldRefreshRuns = false
  }

  // Setup subscription on mount
  onMounted(() => {
    if (import.meta.client && flowName.value) {
      setupSubscription()
    }
  })

  // Watch for flow name changes
  watch(flowName, (newName, oldName) => {
    if (newName && newName !== oldName) {
      // Reset state for new flow
      previousStats = null
      state.value.shouldRefreshRuns = false
      state.value.lastUpdate = null
    }
  })

  // Cleanup on unmount
  onUnmounted(() => {
    flowWs.unsubscribeStats()
  })

  return {
    isConnected: flowWs.connected,
    isReconnecting: flowWs.reconnecting,
    shouldRefreshRuns: computed(() => state.value.shouldRefreshRuns),
    lastUpdate: computed(() => state.value.lastUpdate),
    resetRefreshFlag,
  }
}
