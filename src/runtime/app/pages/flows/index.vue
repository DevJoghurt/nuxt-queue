<template>
  <div class="h-full flex flex-col overflow-hidden">
    <!-- Header -->
    <div class="border-b border-gray-200 dark:border-gray-800 px-6 py-3 shrink-0">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-4">
          <h1 class="text-lg font-semibold">
            Flows
          </h1>
        </div>
        <div class="flex items-center gap-3">
          <USelectMenu
            v-model="selectedFlowObj"
            :items="(flows || []).map(f => ({ label: f.id, value: f.id }))"
            placeholder="Select a flow..."
            class="w-64"
          >
            <template #leading="{ modelValue }">
              <UIcon
                v-if="modelValue"
                name="i-lucide-git-branch"
                class="w-4 h-4 text-gray-500"
              />
            </template>
          </USelectMenu>
        </div>
      </div>
    </div>

    <!-- Main Content -->
    <div class="flex-1 min-h-0 overflow-hidden">
      <div class="h-full flex gap-px bg-gray-200 dark:bg-gray-800">
        <!-- Runs List -->
        <div class="w-1/3 bg-white dark:bg-gray-950 flex flex-col min-h-0">
          <div class="px-4 py-3 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between shrink-0">
            <h2 class="text-sm font-medium text-gray-900 dark:text-gray-100">
              Runs
            </h2>
            <div class="flex items-center gap-2">
              <div
                v-if="selectedFlow && runs?.items"
                class="flex items-center gap-2 text-xs text-gray-500"
              >
                <UIcon
                  name="i-lucide-list"
                  class="w-3.5 h-3.5"
                />
                <span>{{ runs.items.length }} run{{ runs.items.length === 1 ? '' : 's' }}</span>
              </div>
              <UButton
                v-if="selectedFlow"
                icon="i-lucide-play"
                size="xs"
                color="primary"
                variant="soft"
                @click="openStartFlowModal"
              >
                Start
              </UButton>
            </div>
          </div>
          <div class="flex-1 overflow-y-auto min-h-0">
            <div
              v-if="!selectedFlow"
              class="h-full flex items-center justify-center text-sm text-gray-400 px-4 text-center"
            >
              Select a flow to view runs
            </div>
            <div
              v-else-if="runs?.items.length === 0"
              class="h-full flex items-center justify-center text-sm text-gray-400"
            >
              No runs yet
            </div>
            <div
              v-else
              class="divide-y divide-gray-100 dark:divide-gray-800"
            >
              <div
                v-for="r in runs?.items"
                :key="r.id"
                class="group"
              >
                <div
                  class="px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-900/50 transition-colors cursor-pointer"
                  :class="{ 'bg-gray-50 dark:bg-gray-900': selectedRunId === r.id }"
                  @click="selectRun(r.id)"
                >
                  <div class="flex items-start justify-between gap-3">
                    <div class="flex-1 min-w-0">
                      <div class="flex items-center gap-2">
                        <div class="text-xs font-mono text-gray-900 dark:text-gray-100 truncate">
                          {{ r.id?.substring(0, 8) }}...{{ r.id?.substring(r.id?.length - 4) }}
                        </div>
                        <!-- Status indicator for selected run -->
                        <div
                          v-if="selectedRunId === r.id"
                          class="flex items-center gap-1.5 px-1.5 py-0.5 rounded text-xs border shrink-0"
                          :class="{
                            'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800': flowState.isCompleted.value,
                            'bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800': flowState.isFailed.value,
                            'bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800': flowState.isRunning.value,
                            'bg-gray-50 dark:bg-gray-900/30 border-gray-200 dark:border-gray-800': !flowState.isRunning.value && !flowState.isCompleted.value && !flowState.isFailed.value,
                          }"
                        >
                          <div
                            class="w-1 h-1 rounded-full"
                            :class="{
                              'bg-emerald-500': flowState.isCompleted.value,
                              'bg-red-500': flowState.isFailed.value,
                              'bg-blue-500 animate-pulse': flowState.isRunning.value && !timelineReconnecting,
                              'bg-amber-500 animate-pulse': timelineReconnecting,
                              'bg-gray-400': !flowState.isRunning.value && !flowState.isCompleted.value && !flowState.isFailed.value,
                            }"
                          />
                          <span
                            class="text-[10px] font-medium uppercase tracking-wider"
                            :class="{
                              'text-emerald-700 dark:text-emerald-400': flowState.isCompleted.value,
                              'text-red-700 dark:text-red-400': flowState.isFailed.value,
                              'text-blue-700 dark:text-blue-400': flowState.isRunning.value,
                              'text-gray-600 dark:text-gray-400': !flowState.isRunning.value && !flowState.isCompleted.value && !flowState.isFailed.value,
                            }"
                          >
                            <template v-if="timelineReconnecting">
                              Reconnecting
                            </template>
                            <template v-else-if="flowState.isRunning.value">
                              Running
                            </template>
                            <template v-else-if="flowState.isCompleted.value">
                              Done
                            </template>
                            <template v-else-if="flowState.isFailed.value">
                              Failed
                            </template>
                            <template v-else>
                              Idle
                            </template>
                          </span>
                        </div>
                      </div>
                      <div class="text-xs text-gray-500 mt-1">
                        {{ formatTime(r.createdAt || r.ts || r.startedAt) }}
                      </div>
                    </div>
                    <UButton
                      icon="i-lucide-panels-right-bottom"
                      size="xs"
                      color="neutral"
                      variant="ghost"
                      square
                      title="Open timeline"
                      @click.stop="openRunTimeline(r.id)"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Flow Diagram -->
        <div class="flex-1 bg-white dark:bg-gray-950 flex flex-col min-h-0">
          <div class="px-4 py-3 border-b border-gray-200 dark:border-gray-800 shrink-0">
            <div class="flex items-center justify-between">
              <h2 class="text-sm font-medium text-gray-900 dark:text-gray-100">
                Flow Diagram
              </h2>
              <div class="flex items-center gap-2">
                <span
                  v-if="selectedRunId"
                  class="text-xs text-gray-500"
                >
                  Run: {{ selectedRunId.substring(0, 8) }}...
                </span>
                <span
                  v-else-if="selectedFlow"
                  class="text-xs font-mono text-gray-500"
                >
                  {{ selectedFlow }}
                </span>
              </div>
            </div>
          </div>
          <div class="flex-1 min-h-0">
            <div
              v-if="!selectedFlow"
              class="h-full flex items-center justify-center text-sm text-gray-400"
            >
              Select a flow to view diagram
            </div>
            <FlowDiagram
              v-else
              :flow="selectedFlowMeta"
              :show-controls="true"
              :show-background="true"
              :step-states="diagramStepStates"
              height-class="h-full"
              @node-action="handleNodeAction"
            />
          </div>
        </div>
      </div>
    </div>

    <!-- Timeline Slideover -->
    <USlideover v-model:open="timelineOpen">
      <template #title>
        <div class="flex items-center justify-between w-full pr-4">
          <div>
            <div class="text-sm font-semibold">
              Flow Timeline
            </div>
            <div class="text-xs font-mono text-gray-500 mt-0.5">
              {{ timelineRunId.substring(0, 8) }}...{{ timelineRunId.substring(timelineRunId.length - 4) }}
            </div>
          </div>
          <div
            v-if="timelineReconnecting || (timelineOpenSSE && flowState.isRunning.value)"
            class="flex items-center gap-2 text-xs"
          >
            <div
              class="w-2 h-2 rounded-full"
              :class="timelineReconnecting ? 'bg-amber-500 animate-pulse' : 'bg-emerald-500 animate-pulse'"
            />
            <span class="text-gray-500">{{ timelineReconnecting ? 'Reconnecting' : 'Live' }}</span>
          </div>
          <div
            v-else-if="flowState.isCompleted.value"
            class="flex items-center gap-2 text-xs"
          >
            <div class="w-2 h-2 rounded-full bg-emerald-500" />
            <span class="text-gray-500">Completed</span>
          </div>
          <div
            v-else-if="flowState.isFailed.value"
            class="flex items-center gap-2 text-xs"
          >
            <div class="w-2 h-2 rounded-full bg-red-500" />
            <span class="text-gray-500">Failed</span>
          </div>
        </div>
      </template>
      <template #body>
        <UTabs
          v-model="selectedTab"
          :items="tabs"
        />

        <!-- Tab Content -->
        <FlowRunOverview
          v-if="selectedTab === 'overview'"
          :run-status="runSnapshot.status"
          :started-at="runSnapshot.startedAt"
          :completed-at="runSnapshot.completedAt"
          :steps="flowState.stepList.value"
        />

        <FlowRunLogs
          v-else-if="selectedTab === 'logs'"
          :logs="flowState.state.value.logs"
        />

        <FlowRunTimeline
          v-else-if="selectedTab === 'timeline'"
          :events="timeline"
          :is-live="timelineOpenSSE"
          @export="exportTimelineJson"
          @clear="clearTimeline"
        />
      </template>
    </USlideover>

    <!-- Start Flow Modal -->
    <UModal v-model:open="startFlowModalOpen">
      <template #header>
        <div class="flex items-center justify-between">
          <div>
            <h3 class="text-lg font-semibold">
              Start Flow Run
            </h3>
            <p class="text-sm text-gray-500 mt-1">
              {{ selectedFlow }}
            </p>
          </div>
        </div>
      </template>
      <template #body>
        <div class="space-y-4">
          <div>
            <label class="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 block">
              Input Data (JSON)
            </label>
            <UTextarea
              v-model="flowInputJson"
              :rows="12"
              placeholder="{\n  &quot;key&quot;: &quot;value&quot;\n}"
              class="w-full font-mono text-sm"
            />
            <p
              v-if="jsonError"
              class="text-xs text-red-500 mt-2"
            >
              {{ jsonError }}
            </p>
          </div>
        </div>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2">
          <UButton
            color="neutral"
            variant="ghost"
            @click="startFlowModalOpen = false"
          >
            Cancel
          </UButton>
          <UButton
            color="primary"
            :loading="startingFlow"
            :disabled="!!jsonError"
            @click="startFlowRun"
          >
            Start Flow
          </UButton>
        </div>
      </template>
    </UModal>
  </div>
</template>

<script setup lang="ts">
import { ref, onBeforeUnmount, computed, watch, nextTick } from '#imports'
import { useIntervalFn } from '@vueuse/core'
import FlowDiagram from '../../components/FlowDiagram.vue'
import FlowRunOverview from '../../components/FlowRunOverview.vue'
import FlowRunLogs from '../../components/FlowRunLogs.vue'
import FlowRunTimeline from '../../components/FlowRunTimeline.vue'
import useEventSSE from '../../composables/useEventSSE'
import { useFlowState } from '../../composables/useFlowState'

const selectedFlow = ref<string>('')
const selectedFlowObj = ref<{ label: string, value: string } | undefined>(undefined)
const selectedRunId = ref<string>('')

const timelineOpen = ref<boolean>(false)
const timelineRunId = ref<string>('')
const selectedTab = ref('overview')

// Start flow modal
const startFlowModalOpen = ref<boolean>(false)
const flowInputJson = ref<string>('{}')
const jsonError = ref<string>('')
const startingFlow = ref<boolean>(false)

const { data: flows } = await useFetch<any[]>('/api/_flows')

const { data: runs, refresh: refreshRuns } = useFetch(() => `/api/_flows/${encodeURIComponent(selectedFlow.value)}/runs`, {
  immediate: false,
  watch: [selectedFlow],
})

// Watch for JSON validation
watch(flowInputJson, (value) => {
  try {
    JSON.parse(value)
    jsonError.value = ''
  }
  catch (err) {
    jsonError.value = err instanceof Error ? err.message : 'Invalid JSON'
  }
})

// Tab configuration
const tabs = [
  { label: 'Overview', value: 'overview', icon: 'i-lucide-layout-dashboard' },
  { label: 'Logs', value: 'logs', icon: 'i-lucide-file-text' },
  { label: 'Timeline', value: 'timeline', icon: 'i-lucide-activity' },
]

// Use client-side reducer for flow state
const flowState = useFlowState()

// Separate SSE channels for runs list and timeline
const runsSSE = useEventSSE()
const timelineSSE = useEventSSE()
const timelineOpenSSE = timelineSSE.open
const timelineReconnecting = timelineSSE.reconnecting

// Helper to format timestamps
const formatTime = (timestamp: string | number | Date) => {
  const date = new Date(timestamp)
  const now = new Date()
  const diff = now.getTime() - date.getTime()
  const seconds = Math.floor(diff / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (days > 0) return `${days}d ago`
  if (hours > 0) return `${hours}h ago`
  if (minutes > 0) return `${minutes}m ago`
  if (seconds > 10) return `${seconds}s ago`
  return 'just now'
}

// Computed state from reducer
const runSnapshot = computed(() => {
  const state = flowState.state.value
  return {
    status: state.status,
    startedAt: state.startedAt,
    completedAt: state.completedAt,
    logsCount: state.logs.length,
    lastLogLevel: state.logs.length > 0 ? state.logs[state.logs.length - 1]?.level : undefined,
  }
})

const timeline = computed(() => flowState.events.value)

// Watch for flow selection changes from USelectMenu
watch(selectedFlowObj, (newFlowObj) => {
  const newFlow = newFlowObj?.value || ''
  if (newFlow !== selectedFlow.value) {
    selectedFlow.value = newFlow
    selectedRunId.value = ''
    // useFetch will automatically refetch due to watch option
    refreshRuns()
  }
})

// Also watch selectedFlow directly for programmatic changes
watch(selectedFlow, (newFlow) => {
  if (newFlow && (!selectedFlowObj.value || selectedFlowObj.value.value !== newFlow)) {
    selectedFlowObj.value = { label: newFlow, value: newFlow }
    selectedRunId.value = ''
    // useFetch will automatically refetch due to watch option
    refreshRuns()
  }
  else if (!newFlow) {
    selectedFlowObj.value = undefined
  }
})

const selectedFlowMeta = computed(() => {
  const id = selectedFlow.value
  if (!id) return null
  return (flows.value || []).find((f: any) => f?.id === id) || null
})

const diagramStepStates = computed(() => {
  if (!selectedRunId.value) return undefined
  const steps = flowState.state.value.steps
  console.log('[Flow Diagram] Computing step states:', {
    selectedRunId: selectedRunId.value,
    hasSteps: !!steps,
    stepCount: Object.keys(steps).length,
    steps,
  })
  return steps
})

// Select a run to view its interactive diagram
const selectRun = async (runId: string) => {
  console.log('[Flow Diagram] Selecting run:', runId)
  
  // Reset flow state first
  flowState.reset()

  console.log('[Flow Diagram] Loading run state:', runId)

  // Set the selected run and timeline run IDs
  selectedRunId.value = runId
  timelineRunId.value = runId

  // Wait for watchers to process
  await nextTick()

  // Start SSE stream for live updates - SSE will load initial events
  startTimelineTail()
}

// Open the timeline slideover for a run
const openRunTimeline = async (runId: string) => {
  // If already selected, just open the slideover
  if (selectedRunId.value === runId) {
    timelineOpen.value = true
    return
  }

  // Otherwise, select the run first (which loads data and starts SSE)
  await selectRun(runId)
  
  // Then open the slideover
  timelineOpen.value = true
}

const startTimelineTail = () => {
  if (!timelineRunId.value) return
  // Use _flows SSE stream endpoint
  const url = `/api/_flows/${encodeURIComponent(selectedFlow.value)}/${encodeURIComponent(timelineRunId.value)}/stream`
  timelineSSE.start(url, (msg) => {
    if (msg?.record) {
      console.log('[Flow Timeline] SSE event received:', {
        kind: msg.record.kind,
        step: msg.record.step,
        data: msg.record.data,
        meta: msg.record.meta,
      })
      flowState.addEvent(msg.record)
    }
  }, {
    autoReconnect: true,
    maxRetries: 30,
    baseDelayMs: 500,
    maxDelayMs: 10000,
  })
}

const exportTimelineJson = () => {
  const blob = new Blob([JSON.stringify(flowState.events.value, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `flow-${selectedFlow.value}-${timelineRunId.value}-events-${new Date().toISOString()}.json`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

const clearTimeline = () => {
  flowState.reset()
}

// Handle node card button actions
const handleNodeAction = (payload: { id: string, action: 'run' | 'logs' | 'details' }) => {
  console.log('[Flow Diagram] Node action:', payload)
  
  const stepName = payload.id.split(':')[1] // Extract step name from "entry:stepName" or "step:stepName"
  
  switch (payload.action) {
    case 'logs':
      // Open the slideover and switch to logs tab, filtered by step
      if (selectedRunId.value) {
        timelineOpen.value = true
        selectedTab.value = 'logs'
        // TODO: Add step filtering to logs view
        console.log('Show logs for step:', stepName)
      }
      else {
        alert('Please select a flow run first to view logs.')
      }
      break
    
    case 'details':
      // Open the slideover and show step details in overview
      if (selectedRunId.value) {
        timelineOpen.value = true
        selectedTab.value = 'overview'
        console.log('Show details for step:', stepName)
      }
      else {
        alert('Please select a flow run first to view details.')
      }
      break
  }
}

const openStartFlowModal = () => {
  flowInputJson.value = '{}'
  jsonError.value = ''
  startFlowModalOpen.value = true
}

const startFlowRun = async () => {
  if (!selectedFlow.value || jsonError.value) return

  try {
    startingFlow.value = true
    const input = JSON.parse(flowInputJson.value)

    const result = await $fetch<{ flowId: string }>(`/api/_flows/${encodeURIComponent(selectedFlow.value)}/start`, {
      method: 'POST',
      body: input,
    })

    startFlowModalOpen.value = false
    flowInputJson.value = '{}'

    // Refresh runs list to show the new run
    await refreshRuns()
    startTimelineTail()

    // Optionally open the new run immediately
    if (result?.flowId) {
      await openRunTimeline(result.flowId)
    }
  }
  catch (err) {
    console.error('Failed to start flow:', err)
    jsonError.value = err instanceof Error ? err.message : 'Failed to start flow'
  }
  finally {
    startingFlow.value = false
  }
}

// Auto-manage polling for new runs when selectedFlow changes
// Don't poll when we have an active SSE connection for a selected run
const { pause: pausePolling, resume: resumePolling } = useIntervalFn(
  async () => {
    // Only poll if we have a flow selected but no run selected (or slideover is closed)
    if (selectedFlow.value && !selectedRunId.value) {
      await refreshRuns()
    }
  },
  5000, // Poll every 5 seconds
  { immediate: false }, // Don't start immediately
)

watch(selectedFlow, async (name, _prev) => {
  try {
    runsSSE.stop()
  }
  catch {
    // ignore
  }
  
  // Pause polling first
  pausePolling()
  
  if (name) {
    // useFetch will automatically refetch due to watch option
    // Start polling for new runs (only when no run is selected)
    resumePolling()
  }
})

onBeforeUnmount(() => {
  pausePolling()
  // Clean up SSE connections
  try {
    timelineSSE.stop()
    runsSSE.stop()
  }
  catch {
    // ignore
  }
})

// Manage SSE connection and polling based on selected run
// SSE runs continuously while a run is selected, regardless of slideover state
watch(selectedRunId, (runId, oldRunId) => {
  // If we're switching between runs, stop the old SSE
  if (oldRunId && oldRunId !== runId) {
    try {
      timelineSSE.stop()
    }
    catch {
      // ignore
    }
  }
  
  // If no run is selected, stop SSE and resume polling
  if (!runId) {
    try {
      timelineSSE.stop()
    }
    catch {
      // ignore
    }
    if (selectedFlow.value) {
      resumePolling()
    }
    return
  }
  
  // If a new run is selected, pause polling
  // Note: SSE will be started by selectRun() calling startTimelineTail()
  pausePolling()
}, { flush: 'post' }) // Run after selectRun() completes
</script>
