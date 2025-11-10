import { useFlowWebSocket } from './useFlowWebSocket'
import { useFlowState } from './useFlowState'
import { computed, nextTick, onBeforeUnmount, type Ref, watch } from 'vue'

/**
 * Composable for managing a single flow run's timeline and state
 *
 * Simple approach: No HMR persistence, rely on component lifecycle + URL state
 * - URL preserves flowId/runId across HMR
 * - Component remounts after HMR with correct state
 * - Fresh WebSocket connection on each mount = clean, predictable behavior
 */
export function useFlowRunTimeline(flowId: Ref<string>, runId: Ref<string>) {
  const flowState = useFlowState()
  const flowWs = useFlowWebSocket()

  // Start WebSocket stream for the run (client-only)
  const startStream = () => {
    if (import.meta.server) return
    if (!flowId.value || !runId.value) {
      return
    }

    flowWs.subscribe({
      flowName: flowId.value,
      runId: runId.value,
      onEvent: (eventData) => {
        if (eventData?.record) {
          flowState.addEvent(eventData.record)
        }
      },
      onHistory: (events) => {
        // Process historical events
        for (const eventData of events) {
          if (eventData?.record) {
            flowState.addEvent(eventData.record)
          }
        }
      },
    }, {
      autoReconnect: true,
      maxRetries: 5,
      baseDelayMs: 500,
      maxDelayMs: 5000,
      onError: (err) => {
        console.warn('[FlowRunTimeline] WebSocket error:', err)
      },
    })
  }

  // Stop WebSocket stream (client-only)
  const stopStream = () => {
    if (import.meta.server) return
    flowWs.stop()
  }

  // Load run and start streaming
  const loadRun = async () => {
    if (!runId.value) return

    // Reset flow state for fresh start
    flowState.reset()

    await nextTick()

    // Start WebSocket stream (includes backfill + live updates)
    startStream()
  }

  // Auto-start when runId changes
  watch(runId, async (newRunId, oldRunId) => {
    // Stop old stream to prevent orphaned connections
    if (oldRunId && oldRunId !== newRunId) {
      stopStream()
      // Wait a bit for cleanup
      await new Promise(resolve => setTimeout(resolve, 100))
    }

    if (newRunId) {
      await loadRun()
    }
    else {
      stopStream()
    }
  }, { immediate: true })

  // Cleanup on unmount (always cleanup, even on HMR)
  // Component will remount after HMR and reconnect via watch
  onBeforeUnmount(() => {
    stopStream()
  })

  return {
    flowState,
    isConnected: computed(() => flowWs.connected.value),
    isReconnecting: computed(() => flowWs.reconnecting.value),
    loadRun,
    stopStream,
  }
}
