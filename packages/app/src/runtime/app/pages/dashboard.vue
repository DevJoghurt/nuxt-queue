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
        <button
          class="flex items-center gap-2 px-3 py-1.5 text-xs text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
          @click="refreshAll"
        >
          <UIcon
            name="i-lucide-refresh-cw"
            class="w-4 h-4"
            :class="{ 'animate-spin': isRefreshing }"
          />
          <span>Refresh</span>
        </button>
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
              <div>
                <span class="font-semibold">{{ flowsStats?.active || 0 }}</span> active
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
                <span class="font-semibold">{{ triggersStats?.totalSubscriptions || 0 }}</span> subs
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
                      Recent Flows
                    </div>
                    <div class="text-sm font-semibold text-gray-900 dark:text-gray-100">
                      {{ recentFlowRuns.length }} runs
                    </div>
                  </div>
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
                      Total Trigger Fires
                    </div>
                    <div class="text-sm font-semibold text-gray-900 dark:text-gray-100">
                      {{ formatNumber(triggersStats?.totalFires || 0) }} events
                    </div>
                  </div>
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
                @click="navigateTo(`/flows`)"
              >
                <div class="flex items-center gap-2 min-w-0">
                  <div
                    class="w-2 h-2 rounded-full"
                    :class="{
                      'bg-emerald-500': run.status === 'completed',
                      'bg-red-500': run.status === 'failed',
                      'bg-blue-500': run.status === 'running',
                      'bg-gray-400': run.status === 'unknown',
                    }"
                  />
                  <span class="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{{ run.flowDisplayName || run.flowName }}</span>
                </div>
                <div class="flex items-center gap-2 shrink-0">
                  <UBadge
                    :label="run.status"
                    :color="run.status === 'completed' ? 'success' : run.status === 'failed' ? 'error' : run.status === 'running' ? 'info' : 'neutral'"
                    variant="subtle"
                    size="xs"
                  />
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
import { ref, computed } from '#imports'
import { UIcon, UBadge } from '#components'
import { useComponentRouter } from '../composables/useComponentRouter'
import { useFetch } from '#app'

const router = useComponentRouter()

// Refresh state
const isRefreshing = ref(false)

// Fetch data from APIs
const { data: queuesData, refresh: refreshQueues } = useFetch('/api/_queues')
const { data: flowsData, refresh: refreshFlows } = useFetch('/api/_flows')
const { data: flowRunsData, refresh: refreshFlowRuns } = useFetch('/api/_flows/recent-runs?limit=5')
const { data: triggersStats, refresh: refreshStats } = useFetch('/api/_triggers/stats')
const { data: recentTriggers, refresh: refreshTriggers } = useFetch('/api/_triggers')

// Computed stats
const queuesStats = computed(() => {
  if (!queuesData.value) return { total: 0, pending: 0, completed: 0, failed: 0 }
  
  const queues = Array.isArray(queuesData.value) ? queuesData.value : []
  const pending = queues.reduce((sum: number, q: any) => {
    const counts = q.counts || {}
    return sum + (counts.active || 0) + (counts.waiting || 0) + (counts.delayed || 0)
  }, 0)
  const completed = queues.reduce((sum: number, q: any) => sum + (q.counts?.completed || 0), 0)
  const failed = queues.reduce((sum: number, q: any) => sum + (q.counts?.failed || 0), 0)
  
  return {
    total: queues.length,
    pending,
    completed,
    failed,
  }
})

const flowsStats = computed(() => {
  if (!flowsData.value) return { total: 0, active: 0 }
  
  const flows = Array.isArray(flowsData.value) ? flowsData.value : []
  return {
    total: flows.length,
    active: flows.filter((f: any) => f.enabled !== false).length,
  }
})

const recentFlowRuns = computed(() => {
  if (!flowRunsData.value || typeof flowRunsData.value !== 'object') return []
  const data = flowRunsData.value as any
  return data.items || []
})

const recentQueues = computed(() => {
  if (!queuesData.value) return []
  const queues = Array.isArray(queuesData.value) ? queuesData.value : []
  return queues.map((q: any) => ({
    ...q,
    displayName: q.name,
    status: q.isPaused ? 'paused' : 'active',
  }))
})

// Refresh all data
const refreshAll = async () => {
  isRefreshing.value = true
  try {
    await Promise.all([
      refreshQueues(),
      refreshFlows(),
      refreshFlowRuns(),
      refreshStats(),
      refreshTriggers(),
    ])
  }
  finally {
    isRefreshing.value = false
  }
}

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
