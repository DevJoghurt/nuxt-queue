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
        <LiveIndicator
          :is-connected="flowWs.connected.value"
          :is-reconnecting="flowWs.reconnecting.value"
        />
      </div>
    </div>

    <!-- Main Content -->
    <div class="flex-1 min-h-0 overflow-y-auto">
      <div class="max-w-7xl mx-auto p-6">
        <!-- Stats Overview -->
        <div class="grid grid-cols-2 md:grid-cols-6 gap-4 mb-6">
          <StatCard
            icon="i-lucide-git-branch"
            :count="flows?.length || 0"
            label="Total Flows"
            variant="gray"
          />
          <StatCard
            icon="i-lucide-play"
            :count="totalRuns"
            label="Total Runs"
            variant="blue"
          />
          <StatCard
            icon="i-lucide-check-circle"
            :count="totalSuccess"
            label="Success"
            variant="emerald"
          />
          <StatCard
            icon="i-lucide-x-circle"
            :count="totalFailure"
            label="Failures"
            variant="red"
          />
          <StatCard
            icon="i-lucide-loader"
            :count="totalRunning"
            label="Running"
            variant="purple"
          />
          <StatCard
            icon="i-lucide-pause"
            :count="totalAwaiting"
            label="Awaiting"
            variant="amber"
          />
        </div>

        <!-- Filters -->
        <div class="mb-4">
          <UInput
            v-model="searchQuery"
            icon="i-lucide-search"
            placeholder="Search flows..."
            size="sm"
          />
        </div>

        <!-- Flows List -->
        <div
          v-if="!filteredFlows || filteredFlows.length === 0"
          class="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 p-8 text-center text-gray-500"
        >
          <div v-if="searchQuery">
            <UIcon
              name="i-lucide-search-x"
              class="w-12 h-12 animate-spin mx-auto mb-3 opacity-50"
            />
            <p>No flows match your search</p>
            <UButton
              size="xs"
              color="neutral"
              variant="ghost"
              class="mt-2"
              @click="searchQuery = ''"
            >
              Clear Search
            </UButton>
          </div>
          <div v-else>
            <UIcon
              name="i-lucide-git-branch"
              class="w-12 h-12 mx-auto mb-3 opacity-50"
            />
            <p>No flows found</p>
          </div>
        </div>
        <div
          v-else
          class="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 overflow-hidden"
        >
          <div class="divide-y divide-gray-100 dark:divide-gray-800">
            <div
              v-for="flow in filteredFlows"
              :key="flow.id"
              class="px-6 py-4 hover:bg-gray-50 dark:hover:bg-gray-900/50 transition-colors cursor-pointer"
              @click="openFlow(flow.id)"
            >
              <div class="flex items-start justify-between gap-4">
                <!-- Left: Flow Info -->
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-2 mb-2">
                    <UIcon
                      name="i-lucide-git-branch"
                      class="w-4 h-4 shrink-0 text-blue-500"
                    />
                    <h3 class="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">
                      {{ flow.id }}
                    </h3>
                    <UBadge
                      v-if="flow.hasAwait"
                      label="await"
                      color="purple"
                      variant="subtle"
                      size="xs"
                    >
                      <template #leading>
                        <UIcon
                          name="i-lucide-pause"
                          class="w-3 h-3"
                        />
                      </template>
                    </UBadge>
                  </div>

                  <div class="flex items-center gap-4 text-xs text-gray-500 dark:text-gray-400">
                    <div class="flex items-center gap-1">
                      <UIcon
                        name="i-lucide-layers"
                        class="w-3 h-3"
                      />
                      <span>{{ getStepCount(flow) }} step{{ getStepCount(flow) === 1 ? '' : 's' }}</span>
                    </div>
                    <div class="flex items-center gap-1">
                      <UIcon
                        name="i-lucide-bar-chart-3"
                        class="w-3 h-3"
                      />
                      <span>{{ getLevelCount(flow) }} level{{ getLevelCount(flow) === 1 ? '' : 's' }}</span>
                    </div>
                    <div
                      v-if="flow.stats && flow.stats.total > 0"
                      class="flex items-center gap-2"
                    >
                      <div class="flex items-center gap-1">
                        <UIcon
                          name="i-lucide-play"
                          class="w-3 h-3"
                        />
                        <span>{{ flow.stats.total }}</span>
                      </div>
                      <div
                        v-if="flow.stats.running > 0"
                        class="flex items-center gap-1 text-purple-600 dark:text-purple-400"
                      >
                        <UIcon
                          name="i-lucide-loader"
                          class="w-3 h-3"
                        />
                        <span>{{ flow.stats.running }}</span>
                      </div>
                    </div>
                    <div
                      v-if="flow.timeout"
                      class="flex items-center gap-1"
                    >
                      <UIcon
                        name="i-lucide-clock"
                        class="w-3 h-3"
                      />
                      <span>{{ formatTimeout(flow.timeout) }} timeout</span>
                    </div>
                    <!-- Runtime Badges -->
                    <div
                      v-if="getRuntimes(flow).length > 0"
                      class="flex items-center gap-1"
                    >
                      <UIcon
                        name="i-lucide-cpu"
                        class="w-3 h-3"
                      />
                      <span>{{ getRuntimes(flow).join(', ') }}</span>
                    </div>
                  </div>
                </div>

                <!-- Right: Action -->
                <UButton
                  icon="i-lucide-arrow-right"
                  size="xs"
                  color="neutral"
                  variant="ghost"
                  square
                />
              </div>
            </div>
          </div>
        </div>

        <!-- Footer Info -->
        <div
          v-if="filteredFlows && filteredFlows.length > 0"
          class="mt-4 text-center text-sm text-gray-500 dark:text-gray-400"
        >
          Showing {{ filteredFlows.length }} flow{{ filteredFlows.length === 1 ? '' : 's' }}
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from '#imports'
import { UButton, UIcon, UBadge, UInput } from '#components'
import { useComponentRouter } from '../../composables/useComponentRouter'
import { useFlowWebSocket } from '../../composables/useFlowWebSocket'
import StatCard from '../../components/StatCard.vue'
import LiveIndicator from '../../components/LiveIndicator.vue'

const router = useComponentRouter()

// Reactive flows data (populated via WebSocket)
const flows = ref<any[]>([])
const loading = ref(true)

// WebSocket connection
const flowWs = useFlowWebSocket()

// Fetch analyzed flows from build-time registry
async function fetchAnalyzedFlows() {
  try {
    const data = await $fetch('/api/_flows')
    const analyzedFlows = data as any[]
    // Initialize flows array with analyzed flows (without stats initially)
    // Flatten the analyzed structure for easier UI access
    flows.value = analyzedFlows.map((flow: any) => ({
      id: flow.id,
      entry: flow.entry,
      steps: flow.analyzed?.steps || flow.steps || {},
      levels: flow.analyzed?.levels || [],
      maxLevel: flow.analyzed?.maxLevel || 0,
      stallTimeout: flow.analyzed?.stallTimeout,
      awaitPatterns: flow.analyzed?.awaitPatterns,
      hasAwait: flow.analyzed?.awaitPatterns?.steps?.length > 0 || false,
      timeout: flow.timeout,
      stats: { total: 0, success: 0, failure: 0, cancel: 0, running: 0, awaiting: 0 },
    }))
  }
  catch (err) {
    console.error('Error fetching analyzed flows:', err)
  }
}

// Update flow stats from WebSocket message
function updateFlowStats(data: any) {
  const flowId = data?.id
  if (!flowId || !flows.value)
    return

  const flowIndex = flows.value.findIndex(f => f.id === flowId)
  if (flowIndex === -1) {
    console.warn('[Flow Stats] Flow not found in list:', flowId)
    return
  }

  const metadata = data?.metadata
  if (!metadata) {
    console.warn('[Flow Stats] No metadata in update:', data)
    return
  }

  // Check if stats are nested or flat
  const stats = metadata.stats || {
    total: metadata['stats.total'] || 0,
    success: metadata['stats.success'] || 0,
    failure: metadata['stats.failure'] || 0,
    cancel: metadata['stats.cancel'] || 0,
    running: metadata['stats.running'] || 0,
    awaiting: metadata['stats.awaiting'] || 0,
  }

  // Create a new flow object to trigger Vue reactivity
  flows.value[flowIndex] = {
    ...flows.value[flowIndex],
    stats: {
      total: stats.total || 0,
      success: stats.success || 0,
      failure: stats.failure || 0,
      cancel: stats.cancel || 0,
      running: stats.running || 0,
      awaiting: stats.awaiting || 0,
    },
    lastRunAt: metadata.lastRunAt,
    lastCompletedAt: metadata.lastCompletedAt,
  }
}

onMounted(async () => {
  await fetchAnalyzedFlows()

  if (import.meta.client) {
    // Subscribe to flow stats updates
    flowWs.subscribeStats(
      {
        onInitial: (data) => {
          updateFlowStats(data)
        },
        onUpdate: (data) => {
          updateFlowStats(data)
        },
      },
      {
        autoReconnect: true,
        onOpen: () => {
          loading.value = false
        },
        onError: (err) => {
          console.error('[Flow Stats] Error:', err)
        },
      },
    )
  }
})

onBeforeUnmount(() => {
  flowWs.unsubscribeStats()
  flowWs.stop()
})

// Filters
const searchQuery = ref('')

const filteredFlows = computed(() => {
  if (!flows.value)
    return []

  // Filter by search query
  if (searchQuery.value) {
    const query = searchQuery.value.toLowerCase()
    return flows.value.filter(flow =>
      flow.id.toLowerCase().includes(query),
    )
  }

  return flows.value
})

const totalRuns = computed(() => {
  if (!flows.value)
    return 0
  return flows.value.reduce((acc, flow) => acc + (flow.stats?.total || 0), 0)
})

const totalSuccess = computed(() => {
  if (!flows.value)
    return 0
  return flows.value.reduce((acc, flow) => acc + (flow.stats?.success || 0), 0)
})

const totalFailure = computed(() => {
  if (!flows.value)
    return 0
  return flows.value.reduce((acc, flow) => acc + (flow.stats?.failure || 0), 0)
})

const totalRunning = computed(() => {
  if (!flows.value)
    return 0
  return flows.value.reduce((acc, flow) => acc + (flow.stats?.running || 0), 0)
})

const totalAwaiting = computed(() => {
  if (!flows.value)
    return 0
  return flows.value.reduce((acc, flow) => acc + (flow.stats?.awaiting || 0), 0)
})

const getStepCount = (flow: any) => {
  if (!flow.steps) return 0
  // steps is an object (Record<string, AnalyzedStep>), count the keys
  return Object.keys(flow.steps).length
}

const getLevelCount = (flow: any) => {
  if (!flow.levels) return 0
  // levels is an array of arrays, return the length
  return Array.isArray(flow.levels) ? flow.levels.length : 0
}

const getRuntimes = (flow: any) => {
  const runtimes = new Set<string>()
  if (!flow.steps) return []
  // steps is an object, iterate over values
  for (const step of Object.values(flow.steps)) {
    if ((step as any).runtime) {
      runtimes.add((step as any).runtime)
    }
  }
  return Array.from(runtimes)
}

function formatTimeout(ms: number) {
  if (ms < 1000)
    return `${ms}ms`
  if (ms < 60000)
    return `${ms / 1000}s`
  return `${ms / 60000}m`
}

function openFlow(flowId: string) {
  router.push(`/flows/${flowId}`)
}
</script>
