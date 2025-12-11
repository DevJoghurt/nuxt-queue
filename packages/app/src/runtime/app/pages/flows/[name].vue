<template>
  <div class="h-full flex flex-col overflow-hidden">
    <!-- Header -->
    <div class="border-b border-gray-200 dark:border-gray-800 px-6 py-3 shrink-0">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-3">
          <UButton
            icon="i-lucide-arrow-left"
            size="xs"
            color="neutral"
            variant="ghost"
            square
            @click="goBack"
          />
          <div>
            <h1 class="text-lg font-semibold flex items-center gap-2">
              <UIcon
                name="i-lucide-git-branch"
                class="w-5 h-5 text-blue-500"
              />
              <span>{{ selectedFlow }}</span>
            </h1>
            <div
              v-if="selectedFlowMeta"
              class="flex items-center gap-2 mt-1"
            >
              <UBadge
                v-if="selectedFlowMeta.hasAwait"
                label="await"
                color="secondary"
                variant="subtle"
                size="xs"
              />
              <UBadge
                v-if="selectedFlowMeta.stepCount"
                :label="`${selectedFlowMeta.stepCount} steps`"
                color="primary"
                variant="subtle"
                size="xs"
              />
              <UBadge
                v-if="selectedFlowMeta.levelCount"
                :label="`${selectedFlowMeta.levelCount} levels`"
                color="neutral"
                variant="subtle"
                size="xs"
              />
            </div>
          </div>
        </div>
        <div class="flex items-center gap-3">
          <!-- Flow actions can go here -->
        </div>
      </div>
    </div>

    <!-- Main Content -->
    <div class="flex-1 min-h-0 overflow-hidden">
      <div class="h-full flex gap-px bg-gray-200 dark:bg-gray-800">
        <!-- Runs List -->
        <div class="w-1/3 min-w-0 flex-shrink-0 bg-white dark:bg-gray-950 flex flex-col min-h-0 overflow-hidden">
          <div class="px-4 py-3 min-h-[49px] border-b border-gray-200 dark:border-gray-800 flex items-center justify-between shrink-0">
            <h2 class="text-sm font-medium text-gray-900 dark:text-gray-100">
              Runs
            </h2>
            <div class="flex items-center gap-2">
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
              <div
                v-if="selectedFlow"
                class="flex items-center gap-2 text-xs text-gray-500"
              >
                <UIcon
                  name="i-lucide-list"
                  class="w-3.5 h-3.5"
                />
                <span>{{ totalRuns }} run{{ totalRuns === 1 ? '' : 's' }}</span>
              </div>
              <UDropdownMenu
                v-if="selectedFlow"
                :items="flowActionsItems"
                :ui="{ content: 'min-w-48' }"
              >
                <UButton
                  icon="i-lucide-more-vertical"
                  size="xs"
                  color="neutral"
                  variant="ghost"
                  square
                />
              </UDropdownMenu>
            </div>
          </div>
          <div
            v-if="!selectedFlow"
            class="flex-1 overflow-y-auto min-h-0"
          >
            <div class="h-full flex items-center justify-center text-sm text-gray-400 px-4 text-center">
              Select a flow to view runs
            </div>
          </div>
          <div
            v-else-if="!runs || runs.length === 0"
            class="flex-1 overflow-y-auto min-h-0"
          >
            <div class="h-full flex items-center justify-center text-sm text-gray-400">
              <ClientOnly>
                <div class="text-center">
                  <div v-if="loadingRuns">
                    Loading runs...
                  </div>
                  <div v-else>
                    No runs yet
                  </div>
                </div>
                <template #fallback>
                  <div class="text-center">
                    No runs yet
                  </div>
                </template>
              </ClientOnly>
            </div>
          </div>
          <div
            v-else
            class="flex-1 min-h-0 flex flex-col overflow-hidden"
          >
            <div class="flex-1 min-h-0 overflow-y-auto divide-y divide-gray-100 dark:divide-gray-800">
              <SelectableListItem
                v-for="r in runs"
                :key="r.id"
                :selected="selectedRunId === r.id"
                :icon="getRunStatusIcon(r.status)"
                :icon-class="getRunStatusIconClass(r.status)"
                :subtitle="truncateId(r.id)"
                :meta="formatTime(r.createdAt)"
                @click="selectRun(r.id)"
              >
                <template #title>
                  Run {{ r.id?.substring(0, 8) }}
                </template>
                <template #badge>
                  <FlowRunStatusBadge
                    :is-running="r.status === 'running'"
                    :is-completed="r.status === 'completed'"
                    :is-failed="r.status === 'failed'"
                    :is-canceled="r.status === 'canceled'"
                    :is-stalled="r.status === 'stalled'"
                    :is-awaiting="r.status === 'awaiting'"
                  />
                </template>
                <template #meta>
                  <span>{{ formatTime(r.createdAt) }}</span>
                  <span
                    v-if="r.stepCount > 0"
                    class="flex items-center gap-1"
                  >
                    <UIcon
                      name="i-lucide-list-checks"
                      class="w-3 h-3"
                    />
                    {{ r.completedSteps }}/{{ r.stepCount }}
                  </span>
                  <span
                    v-if="r.completedAt && r.startedAt"
                    class="flex items-center gap-1"
                  >
                    <UIcon
                      name="i-lucide-timer"
                      class="w-3 h-3"
                    />
                    {{ formatDuration(r.startedAt, r.completedAt) }}
                  </span>
                </template>
              </SelectableListItem>

              <!-- Loading indicator -->
              <div
                v-if="loadingRuns"
                class="px-4 py-3 text-center text-xs text-gray-400"
              >
                <UIcon
                  name="i-lucide-loader-2"
                  class="w-4 h-4 animate-spin inline-block"
                />
                <span class="ml-2">Loading runs...</span>
              </div>
            </div>

            <!-- Pagination Footer -->
            <div
              v-if="totalRuns > runsPerPage"
              class="border-t border-gray-200 dark:border-gray-800 px-4 py-3 flex items-center justify-center shrink-0"
            >
              <UPagination
                v-model:page="currentPage"
                :items-per-page="runsPerPage"
                :total="totalRuns"
                size="xs"
              />
            </div>
          </div>
        </div>

        <!-- Main Content Area with Tabs -->
        <div class="flex-1 min-w-0 bg-white dark:bg-gray-950 flex flex-col min-h-0 overflow-hidden">
          <div class="px-4 py-2.5 border-b border-gray-200 dark:border-gray-800 shrink-0">
            <div class="flex items-center justify-between">
              <UTabs
                v-model="mainTab"
                :items="mainTabs"
                size="xs"
                :ui="{
                  root: 'gap-0',
                  trigger: 'px-2 py-0.5',
                }"
              />
              <div class="flex items-center gap-2">
                <span
                  v-if="selectedRunId"
                  class="text-xs text-gray-500 flex items-center gap-2"
                >
                  <span>Run: {{ selectedRunId.substring(0, 8) }}...</span>
                  <div
                    v-if="isReconnecting || (isConnected && flowState.isRunning.value)"
                    class="flex items-center gap-1.5"
                  >
                    <div
                      class="w-1.5 h-1.5 rounded-full"
                      :class="isReconnecting ? 'bg-amber-500 animate-pulse' : 'bg-emerald-500 animate-pulse'"
                    />
                    <span>{{ isReconnecting ? 'Reconnecting' : 'Live' }}</span>
                  </div>
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
            <!-- Diagram Tab -->
            <div
              v-if="mainTab === 'diagram'"
              class="h-full"
            >
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
                :flow-status="runSnapshot.status"
                height-class="h-full"
                @node-action="handleNodeAction"
              />
            </div>

            <!-- Timeline Tab -->
            <div
              v-else-if="mainTab === 'timeline'"
              class="h-full flex gap-px bg-gray-200 dark:bg-gray-800"
            >
              <!-- Left: Overview -->
              <div class="flex-1 min-w-0 max-w-[50%] bg-white dark:bg-gray-950 flex flex-col min-h-0 overflow-hidden">
                <div class="flex-1 overflow-y-auto min-h-0">
                  <FlowRunOverview
                    :run-status="runSnapshot.status"
                    :started-at="runSnapshot.startedAt"
                    :completed-at="runSnapshot.completedAt"
                    :steps="enhancedStepList"
                    :flow-name="selectedFlow || undefined"
                    :run-id="selectedRunId || undefined"
                    :trigger-name="flowState.state.value.meta?.triggerName"
                    :trigger-type="flowState.state.value.meta?.triggerType"
                    :flow-def="selectedFlowDef"
                    :stall-timeout="runSnapshot.stallTimeout"
                    @select-step="handleSelectStep"
                    @cancel-flow="handleCancelFlow"
                    @restart-flow="handleRestartFlow"
                  />
                </div>
              </div>

              <!-- Right: Combined Logs & Events -->
              <div class="flex-1 min-w-0 max-w-[50%] bg-white dark:bg-gray-950 flex flex-col min-h-0 overflow-hidden">
                <FlowRunTimeline
                  :events="timeline"
                  :logs="filteredLogs"
                  :is-live="isConnected"
                  @export="exportTimelineJson"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

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

    <!-- Confirm Dialog -->
    <ConfirmDialog
      v-model:open="confirmDialogOpen"
      :title="confirmDialogConfig.title"
      :description="confirmDialogConfig.description"
      :items="confirmDialogConfig.items"
      :warning="confirmDialogConfig.warning"
      :loading="clearingHistory"
      confirm-label="Clear History"
      confirm-color="error"
      icon="i-lucide-trash-2"
      icon-color="error"
      @confirm="confirmDialogConfig.onConfirm"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from '#imports'
import FlowDiagram from '../../components/flow/Diagram.vue'
import FlowRunOverview from '../../components/flow/RunOverview.vue'
import FlowRunTimeline from '../../components/flow/RunTimeline.vue'
import FlowRunStatusBadge from '../../components/flow/RunStatusBadge.vue'
import ConfirmDialog from '../../components/ConfirmDialog.vue'
import SelectableListItem from '../../components/SelectableListItem.vue'
import { useRoute, useRouter } from '#app'

// Composables
import { useAnalyzedFlows } from '../../composables/useAnalyzedFlows'
import { useFlowRuns } from '../../composables/useFlowRuns'
import { useFlowRunTimeline } from '../../composables/useFlowRunTimeline'
import { useFlowRunsUpdates } from '../../composables/useFlowRunsUpdates'
import { useComponentRouter } from '../../composables/useComponentRouter'

const componentRouter = useComponentRouter()
const router = useRouter()
const route = useRoute()

// Extract flow name from route parameter [name] (like triggers page does)
const selectedFlow = computed(() => {
  const path = componentRouter.route.value?.path || ''
  const match = path.match(/\/flows\/([^/]+)/)
  return match && match[1] ? decodeURIComponent(match[1]) : null
})

// Get run ID from URL query parameter
const selectedRunId = ref<string>((route.query.run as string) || '')

// Sync URL with selectedRunId (but don't trigger on URL changes to avoid scroll issues)
watch(selectedRunId, (newValue) => {
  if (newValue !== route.query.run) {
    router.replace({
      query: {
        ...route.query,
        run: newValue || undefined,
      },
    })
  }
})

// Back navigation
const goBack = () => {
  componentRouter.push('/flows')
}

// Main tab state (Diagram or Timeline)
// Initialize based on URL - if run is already selected, start with timeline
const mainTab = ref<'diagram' | 'timeline'>(route.query.run ? 'timeline' : 'diagram')

// Tab configurations
const mainTabs = computed(() => [
  { label: 'Diagram', value: 'diagram', icon: 'i-lucide-git-branch' },
  {
    label: 'Timeline',
    value: 'timeline',
    icon: 'i-lucide-activity',
    disabled: !selectedRunId.value,
  },
])

// Watch for run selection changes - switch to timeline tab when a run is selected
watch(selectedRunId, (newRunId, oldRunId) => {
  if (newRunId && newRunId !== oldRunId) {
    mainTab.value = 'timeline'
  }
  else if (!newRunId) {
    mainTab.value = 'diagram'
  }
})

// Get analyzed flows (with HMR support)
const flows = useAnalyzedFlows()

// Get selected flow definition
const selectedFlowDef = computed(() => {
  if (!selectedFlow.value) return null
  return flows.value.find((f: any) => f.id === selectedFlow.value)
})

// Convert computed to ref for composables (with default empty string)
const selectedFlowRef = computed(() => selectedFlow.value || '')
const selectedRunIdRef = computed(() => selectedRunId.value || '')

// URL-based pagination state
const runsPerPage = 20

const currentPage = computed({
  get: () => {
    const page = route.query.page as string
    return page ? Number.parseInt(page, 10) : 1
  },
  set: (value: number) => {
    router.replace({
      query: {
        ...route.query,
        page: value > 1 ? value.toString() : undefined,
      },
    })
  },
})

// Build query options for server-side pagination
const runsQueryOptions = computed(() => ({
  limit: runsPerPage,
  offset: (currentPage.value - 1) * runsPerPage,
}))

// Fetch runs for selected flow with pagination
const {
  runs: runsResponse,
  refresh: refreshRuns,
  status: runsStatus,
} = useFlowRuns(selectedFlowRef, runsQueryOptions)

// Derived state from response
const runs = computed(() => runsResponse.value?.items || [])
const totalRuns = computed(() => runsResponse.value?.total || 0)
const loadingRuns = computed(() => runsStatus.value === 'pending')

// Manage timeline/SSE for selected run
const { flowState, isConnected, isReconnecting } = useFlowRunTimeline(selectedFlowRef, selectedRunIdRef)

// WebSocket updates for flow runs (similar to queue pattern)
const { shouldRefreshRuns, resetRefreshFlag } = useFlowRunsUpdates(selectedFlowRef)

// Watch for shouldRefreshRuns flag and auto-refresh the runs list
watch(shouldRefreshRuns, async (shouldRefresh) => {
  if (shouldRefresh) {
    await refreshRuns()
    resetRefreshFlag()
  }
})

// Start flow modal state
const startFlowModalOpen = ref(false)
const flowInputJson = ref('{}')
const jsonError = ref('')
const startingFlow = ref(false)
const clearingHistory = ref(false)

// Confirm dialog state
const confirmDialogOpen = ref(false)
const confirmDialogConfig = ref({
  title: '',
  description: '',
  items: [] as string[],
  warning: '',
  onConfirm: () => {},
})

// Flow actions dropdown menu
const flowActionsItems = computed(() => [[
  {
    label: 'Clear History',
    icon: 'i-lucide-trash-2',
    disabled: clearingHistory.value,
    onSelect: () => confirmClearHistory(),
  },
]])

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

// Helper to format duration
const formatDuration = (start: string | number, end: string | number) => {
  const startTime = new Date(start).getTime()
  const endTime = new Date(end).getTime()
  const diff = endTime - startTime
  const seconds = Math.floor(diff / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)

  if (hours > 0) {
    const remainingMinutes = minutes % 60
    return `${hours}h ${remainingMinutes}m`
  }
  if (minutes > 0) {
    const remainingSeconds = seconds % 60
    return `${minutes}m ${remainingSeconds}s`
  }
  return `${seconds}s`
}

// Helper to truncate run IDs
const truncateId = (id: string) => {
  if (!id || id.length <= 16) return id
  return `${id.substring(0, 8)}...${id.substring(id.length - 8)}`
}

// Helper to get run status icon
const getRunStatusIcon = (status: string) => {
  switch (status) {
    case 'running': return 'i-lucide-loader-2'
    case 'completed': return 'i-lucide-check-circle'
    case 'failed': return 'i-lucide-x-circle'
    case 'canceled': return 'i-lucide-ban'
    case 'stalled': return 'i-lucide-alert-triangle'
    case 'awaiting': return 'i-lucide-pause-circle'
    default: return 'i-lucide-circle'
  }
}

// Helper to get run status icon color class
const getRunStatusIconClass = (status: string) => {
  switch (status) {
    case 'running': return 'text-blue-500 animate-spin'
    case 'completed': return 'text-emerald-500'
    case 'failed': return 'text-red-500'
    case 'canceled': return 'text-gray-500'
    case 'stalled': return 'text-amber-500'
    case 'awaiting': return 'text-purple-500'
    default: return 'text-gray-400'
  }
}

// Computed state from reducer
const runSnapshot = computed(() => {
  const state = flowState.state.value
  const flowMeta = selectedFlowMeta.value
  return {
    status: state.status,
    startedAt: state.startedAt,
    completedAt: state.completedAt,
    logsCount: state.logs.length,
    lastLogLevel: state.logs.length > 0 ? state.logs[state.logs.length - 1]?.level : undefined,
    // Use stallTimeout from event data if available, otherwise fall back to static flow definition
    stallTimeout: state.meta?.stallTimeout || flowMeta?.analyzed?.stallTimeout,
  }
})

// Selected step for filtering events and logs
const selectedStepKey = ref<string | null>(null)

const timeline = computed(() => {
  const events = flowState.events.value
  if (!selectedStepKey.value) return events
  // Filter events by selected step
  return events.filter((e: any) => e.stepName === selectedStepKey.value)
})

const filteredLogs = computed(() => {
  const logs = flowState.state.value.logs
  if (!selectedStepKey.value) return logs
  // Filter logs by selected step
  return logs.filter((log: any) => log.stepName === selectedStepKey.value)
})

const selectedFlowMeta = computed(() => {
  const id = selectedFlow.value
  if (!id) return null
  return (flows.value || []).find((f: any) => f?.id === id) || null
})

// Enhance step list with static stepTimeout from analyzed flows
const enhancedStepList = computed(() => {
  const steps = flowState.stepList.value
  const flowMeta = selectedFlowMeta.value
  if (!flowMeta?.analyzed?.steps) return steps

  // Create a map of stepName -> stepTimeout from analyzed flows
  // analyzed.steps includes ALL steps (entry + regular steps) with config priority applied
  const stepTimeoutMap = new Map<string, number>()

  for (const [stepName, analyzedStep] of Object.entries(flowMeta.analyzed.steps)) {
    if ((analyzedStep as any).stepTimeout !== undefined) {
      stepTimeoutMap.set(stepName, (analyzedStep as any).stepTimeout)
    }
  }

  // Merge stepTimeout into runtime step states
  return steps.map((step: any) => {
    // Extract base step name (remove :await-before or :await-after suffix)
    const baseStepName = step.key.includes(':await-')
      ? step.key.split(':await-')[0]
      : step.key

    const staticTimeout = stepTimeoutMap.get(baseStepName)
    if (staticTimeout !== undefined) {
      return { ...step, stepTimeout: staticTimeout }
    }
    return step
  })
})

const handleSelectStep = (stepKey: string | null) => {
  selectedStepKey.value = stepKey
}

// Handle cancel flow
const handleCancelFlow = async () => {
  if (!selectedFlow.value || !selectedRunId.value) return

  try {
    await $fetch(`/api/_flows/${selectedFlow.value}/runs/${selectedRunId.value}/cancel`, {
      method: 'POST',
    })
  }
  catch (error) {
    console.error('Failed to cancel flow:', error)
  }
}

// Handle restart flow
const handleRestartFlow = async () => {
  if (!selectedFlow.value || !selectedRunId.value) return

  try {
    const result = await $fetch<{ newRunId: string }>(`/api/_flows/${selectedFlow.value}/runs/${selectedRunId.value}/restart`, {
      method: 'POST',
    })

    // Navigate to the new run
    if (result?.newRunId) {
      selectedRunId.value = result.newRunId
      mainTab.value = 'timeline'
    }

    // Refresh runs list to show the new run
    await refreshRuns()
  }
  catch (error) {
    console.error('Failed to restart flow:', error)
  }
}

const diagramStepStates = computed(() => {
  if (!selectedRunId.value) return undefined
  return flowState.state.value.steps
})

// Select a run and switch to timeline view
const selectRun = (runId: string) => {
  selectedRunId.value = runId
  mainTab.value = 'timeline'
}

// Timeline export function
const exportTimelineJson = () => {
  const blob = new Blob([JSON.stringify(flowState.events.value, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `flow-${selectedFlow.value}-${selectedRunId.value}-events-${new Date().toISOString()}.json`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

// Handle node card button actions
const handleNodeAction = async (payload: { id: string, action: 'run' | 'logs' | 'details' }) => {
  const _stepName = payload.id.split(':')[1] // Extract step name from "entry:stepName" or "step:stepName"

  if (!selectedRunId.value) {
    alert('Please select a flow run first to view logs or details.')
    return
  }

  // Switch to timeline view for both logs and details actions
  mainTab.value = 'timeline'
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

    // Select the new run and switch to timeline view
    if (result?.flowId) {
      selectedRunId.value = result.flowId
      mainTab.value = 'timeline'
    }

    // Then refresh runs list to show the new run
    await refreshRuns()
  }
  catch (err) {
    console.error('Failed to start flow:', err)
    jsonError.value = err instanceof Error ? err.message : 'Failed to start flow'
  }
  finally {
    startingFlow.value = false
  }
}

const confirmClearHistory = () => {
  if (!selectedFlow.value) return

  confirmDialogConfig.value = {
    title: 'Clear Flow History',
    description: `Are you sure you want to clear all history for "${selectedFlow.value}"?`,
    items: [
      'All flow run events',
      'All flow run logs',
      'The runs index',
    ],
    warning: 'This action cannot be undone.',
    onConfirm: () => {
      clearFlowHistory()
    },
  }

  confirmDialogOpen.value = true
}

const clearFlowHistory = async () => {
  if (!selectedFlow.value) return

  try {
    clearingHistory.value = true

    await $fetch(`/api/_flows/${encodeURIComponent(selectedFlow.value)}/clear-history`, {
      method: 'DELETE',
    })

    // Close confirm dialog
    confirmDialogOpen.value = false

    // Reset UI state
    selectedRunId.value = ''
    mainTab.value = 'diagram'

    // Refresh runs list (should be empty now)
    await refreshRuns()

    // Show success notification (could be enhanced with toast notification)
  }
  catch (err) {
    console.error('Failed to clear history:', err)

    // Show error in confirm dialog by updating config
    confirmDialogConfig.value = {
      title: 'Error Clearing History',
      description: `Failed to clear history: ${err instanceof Error ? err.message : 'Unknown error'}`,
      items: [],
      warning: '',
      onConfirm: () => {
        confirmDialogOpen.value = false
      },
    }
  }
  finally {
    clearingHistory.value = false
  }
}
</script>
