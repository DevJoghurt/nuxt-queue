<template>
  <div class="h-full flex flex-col overflow-hidden">
    <!-- Header -->
    <div class="border-b border-gray-200 dark:border-gray-800 px-6 py-3 shrink-0">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-4">
          <h1 class="text-lg font-semibold">
            Triggers
          </h1>
        </div>
        <div>
          <UButton
            icon="i-lucide-plus"
            label="Create Trigger"
            color="primary"
            @click="router.push('/triggers/new')"
            size="sm"
          />
        </div>
      </div>
    </div>

    <!-- Main Content -->
    <div class="flex-1 min-h-0 overflow-y-auto">
      <div class="max-w-7xl mx-auto p-6">
        <!-- Stats Overview -->
        <div
          v-if="stats"
          class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6"
        >
          <StatCard
            icon="i-lucide-zap"
            :count="stats.total"
            label="Total Triggers"
            variant="gray"
          />
          <StatCard
            icon="i-lucide-radio"
            :count="stats.entryTriggers"
            label="Entry Triggers"
            variant="blue"
          />
          <StatCard
            icon="i-lucide-hand"
            :count="stats.awaitTriggers"
            label="Await Triggers"
            variant="purple"
          />
          <StatCard
            icon="i-lucide-activity"
            :count="stats.totalFires"
            label="Fires (24h)"
            variant="emerald"
          />
        </div>

        <!-- Filters -->
        <div class="mb-4 flex items-center gap-3">
          <div class="flex-1">
            <UInput
              v-model="searchQuery"
              icon="i-lucide-search"
              placeholder="Search triggers..."
              size="sm"
            />
          </div>
          <USelectMenu
            v-model="typeFilter"
            :items="typeFilterOptions"
            value-key="value"
            placeholder="All Types"
            size="sm"
            class="w-44"
          >
            <template #label>
              <span v-if="typeFilter === 'all'">All Types</span>
              <div
                v-else
                class="flex items-center gap-2"
              >
                <UIcon
                  :name="getTriggerIcon(typeFilter)"
                  class="w-4 h-4"
                />
                <span class="capitalize">{{ typeFilter }}</span>
              </div>
            </template>
          </USelectMenu>
          <USelectMenu
            v-model="scopeFilter"
            :items="scopeFilterOptions"
            value-key="value"
            placeholder="All Scopes"
            size="sm"
            class="w-40"
          >
            <template #label>
              <span v-if="scopeFilter === 'all'">All Scopes</span>
              <div
                v-else
                class="flex items-center gap-2"
              >
                <UIcon
                  :name="scopeFilter === 'flow' ? 'i-lucide-git-branch' : 'i-lucide-play-circle'"
                  class="w-4 h-4"
                />
                <span class="capitalize">{{ scopeFilter }}</span>
              </div>
            </template>
          </USelectMenu>
          <USelectMenu
            v-model="statusFilter"
            :items="statusFilterOptions"
            value-key="value"
            placeholder="All Status"
            size="sm"
            class="w-40"
          >
            <template #label>
              <span v-if="statusFilter === 'all'">All Status</span>
              <div
                v-else
                class="flex items-center gap-2"
              >
                <UIcon
                  :name="statusFilter === 'active' ? 'i-lucide-check-circle' : statusFilter === 'inactive' ? 'i-lucide-pause-circle' : 'i-lucide-archive'"
                  class="w-4 h-4"
                />
                <span class="capitalize">{{ statusFilter }}</span>
              </div>
            </template>
          </USelectMenu>
        </div>

      <!-- Triggers List -->
      <div
        v-if="!filteredTriggers || filteredTriggers.length === 0"
        class="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 p-8 text-center text-gray-500"
      >
        <div v-if="status === 'pending'">
          <UIcon
            name="i-lucide-loader-2"
            class="w-12 h-12 animate-spin mx-auto mb-3 opacity-50"
          />
          <p>Loading triggers...</p>
        </div>
        <div v-else-if="searchQuery || typeFilter !== 'all' || scopeFilter !== 'all' || statusFilter !== 'all'">
          <UIcon
            name="i-lucide-search-x"
            class="w-12 h-12 mx-auto mb-3 opacity-50"
          />
          <p>No triggers match your filters</p>
          <UButton
            size="xs"
            color="neutral"
            variant="ghost"
            class="mt-2"
            @click="clearFilters"
          >
            Clear Filters
          </UButton>
        </div>
        <div v-else>
          <UIcon
            name="i-lucide-zap-off"
            class="w-12 h-12 mx-auto mb-3 opacity-50"
          />
          <p>No triggers registered</p>
        </div>
      </div>
      <div
        v-else
        class="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 overflow-hidden"
      >
        <div class="divide-y divide-gray-100 dark:divide-gray-800">
          <div
            v-for="trigger in paginatedTriggers"
            :key="trigger.name"
            class="px-6 py-4 hover:bg-gray-50 dark:hover:bg-gray-900/50 transition-colors cursor-pointer"
            @click="selectTrigger(trigger.name)"
          >
            <div class="flex items-start justify-between gap-4">
              <!-- Left: Trigger Info -->
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 mb-1">
                  <UIcon
                    :name="getTriggerIcon(trigger.type)"
                    class="w-4 h-4 shrink-0"
                    :class="getTriggerIconColor(trigger.type)"
                  />
                  <h3 class="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">
                    {{ trigger.displayName || trigger.name }}
                  </h3>
                  <UBadge
                    :label="trigger.type"
                    :color="getTriggerTypeColor(trigger.type)"
                    variant="subtle"
                    size="xs"
                  />
                  <UBadge
                    :label="trigger.scope"
                    color="neutral"
                    variant="subtle"
                    size="xs"
                  />
                </div>
                
                <p
                  v-if="trigger.description"
                  class="text-xs text-gray-500 dark:text-gray-400 mb-2 line-clamp-1"
                >
                  {{ trigger.description }}
                </p>
                
                <div class="flex items-center gap-4 text-xs text-gray-500 dark:text-gray-400">
                  <div class="flex items-center gap-1">
                    <UIcon
                      name="i-lucide-git-branch"
                      class="w-3 h-3"
                    />
                    <span>{{ trigger.subscriptionCount }} flow{{ trigger.subscriptionCount === 1 ? '' : 's' }}</span>
                  </div>
                  <div
                    v-if="trigger.stats.totalFires > 0"
                    class="flex items-center gap-1"
                  >
                    <UIcon
                      name="i-lucide-zap"
                      class="w-3 h-3"
                    />
                    <span>{{ formatNumber(trigger.stats.totalFires) }} fires</span>
                  </div>
                  <div
                    v-if="trigger.lastActivityAt"
                    class="flex items-center gap-1"
                  >
                    <UIcon
                      name="i-lucide-clock"
                      class="w-3 h-3"
                    />
                    <span>{{ formatTime(trigger.lastActivityAt) }}</span>
                  </div>
                  <div
                    v-if="trigger.source"
                    class="flex items-center gap-1"
                  >
                    <UIcon
                      name="i-lucide-package"
                      class="w-3 h-3"
                    />
                    <span>{{ trigger.source }}</span>
                  </div>
                </div>
              </div>

              <!-- Right: Stats & Status -->
              <div class="flex items-center gap-3">
                <!-- Today's Fires -->
                <div
                  v-if="trigger.stats.last24h > 0"
                  class="text-center"
                >
                  <div class="text-xs text-gray-500 dark:text-gray-400 mb-0.5">
                    Last 24h
                  </div>
                  <div class="text-sm font-semibold text-emerald-600 dark:text-emerald-400">
                    {{ formatNumber(trigger.stats.last24h) }}
                  </div>
                </div>

                <!-- Success Rate -->
                <div
                  v-if="trigger.stats.totalFires > 0"
                  class="text-center"
                >
                  <div class="text-xs text-gray-500 dark:text-gray-400 mb-0.5">
                    Success
                  </div>
                  <div
                    class="text-sm font-semibold"
                    :class="trigger.stats.successRate && trigger.stats.successRate >= 95 ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'"
                  >
                    {{ trigger.stats.successRate?.toFixed(1) || '100' }}%
                  </div>
                </div>

                <!-- Status Badge -->
                <UBadge
                  :label="trigger.status"
                  :color="trigger.status === 'active' ? 'success' : trigger.status === 'inactive' ? 'warning' : 'neutral'"
                  variant="subtle"
                />

                <!-- Actions -->
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

        <!-- Pagination -->
        <div
          v-if="totalPages > 1"
          class="border-t border-gray-200 dark:border-gray-800 px-6 py-4 flex items-center justify-center"
        >
          <UPagination
            v-model:page="currentPage"
            :items-per-page="itemsPerPage"
            :total="filteredTriggers.length"
          />
        </div>
      </div>

      <!-- Footer Info -->
      <div
        v-if="filteredTriggers && filteredTriggers.length > 0"
        class="mt-4 text-center text-sm text-gray-500 dark:text-gray-400"
      >
        Showing {{ startIndex + 1 }}-{{ endIndex }} of {{ filteredTriggers.length }} trigger{{ filteredTriggers.length === 1 ? '' : 's' }}
      </div>
    </div>
  </div>
</div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from '#imports'
import { UButton, UIcon, UBadge, UInput, USelectMenu, UPagination } from '#components'
import { useTriggers, useTriggersStats } from '../../composables/useTriggers'
import { useComponentRouter } from '../../composables/useComponentRouter'
import StatCard from '../../components/StatCard.vue'

const { triggers, refresh, status } = useTriggers()
const { stats, refresh: refreshStats } = useTriggersStats()
const router = useComponentRouter()

// Auto-refresh every 5 seconds
let refreshInterval: NodeJS.Timeout | null = null

onMounted(() => {
  refreshInterval = setInterval(() => {
    refresh()
    refreshStats()
  }, 5000)
})

onUnmounted(() => {
  if (refreshInterval) {
    clearInterval(refreshInterval)
  }
})

// Filters
const searchQuery = ref('')
const typeFilter = ref('all')
const scopeFilter = ref('all')
const statusFilter = ref('all')

const typeFilterOptions = [
  { label: 'All Types', value: 'all' },
  { label: 'Event', value: 'event', icon: 'i-lucide-radio' },
  { label: 'Webhook', value: 'webhook', icon: 'i-lucide-webhook' },
  { label: 'Schedule', value: 'schedule', icon: 'i-lucide-clock' },
  { label: 'Manual', value: 'manual', icon: 'i-lucide-hand' },
]

const scopeFilterOptions = [
  { label: 'All Scopes', value: 'all' },
  { label: 'Flow', value: 'flow', icon: 'i-lucide-git-branch' },
  { label: 'Run', value: 'run', icon: 'i-lucide-play-circle' },
]

const statusFilterOptions = [
  { label: 'All Status', value: 'all' },
  { label: 'Active', value: 'active', icon: 'i-lucide-check-circle' },
  { label: 'Inactive', value: 'inactive', icon: 'i-lucide-pause-circle' },
  { label: 'Retired', value: 'retired', icon: 'i-lucide-archive' },
]

// Pagination
const currentPage = ref(1)
const itemsPerPage = 10

// Filtered triggers
const filteredTriggers = computed(() => {
  if (!triggers.value) return []

  let result = triggers.value

  // Search filter
  if (searchQuery.value) {
    const query = searchQuery.value.toLowerCase()
    result = result.filter(
      t =>
        t.name.toLowerCase().includes(query)
        || t.displayName?.toLowerCase().includes(query)
        || t.description?.toLowerCase().includes(query),
    )
  }

  // Type filter
  if (typeFilter.value !== 'all') {
    result = result.filter(t => t.type === typeFilter.value)
  }

  // Scope filter
  if (scopeFilter.value !== 'all') {
    result = result.filter(t => t.scope === scopeFilter.value)
  }

  // Status filter
  if (statusFilter.value !== 'all') {
    result = result.filter(t => t.status === statusFilter.value)
  }

  return result
})

// Pagination calculations
const totalPages = computed(() => {
  if (!filteredTriggers.value) return 0
  return Math.ceil(filteredTriggers.value.length / itemsPerPage)
})

const startIndex = computed(() => {
  return (currentPage.value - 1) * itemsPerPage
})

const endIndex = computed(() => {
  if (!filteredTriggers.value) return 0
  return Math.min(startIndex.value + itemsPerPage, filteredTriggers.value.length)
})

const paginatedTriggers = computed(() => {
  if (!filteredTriggers.value) return []
  return filteredTriggers.value.slice(startIndex.value, endIndex.value)
})

const clearFilters = () => {
  searchQuery.value = ''
  typeFilter.value = 'all'
  scopeFilter.value = 'all'
  statusFilter.value = 'all'
  currentPage.value = 1
}

const selectTrigger = (name: string) => {
  router.push(`/triggers/${encodeURIComponent(name)}`)
}

// Helper functions
const getTriggerIcon = (type: string) => {
  switch (type) {
    case 'event': return 'i-lucide-radio'
    case 'webhook': return 'i-lucide-webhook'
    case 'schedule': return 'i-lucide-clock'
    case 'manual': return 'i-lucide-hand'
    default: return 'i-lucide-zap'
  }
}

const getTriggerIconColor = (type: string) => {
  switch (type) {
    case 'event': return 'text-blue-500'
    case 'webhook': return 'text-purple-500'
    case 'schedule': return 'text-emerald-500'
    case 'manual': return 'text-amber-500'
    default: return 'text-gray-500'
  }
}

const getTriggerTypeColor = (type: string): 'primary' | 'success' | 'warning' | 'error' | 'neutral' => {
  switch (type) {
    case 'event': return 'primary'
    case 'webhook': return 'success'
    case 'schedule': return 'warning'
    case 'manual': return 'neutral'
    default: return 'neutral'
  }
}

const formatTime = (timestamp: number) => {
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

const formatNumber = (num: number | undefined) => {
  if (num == null) return '0'
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`
  if (num >= 1000) return `${(num / 1000).toFixed(1)}K`
  return num.toString()
}
</script>
