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
            v-model="selectedFlow"
            :items="(flows || []).map(f => f.id)"
            placeholder="Select a flow..."
            class="w-64"
          >
            <template #leading>
              <UIcon
                v-if="selectedFlow"
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
              <div class="text-center">
                <div v-if="loadingRuns">
                  Loading runs...
                </div>
                <div v-else>
                  No runs yet
                </div>
              </div>
            </div>
          </div>
          <div
            v-else
            ref="runsScrollContainer"
            class="flex-1 overflow-y-auto min-h-0 divide-y divide-gray-100 dark:divide-gray-800"
            @scroll="handleRunsScroll"
          >
            <div
              v-for="r in runs"
              :key="r.id"
              class="group"
            >
              <div
                class="px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-900/50 transition-colors cursor-pointer"
                :class="{ 'bg-gray-50 dark:bg-gray-900': selectedRunId === r.id }"
                @click="selectedRunId = r.id"
              >
                <div class="flex items-start justify-between gap-3">
                  <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-2">
                      <div class="text-xs font-mono text-gray-900 dark:text-gray-100 truncate">
                        {{ r.id?.substring(0, 8) }}...{{ r.id?.substring(r.id?.length - 4) }}
                      </div>
                      <!-- Status indicator for selected run -->
                      <FlowRunStatusBadge
                        v-if="selectedRunId === r.id"
                        :is-running="flowState.isRunning.value"
                        :is-completed="flowState.isCompleted.value"
                        :is-failed="flowState.isFailed.value"
                        :is-reconnecting="isReconnecting"
                      />
                    </div>
                    <div class="text-xs text-gray-500 mt-1">
                      {{ formatTime(r.createdAt) }}
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

            <!-- Loading indicator for infinite scroll -->
            <div
              v-if="loadingRuns"
              class="px-4 py-3 text-center text-xs text-gray-400"
            >
              <UIcon
                name="i-lucide-loader-2"
                class="w-4 h-4 animate-spin inline-block"
              />
              <span class="ml-2">Loading more runs...</span>
            </div>

            <!-- End of list indicator -->
            <div
              v-else-if="!hasMoreRuns && runs.length > 0"
              class="px-4 py-3 text-center text-xs text-gray-400"
            >
              All runs loaded
            </div>
          </div>

          <!-- Schedules Section -->
          <div
            v-if="selectedFlow"
            class="border-t border-gray-200 dark:border-gray-800 shrink-0"
          >
            <div class="px-4 py-2 bg-gray-50 dark:bg-gray-900/50">
              <div class="flex items-center justify-between">
                <h3 class="text-xs font-medium text-gray-700 dark:text-gray-300">
                  Schedules
                </h3>
                <UButton
                  icon="i-lucide-chevron-down"
                  size="xs"
                  color="neutral"
                  variant="ghost"
                  square
                  :class="{ 'rotate-180': showSchedules }"
                  @click="showSchedules = !showSchedules"
                />
              </div>
            </div>
            <div
              v-if="showSchedules"
              class="max-h-48 overflow-y-auto"
            >
              <FlowSchedulesList
                v-if="selectedFlow"
                ref="schedulesListRef"
                :flow-name="selectedFlow"
                class="px-4 py-3"
                @updated="handleSchedulesUpdated"
              />
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
    <USlideover
      v-model:open="timelineOpen"
      :ui="{
        body: 'p-0 sm:p-0',
      }"
    >
      <template #title>
        <div class="flex items-center justify-between w-full pr-4">
          <div>
            <div class="text-sm font-semibold">
              Flow Timeline
            </div>
            <div class="text-xs font-mono text-gray-500 mt-0.5">
              {{ selectedRunId.substring(0, 8) }}...{{ selectedRunId.substring(selectedRunId.length - 4) }}
            </div>
          </div>
          <div
            v-if="isReconnecting || (isConnected && flowState.isRunning.value)"
            class="flex items-center gap-2 text-xs"
          >
            <div
              class="w-2 h-2 rounded-full"
              :class="isReconnecting ? 'bg-amber-500 animate-pulse' : 'bg-emerald-500 animate-pulse'"
            />
            <span class="text-gray-500">{{ isReconnecting ? 'Reconnecting' : 'Live' }}</span>
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
        <!-- Fixed Tabs Header -->
        <div class="sticky top-0 z-10 bg-white dark:bg-gray-950 border-b border-gray-200 dark:border-gray-800 px-6 pt-2">
          <UTabs
            v-model="selectedTab"
            :items="tabs"
          />
        </div>

        <!-- Scrollable Content Area -->
        <div class="flex-1 overflow-y-auto overflow-x-hidden">
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
            :is-live="isConnected"
            @export="exportTimelineJson"
            @clear="clearTimeline"
          />
        </div>
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

    <!-- Schedule Flow Modal -->
    <FlowScheduleDialog
      v-if="selectedFlow"
      v-model="scheduleModalOpen"
      :flow-name="selectedFlow"
      @scheduled="handleFlowScheduled"
    />

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
import FlowDiagram from '../../components/FlowDiagram.vue'
import FlowRunOverview from '../../components/FlowRunOverview.vue'
import FlowRunLogs from '../../components/FlowRunLogs.vue'
import FlowRunTimeline from '../../components/FlowRunTimeline.vue'
import FlowRunStatusBadge from '../../components/FlowRunStatusBadge.vue'
import FlowSchedulesList from '../../components/FlowSchedulesList.vue'
import FlowScheduleDialog from '../../components/FlowScheduleDialog.vue'
import ConfirmDialog from '../../components/ConfirmDialog.vue'
import {
  USelectMenu,
  UIcon,
  UButton,
  UModal,
  USlideover,
  UTextarea,
  UTabs,
  UDropdownMenu,
} from '#components'

// Composables
import { useAnalyzedFlows } from '../../composables/useAnalyzedFlows'
import { useFlowsNavigation } from '../../composables/useFlowsNavigation'
import { useFlowRunsInfinite } from '../../composables/useFlowRunsInfinite'
import { useFlowRunTimeline } from '../../composables/useFlowRunTimeline'
import { useFlowRunsPolling } from '../../composables/useFlowRunsPolling'

// Navigation state (synced with URL)
const { selectedFlow, selectedRunId, timelineOpen, selectedTab } = useFlowsNavigation()

// Get analyzed flows (with HMR support)
const flows = useAnalyzedFlows()

// Fetch runs for selected flow with infinite scroll (persists across HMR)
const {
  items: runs,
  total: totalRuns,
  loading: loadingRuns,
  hasMore: hasMoreRuns,
  loadMore: loadMoreRuns,
  refresh: refreshRuns,
  checkForNewRuns,
} = useFlowRunsInfinite(selectedFlow)

// Manage timeline/SSE for selected run
const { flowState, isConnected, isReconnecting } = useFlowRunTimeline(selectedFlow, selectedRunId)

// Auto-poll runs list to keep it fresh (always poll when a flow is selected)
// Use checkForNewRuns instead of refresh to avoid scroll reset
const shouldPoll = computed(() => !!selectedFlow.value)
useFlowRunsPolling(checkForNewRuns, shouldPoll)

// Start flow modal state
const startFlowModalOpen = ref(false)
const scheduleModalOpen = ref(false)
const flowInputJson = ref('{}')
const jsonError = ref('')
const startingFlow = ref(false)

// Schedules state
const showSchedules = ref(true)
const schedulesListRef = ref()
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
    label: 'Schedule Flow',
    icon: 'i-lucide-clock',
    onSelect: () => openScheduleModal(),
  },
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

// Tab configuration
const tabs = [
  { label: 'Overview', value: 'overview', icon: 'i-lucide-layout-dashboard' },
  { label: 'Logs', value: 'logs', icon: 'i-lucide-file-text' },
  { label: 'Timeline', value: 'timeline', icon: 'i-lucide-activity' },
]

// Ref for scroll container
const runsScrollContainer = ref<HTMLElement | null>(null)

// Infinite scroll handler
const handleRunsScroll = (event: Event) => {
  if (!hasMoreRuns.value || loadingRuns.value) return

  const container = event.target as HTMLElement
  const scrollTop = container.scrollTop
  const scrollHeight = container.scrollHeight
  const clientHeight = container.clientHeight

  // Load more when scrolled to within 200px of the bottom
  if (scrollTop + clientHeight >= scrollHeight - 200) {
    loadMoreRuns()
  }
}

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

const selectedFlowMeta = computed(() => {
  const id = selectedFlow.value
  if (!id) return null
  return (flows.value || []).find((f: any) => f?.id === id) || null
})

const diagramStepStates = computed(() => {
  if (!selectedRunId.value) return undefined
  return flowState.state.value.steps
})

// Open the timeline slideover for a run
const openRunTimeline = async (runId: string) => {
  // Manually trigger router navigation and wait for it
  const router = useRouter()
  const route = useRoute()

  await router.push({
    query: {
      ...route.query,
      run: runId,
      timeline: 'true',
    },
  })
}

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

const clearTimeline = () => {
  flowState.reset()
}

// Handle node card button actions
const handleNodeAction = async (payload: { id: string, action: 'run' | 'logs' | 'details' }) => {
  const _stepName = payload.id.split(':')[1] // Extract step name from "entry:stepName" or "step:stepName"

  if (!selectedRunId.value) {
    console.log('[flows/index] No run selected, showing alert')
    alert('Please select a flow run first to view logs or details.')
    return
  }

  switch (payload.action) {
    case 'logs':
      timelineOpen.value = true
      selectedTab.value = 'logs'
      // TODO: Add step filtering to logs view
      break
    
    case 'details':
      timelineOpen.value = true
      selectedTab.value = 'overview'
      break
  }
}

const openStartFlowModal = () => {
  flowInputJson.value = '{}'
  jsonError.value = ''
  startFlowModalOpen.value = true
}

const openScheduleModal = () => {
  scheduleModalOpen.value = true
}

const handleFlowScheduled = () => {
  // Refresh the schedules list after a schedule is created
  schedulesListRef.value?.loadSchedules()
}

const handleSchedulesUpdated = () => {
  // Called when schedules list needs to be refreshed
  schedulesListRef.value?.loadSchedules()
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

    // Open the new run timeline first
    if (result?.flowId) {
      await openRunTimeline(result.flowId)
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
    timelineOpen.value = false

    // Refresh runs list (should be empty now)
    await refreshRuns()

    // Show success notification (could be enhanced with toast notification)
    console.log(`Successfully cleared history for "${selectedFlow.value}"`)
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
