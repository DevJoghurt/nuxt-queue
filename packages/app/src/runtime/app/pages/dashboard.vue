<template>
  <div class="h-full flex flex-col overflow-hidden">
    <!-- Header -->
    <div class="border-b border-gray-200 dark:border-gray-800 px-6 py-4 shrink-0">
      <div class="flex items-center justify-between">
        <div>
          <h1 class="text-2xl font-bold text-gray-900 dark:text-gray-100">
            Dashboard
          </h1>
          <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Overview of your Nuxt Queue system
          </p>
        </div>
        <div
          v-if="isConnected"
          class="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400"
        >
          <div class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          <span>Live</span>
        </div>
      </div>
    </div>

    <!-- Main Content -->
    <div class="flex-1 min-h-0 overflow-y-auto p-6">
      <div class="max-w-7xl mx-auto space-y-6">
        <!-- System Stats Overview -->
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <!-- Queues Card -->
          <div
            class="bg-gradient-to-br from-blue-500 to-blue-600 dark:from-blue-600 dark:to-blue-700 rounded-xl p-6 text-white shadow-lg hover:shadow-xl transition-shadow cursor-pointer"
            @click="navigateTo('/queues')"
          >
            <div class="flex items-center justify-between mb-4">
              <div class="p-3 bg-white/20 rounded-lg backdrop-blur-sm">
                <UIcon
                  name="i-lucide-app-window"
                  class="w-6 h-6"
                />
              </div>
              <UIcon
                name="i-lucide-arrow-right"
                class="w-5 h-5 opacity-60"
              />
            </div>
            <div class="text-3xl font-bold mb-1">
              {{ queuesStats?.total || 0 }}
            </div>
            <div class="text-sm opacity-90 mb-3">
              Active Queues
            </div>
            <div class="flex items-center gap-4 text-xs opacity-75">
              <div v-if="queuesStats?.pending > 0">
                <span class="font-semibold">{{ formatNumber(queuesStats?.pending || 0) }}</span> pending
              </div>
              <div>
                <span class="font-semibold">{{ formatNumber(queuesStats?.completed || 0) }}</span> completed
              </div>
              <div v-if="queuesStats?.failed > 0">
                <span class="font-semibold">{{ formatNumber(queuesStats?.failed || 0) }}</span> failed
              </div>
            </div>
          </div>

          <!-- Flows Card -->
          <div
            class="bg-gradient-to-br from-purple-500 to-purple-600 dark:from-purple-600 dark:to-purple-700 rounded-xl p-6 text-white shadow-lg hover:shadow-xl transition-shadow cursor-pointer"
            @click="navigateTo('/flows')"
          >
            <div class="flex items-center justify-between mb-4">
              <div class="p-3 bg-white/20 rounded-lg backdrop-blur-sm">
                <UIcon
                  name="i-lucide-git-branch"
                  class="w-6 h-6"
                />
              </div>
              <UIcon
                name="i-lucide-arrow-right"
                class="w-5 h-5 opacity-60"
              />
            </div>
            <div class="text-3xl font-bold mb-1">
              {{ flowsStats?.total || 0 }}
            </div>
            <div class="text-sm opacity-90 mb-3">
              Registered Flows
            </div>
            <div class="flex items-center gap-4 text-xs opacity-75">
              <div v-if="flowsStats?.running > 0">
                <span class="font-semibold">{{ flowsStats?.running }}</span> running
              </div>
              <div v-if="flowsStats?.awaiting > 0">
                <span class="font-semibold">{{ flowsStats?.awaiting }}</span> awaiting
              </div>
              <div>
                <span class="font-semibold">{{ formatNumber(flowsStats?.success || 0) }}</span> success
              </div>
            </div>
          </div>

          <!-- Triggers Card -->
          <div
            class="bg-gradient-to-br from-amber-500 to-amber-600 dark:from-amber-600 dark:to-amber-700 rounded-xl p-6 text-white shadow-lg hover:shadow-xl transition-shadow cursor-pointer"
            @click="navigateTo('/triggers')"
          >
            <div class="flex items-center justify-between mb-4">
              <div class="p-3 bg-white/20 rounded-lg backdrop-blur-sm">
                <UIcon
                  name="i-lucide-zap"
                  class="w-6 h-6"
                />
              </div>
              <UIcon
                name="i-lucide-arrow-right"
                class="w-5 h-5 opacity-60"
              />
            </div>
            <div class="text-3xl font-bold mb-1">
              {{ triggersStats?.total || 0 }}
            </div>
            <div class="text-sm opacity-90 mb-3">
              Active Triggers
            </div>
            <div class="flex items-center gap-4 text-xs opacity-75">
              <div>
                <span class="font-semibold">{{ formatNumber(triggersStats?.totalFires || 0) }}</span> fires
              </div>
              <div>
                <span class="font-semibold">{{ formatNumber(triggersStats?.totalFlowsStarted || 0) }}</span> flows started
              </div>
            </div>
          </div>
        </div>

        <!-- Quick Actions & Recent Activity -->
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <!-- Quick Actions -->
          <div class="bg-white dark:bg-gray-950 rounded-xl border border-gray-200 dark:border-gray-800 p-6">
            <h2 class="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4 flex items-center gap-2">
              <UIcon
                name="i-lucide-rocket"
                class="w-5 h-5 text-blue-500"
              />
              Quick Actions
            </h2>
            <div class="space-y-2">
              <button
                class="w-full flex items-center justify-between p-3 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-900 transition-colors text-left group"
                @click="navigateTo('/queues')"
              >
                <div class="flex items-center gap-3">
                  <div class="p-2 bg-blue-50 dark:bg-blue-950/50 rounded-lg group-hover:bg-blue-100 dark:group-hover:bg-blue-900/50 transition-colors">
                    <UIcon
                      name="i-lucide-app-window"
                      class="w-4 h-4 text-blue-600 dark:text-blue-400"
                    />
                  </div>
                  <div>
                    <div class="text-sm font-medium text-gray-900 dark:text-gray-100">
                      View All Queues
                    </div>
                    <div class="text-xs text-gray-500 dark:text-gray-400">
                      Manage job queues and workers
                    </div>
                  </div>
                </div>
                <UIcon
                  name="i-lucide-chevron-right"
                  class="w-4 h-4 text-gray-400 group-hover:text-gray-600 dark:group-hover:text-gray-300"
                />
              </button>

              <button
                class="w-full flex items-center justify-between p-3 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-900 transition-colors text-left group"
                @click="navigateTo('/flows')"
              >
                <div class="flex items-center gap-3">
                  <div class="p-2 bg-purple-50 dark:bg-purple-950/50 rounded-lg group-hover:bg-purple-100 dark:group-hover:bg-purple-900/50 transition-colors">
                    <UIcon
                      name="i-lucide-git-branch"
                      class="w-4 h-4 text-purple-600 dark:text-purple-400"
                    />
                  </div>
                  <div>
                    <div class="text-sm font-medium text-gray-900 dark:text-gray-100">
                      Monitor Flows
                    </div>
                    <div class="text-xs text-gray-500 dark:text-gray-400">
                      Track workflow executions
                    </div>
                  </div>
                </div>
                <UIcon
                  name="i-lucide-chevron-right"
                  class="w-4 h-4 text-gray-400 group-hover:text-gray-600 dark:group-hover:text-gray-300"
                />
              </button>

              <button
                class="w-full flex items-center justify-between p-3 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-900 transition-colors text-left group"
                @click="navigateTo('/triggers')"
              >
                <div class="flex items-center gap-3">
                  <div class="p-2 bg-amber-50 dark:bg-amber-950/50 rounded-lg group-hover:bg-amber-100 dark:group-hover:bg-amber-900/50 transition-colors">
                    <UIcon
                      name="i-lucide-zap"
                      class="w-4 h-4 text-amber-600 dark:text-amber-400"
                    />
                  </div>
                  <div>
                    <div class="text-sm font-medium text-gray-900 dark:text-gray-100">
                      Manage Triggers
                    </div>
                    <div class="text-xs text-gray-500 dark:text-gray-400">
                      Configure event triggers
                    </div>
                  </div>
                </div>
                <UIcon
                  name="i-lucide-chevron-right"
                  class="w-4 h-4 text-gray-400 group-hover:text-gray-600 dark:group-hover:text-gray-300"
                />
              </button>
            </div>
          </div>

          <!-- System Overview -->
          <div class="bg-white dark:bg-gray-950 rounded-xl border border-gray-200 dark:border-gray-800 p-6">
            <h2 class="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4 flex items-center gap-2">
              <UIcon
                name="i-lucide-activity"
                class="w-5 h-5 text-emerald-500"
              />
              System Overview
            </h2>
            <div class="space-y-3">
              <!-- Jobs Processed -->
              <div class="flex items-center justify-between p-3 rounded-lg bg-gray-50 dark:bg-gray-900">
                <div class="flex items-center gap-3">
                  <div class="p-2 bg-blue-100 dark:bg-blue-950 rounded-lg">
                    <UIcon
                      name="i-lucide-package"
                      class="w-4 h-4 text-blue-600 dark:text-blue-400"
                    />
                  </div>
                  <div>
                    <div class="text-xs text-gray-500 dark:text-gray-400">
                      Jobs Processed
                    </div>
                    <div class="text-sm font-semibold text-gray-900 dark:text-gray-100">
                      {{ formatNumber(queuesStats?.completed || 0) }} completed
                    </div>
                  </div>
                </div>
                <div
                  v-if="queuesStats?.failed > 0"
                  class="text-xs text-red-600 dark:text-red-400"
                >
                  {{ queuesStats?.failed }} failed
                </div>
              </div>

              <!-- Flow Runs -->
              <div class="flex items-center justify-between p-3 rounded-lg bg-gray-50 dark:bg-gray-900">
                <div class="flex items-center gap-3">
                  <div class="p-2 bg-purple-100 dark:bg-purple-950 rounded-lg">
                    <UIcon
                      name="i-lucide-git-branch"
                      class="w-4 h-4 text-purple-600 dark:text-purple-400"
                    />
                  </div>
                  <div>
                    <div class="text-xs text-gray-500 dark:text-gray-400">
                      Total Flow Runs
                    </div>
                    <div class="text-sm font-semibold text-gray-900 dark:text-gray-100">
                      {{ formatNumber(flowsStats?.totalRuns || 0) }} runs
                    </div>
                  </div>
                </div>
                <div
                  v-if="flowsStats?.running > 0"
                  class="text-xs text-blue-600 dark:text-blue-400 font-semibold"
                >
                  {{ flowsStats?.running }} running
                </div>
              </div>

              <!-- Trigger Fires -->
              <div class="flex items-center justify-between p-3 rounded-lg bg-gray-50 dark:bg-gray-900">
                <div class="flex items-center gap-3">
                  <div class="p-2 bg-amber-100 dark:bg-amber-950 rounded-lg">
                    <UIcon
                      name="i-lucide-zap"
                      class="w-4 h-4 text-amber-600 dark:text-amber-400"
                    />
                  </div>
                  <div>
                    <div class="text-xs text-gray-500 dark:text-gray-400">
                      Trigger → Flow Starts
                    </div>
                    <div class="text-sm font-semibold text-gray-900 dark:text-gray-100">
                      {{ formatNumber(triggersStats?.totalFlowsStarted || 0) }} flows
                    </div>
                  </div>
                </div>
                <div class="text-xs text-gray-500 dark:text-gray-400">
                  from {{ formatNumber(triggersStats?.totalFires || 0) }} fires
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Recent Items Grid -->
        <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <!-- Recent Queues -->
          <div class="bg-white dark:bg-gray-950 rounded-xl border border-gray-200 dark:border-gray-800 p-6">
            <div class="flex items-center justify-between mb-4">
              <h3 class="text-sm font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                <UIcon
                  name="i-lucide-app-window"
                  class="w-4 h-4 text-blue-500"
                />
                Active Queues
              </h3>
              <button
                class="text-xs text-blue-600 dark:text-blue-400 hover:underline"
                @click="navigateTo('/queues')"
              >
                View all
              </button>
            </div>
            <div
              v-if="!recentQueues || recentQueues.length === 0"
              class="text-center py-8 text-sm text-gray-400"
            >
              <UIcon
                name="i-lucide-inbox"
                class="w-8 h-8 mx-auto mb-2 text-gray-300 dark:text-gray-700"
              />
              <p>No queues found</p>
            </div>
            <div
              v-else
              class="space-y-2"
            >
              <div
                v-for="queue in recentQueues.slice(0, 5)"
                :key="queue.name"
                class="flex items-center justify-between p-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-900 transition-colors cursor-pointer"
                @click="navigateTo(`/queues?queue=${encodeURIComponent(queue.name)}`)"
              >
                <div class="flex items-center gap-2 min-w-0">
                  <div
                    class="w-2 h-2 rounded-full"
                    :class="queue.isPaused ? 'bg-gray-400' : 'bg-blue-500'"
                  />
                  <span class="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{{ queue.name }}</span>
                </div>
                <div class="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400 shrink-0">
                  <span
                    v-if="(queue.counts?.active || 0) + (queue.counts?.waiting || 0) > 0"
                    class="text-blue-600 dark:text-blue-400 font-medium"
                  >
                    {{ (queue.counts?.active || 0) + (queue.counts?.waiting || 0) }} pending
                  </span>
                  <span v-else>
                    {{ queue.counts?.completed || 0 }} completed
                  </span>
                </div>
              </div>
            </div>
          </div>

          <!-- Recent Flow Runs -->
          <div class="bg-white dark:bg-gray-950 rounded-xl border border-gray-200 dark:border-gray-800 p-6">
            <div class="flex items-center justify-between mb-4">
              <h3 class="text-sm font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                <UIcon
                  name="i-lucide-git-branch"
                  class="w-4 h-4 text-purple-500"
                />
                Recent Flow Runs
              </h3>
              <button
                class="text-xs text-purple-600 dark:text-purple-400 hover:underline"
                @click="navigateTo('/flows')"
              >
                View all
              </button>
            </div>
            <div
              v-if="!recentFlowRuns || recentFlowRuns.length === 0"
              class="text-center py-8 text-sm text-gray-400"
            >
              <UIcon
                name="i-lucide-inbox"
                class="w-8 h-8 mx-auto mb-2 text-gray-300 dark:text-gray-700"
              />
              <p>No flow runs found</p>
            </div>
            <div
              v-else
              class="space-y-2"
            >
              <div
                v-for="run in recentFlowRuns"
                :key="run.id"
                class="flex items-center justify-between p-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-900 transition-colors cursor-pointer"
                @click="navigateTo(`/flows/${encodeURIComponent(run.flowName)}`)"
              >
                <div class="flex items-center gap-2 min-w-0">
                  <div
                    class="w-2 h-2 rounded-full"
                    :class="{
                      'bg-purple-500': (run.stats?.running || 0) > 0,
                      'bg-amber-500': (run.stats?.awaiting || 0) > 0 && (run.stats?.running || 0) === 0,
                      'bg-red-500': (run.stats?.failure || 0) > 0 && (run.stats?.running || 0) === 0 && (run.stats?.awaiting || 0) === 0,
                      'bg-emerald-500': (run.stats?.success || 0) > 0 && (run.stats?.running || 0) === 0 && (run.stats?.awaiting || 0) === 0 && (run.stats?.failure || 0) === 0,
                      'bg-gray-400': (run.stats?.total || 0) === 0,
                    }"
                  />
                  <span class="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{{ run.flowDisplayName || run.flowName }}</span>
                </div>
                <div class="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400 shrink-0">
                  <span
                    v-if="(run.stats?.running || 0) > 0"
                    class="text-purple-600 dark:text-purple-400 font-medium"
                  >
                    {{ run.stats?.running }} running
                  </span>
                  <span
                    v-else-if="(run.stats?.awaiting || 0) > 0"
                    class="text-amber-600 dark:text-amber-400 font-medium"
                  >
                    {{ run.stats?.awaiting }} awaiting
                  </span>
                  <span v-else>
                    {{ run.stats?.total || 0 }} runs
                  </span>
                </div>
              </div>
            </div>
          </div>

          <!-- Recent Triggers -->
          <div class="bg-white dark:bg-gray-950 rounded-xl border border-gray-200 dark:border-gray-800 p-6">
            <div class="flex items-center justify-between mb-4">
              <h3 class="text-sm font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                <UIcon
                  name="i-lucide-zap"
                  class="w-4 h-4 text-amber-500"
                />
                Active Triggers
              </h3>
              <button
                class="text-xs text-amber-600 dark:text-amber-400 hover:underline"
                @click="navigateTo('/triggers')"
              >
                View all
              </button>
            </div>
            <div
              v-if="!recentTriggers || recentTriggers.length === 0"
              class="text-center py-8 text-sm text-gray-400"
            >
              <UIcon
                name="i-lucide-inbox"
                class="w-8 h-8 mx-auto mb-2 text-gray-300 dark:text-gray-700"
              />
              <p>No triggers found</p>
            </div>
            <div
              v-else
              class="space-y-2"
            >
              <div
                v-for="trigger in recentTriggers.slice(0, 5)"
                :key="trigger.name"
                class="flex items-center justify-between p-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-900 transition-colors cursor-pointer"
                @click="navigateTo(`/triggers/${encodeURIComponent(trigger.name)}`)"
              >
                <div class="flex items-center gap-2 min-w-0">
                  <div class="w-2 h-2 rounded-full bg-amber-500" />
                  <span class="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{{ trigger.displayName || trigger.name }}</span>
                </div>
                <span class="text-xs text-gray-500 dark:text-gray-400 shrink-0">{{ trigger.stats?.totalFires || 0 }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from '#imports'
import { UIcon } from '#components'
import { useComponentRouter } from '../composables/useComponentRouter'
import { useQueuesWebSocket } from '../composables/useQueuesWebSocket'
import { useFlowWebSocket } from '../composables/useFlowWebSocket'
import { useTriggerWebSocket } from '../composables/useTriggerWebSocket'

const router = useComponentRouter()

// Live data stores
const queues = ref<any[]>([])
const flows = ref<any[]>([])
const triggers = ref<any[]>([])

// WebSocket connections for live stats
const { connected: queuesConnected, subscribe: subscribeQueue } = useQueuesWebSocket()
const { connected: flowsConnected, subscribeStats: subscribeFlowStats } = useFlowWebSocket()
const { connected: triggersConnected, subscribeStats: subscribeTriggerStats } = useTriggerWebSocket()

// Initialize live data on mount
onMounted(async () => {
  // Skip on server
  if (import.meta.server) return

  // Fetch initial data
  const [queuesResponse, flowsResponse, triggersResponse] = await Promise.all([
    $fetch('/api/_queues'),
    $fetch('/api/_flows'),
    $fetch('/api/_triggers'),
  ])

  queues.value = Array.isArray(queuesResponse) ? queuesResponse : []

  // Initialize flows with proper structure (same as flows/index.vue)
  const analyzedFlows = Array.isArray(flowsResponse) ? flowsResponse : []
  flows.value = analyzedFlows.map((flow: any) => ({
    id: flow.id,
    name: flow.id, // Add name property for consistency
    displayName: flow.id,
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

  // Initialize triggers with empty stats that will be populated by WebSocket
  triggers.value = (Array.isArray(triggersResponse) ? triggersResponse : []).map((trigger: any) => ({
    ...trigger,
    stats: trigger.stats || {
      totalFires: 0,
      totalFlowsStarted: 0,
      lastFiredAt: null,
      activeSubscribers: 0,
    },
  }))

  // Subscribe to live queue stats for each queue
  for (const queue of queues.value) {
    subscribeQueue(
      queue.name,
      (counts) => {
        // Replace the entire array to trigger reactivity
        queues.value = queues.value.map(q =>
          q.name === queue.name ? { ...q, counts } : q,
        )
      },
    )
  }

  // Subscribe to live flow stats
  subscribeFlowStats({
    onInitial: (data: any) => {
      updateFlowStats(data)
    },
    onUpdate: (data: any) => {
      updateFlowStats(data)
    },
  })

  // Subscribe to live trigger stats
  subscribeTriggerStats({
    onInitial: (data: any) => {
      updateTriggerStats(data)
    },
    onUpdate: (data: any) => {
      updateTriggerStats(data)
    },
  })
})

// Update flow stats from WebSocket message (same pattern as flows/index.vue)
function updateFlowStats(data: any) {
  const flowId = data?.id
  if (!flowId) {
    console.warn('[Dashboard] No flow ID in stats update:', data)
    return
  }

  if (!flows.value || flows.value.length === 0) {
    console.warn('[Dashboard] Flows array not initialized yet')
    return
  }

  const flowIndex = flows.value.findIndex(f => f.id === flowId)
  if (flowIndex === -1) {
    console.warn('[Dashboard] Flow not found in list:', flowId, 'available:', flows.value.map(f => f.id))
    return
  }

  const metadata = data?.metadata
  if (!metadata) {
    console.warn('[Dashboard] No metadata in update:', data)
    return
  }

  // Stats can be nested object, dotted keys, or flat keys
  const newStats = {
    total: metadata.stats?.total || metadata.total || metadata['stats.total'] || 0,
    success: metadata.stats?.success || metadata.success || metadata['stats.success'] || 0,
    failure: metadata.stats?.failure || metadata.failure || metadata['stats.failure'] || 0,
    cancel: metadata.stats?.cancel || metadata.cancel || metadata['stats.cancel'] || 0,
    running: metadata.stats?.running || metadata.running || metadata['stats.running'] || 0,
    awaiting: metadata.stats?.awaiting || metadata.awaiting || metadata['stats.awaiting'] || 0,
  }

  // Create a completely new flow object to ensure Vue reactivity
  const updatedFlow = {
    ...flows.value[flowIndex],
    stats: newStats,
    lastRunAt: metadata.lastRunAt,
    lastCompletedAt: metadata.lastCompletedAt,
  }

  // Replace in array to trigger reactivity
  flows.value = [
    ...flows.value.slice(0, flowIndex),
    updatedFlow,
    ...flows.value.slice(flowIndex + 1),
  ]
}

// Update trigger stats from WebSocket message (same pattern as triggers/index.vue)
function updateTriggerStats(data: any) {
  const triggerName = data?.id
  if (!triggerName) {
    console.warn('[Dashboard] No trigger name in stats update:', data)
    return
  }

  if (!triggers.value || triggers.value.length === 0) {
    console.warn('[Dashboard] Triggers array not initialized yet, storing for later')
    return
  }

  const triggerIndex = triggers.value.findIndex(t => t.name === triggerName)
  if (triggerIndex === -1) {
    console.warn('[Dashboard] Trigger not found in list:', triggerName, 'available:', triggers.value.map(t => t.name))
    return
  }

  const metadata = data?.metadata
  if (!metadata) {
    console.warn('[Dashboard] No metadata in update:', data)
    return
  }

  // Stats can be nested object, dotted keys, or flat keys
  const newStats = {
    totalFires: metadata.stats?.totalFires || metadata.totalFires || metadata['stats.totalFires'] || 0,
    totalFlowsStarted: metadata.stats?.totalFlowsStarted || metadata.totalFlowsStarted || metadata['stats.totalFlowsStarted'] || 0,
    last24h: metadata.stats?.last24h || metadata.last24h || metadata['stats.last24h'] || 0,
    successCount: metadata.stats?.successCount || metadata.successCount || metadata['stats.successCount'] || 0,
    failureCount: metadata.stats?.failureCount || metadata.failureCount || metadata['stats.failureCount'] || 0,
    lastFiredAt: metadata.stats?.lastFiredAt || metadata.lastFiredAt || metadata['stats.lastFiredAt'],
    activeSubscribers: metadata.stats?.activeSubscribers || metadata.activeSubscribers || metadata['stats.activeSubscribers'] || 0,
  }

  // Create a completely new trigger object to ensure Vue reactivity
  const updatedTrigger = {
    ...triggers.value[triggerIndex],
    stats: newStats,
    lastActivityAt: metadata.lastActivityAt,
  }

  // Replace in array to trigger reactivity
  triggers.value = [
    ...triggers.value.slice(0, triggerIndex),
    updatedTrigger,
    ...triggers.value.slice(triggerIndex + 1),
  ]
}

// Computed stats
const queuesStats = computed(() => {
  const pending = queues.value.reduce((sum, q) => {
    const counts = q.counts || {}
    return sum + (counts.active || 0) + (counts.waiting || 0) + (counts.delayed || 0)
  }, 0)
  const completed = queues.value.reduce((sum, q) => sum + (q.counts?.completed || 0), 0)
  const failed = queues.value.reduce((sum, q) => sum + (q.counts?.failed || 0), 0)

  return {
    total: queues.value.length,
    pending,
    completed,
    failed,
  }
})

const flowsStats = computed(() => {
  const totalRuns = flows.value.reduce((sum, f) => sum + (f.stats?.total || 0), 0)
  const running = flows.value.reduce((sum, f) => sum + (f.stats?.running || 0), 0)
  const awaiting = flows.value.reduce((sum, f) => sum + (f.stats?.awaiting || 0), 0)
  const success = flows.value.reduce((sum, f) => sum + (f.stats?.success || 0), 0)
  const failure = flows.value.reduce((sum, f) => sum + (f.stats?.failure || 0), 0)

  return {
    total: flows.value.length,
    active: flows.value.filter(f => f.enabled !== false).length,
    totalRuns,
    running,
    awaiting,
    success,
    failure,
  }
})

const triggersStats = computed(() => {
  const totalFires = triggers.value.reduce((sum, t) => sum + (t.stats?.totalFires || 0), 0)
  const totalFlowsStarted = triggers.value.reduce((sum, t) => sum + (t.stats?.totalFlowsStarted || 0), 0)
  const totalSubscriptions = triggers.value.reduce((sum, t) => sum + (t.subscriptionCount || 0), 0)

  return {
    total: triggers.value.length,
    totalFires,
    totalFlowsStarted,
    totalSubscriptions,
  }
})

const recentQueues = computed(() => {
  return queues.value
    .map(q => ({
      ...q,
      displayName: q.name,
      status: q.isPaused ? 'paused' : 'active',
    }))
    .sort((a, b) => {
      const aPending = (a.counts?.active || 0) + (a.counts?.waiting || 0)
      const bPending = (b.counts?.active || 0) + (b.counts?.waiting || 0)
      return bPending - aPending // Sort by most pending jobs first
    })
})

const recentFlowRuns = computed(() => {
  return [...flows.value]
    .filter(f => f.stats?.total > 0) // Only show flows that have been run
    .sort((a, b) => {
      // Prioritize running/awaiting, then sort by most recent
      const aActive = (a.stats?.running || 0) + (a.stats?.awaiting || 0)
      const bActive = (b.stats?.running || 0) + (b.stats?.awaiting || 0)
      if (aActive !== bActive) return bActive - aActive
      const aTime = a.lastRunAt || 0
      const bTime = b.lastRunAt || 0
      return bTime - aTime
    })
    .slice(0, 5)
    .map(f => ({
      id: f.name,
      flowName: f.name,
      flowDisplayName: f.displayName || f.name,
      stats: f.stats,
    }))
})

const recentTriggers = computed(() => {
  return [...triggers.value]
    .sort((a, b) => {
      const aFires = a.stats?.totalFires || 0
      const bFires = b.stats?.totalFires || 0
      return bFires - aFires // Sort by most fires
    })
})

const isConnected = computed(() => {
  return queuesConnected.value || flowsConnected.value || triggersConnected.value
})

// Navigation helper
const navigateTo = (path: string) => {
  router.push(path)
}

// Format number helper
const formatNumber = (num: number | undefined) => {
  if (num == null) return '0'
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`
  if (num >= 1000) return `${(num / 1000).toFixed(1)}K`
  return num.toString()
}
</script>
