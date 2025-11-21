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
                :name="getTriggerIcon(trigger?.type || 'event')"
                class="w-5 h-5"
                :class="getTriggerIconColor(trigger?.type || 'event')"
              />
              <span>{{ trigger?.displayName || trigger?.name }}</span>
            </h1>
            <div class="flex items-center gap-2 mt-1">
              <UBadge
                v-if="trigger"
                :label="trigger.type"
                :color="getTriggerTypeColor(trigger.type)"
                variant="subtle"
                size="xs"
              />
              <UBadge
                v-if="trigger"
                :label="trigger.scope"
                color="neutral"
                variant="subtle"
                size="xs"
              />
              <UBadge
                v-if="trigger"
                :label="trigger.status"
                :color="trigger.status === 'active' ? 'success' : trigger.status === 'inactive' ? 'warning' : 'neutral'"
                variant="subtle"
                size="xs"
              />
            </div>
          </div>
        </div>
        <div class="flex items-center gap-3">
          <UButton
            icon="i-lucide-pencil"
            color="neutral"
            variant="outline"
            @click="goToEdit"
          >
            Edit
          </UButton>
          <div
            v-if="isConnected"
            class="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400"
          >
            <div class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span>Live</span>
          </div>
          <div
            v-else-if="isReconnecting"
            class="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400"
          >
            <div class="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
            <span>Reconnecting...</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Main Content -->
    <div class="flex-1 min-h-0 overflow-hidden">
      <div
        v-if="status === 'pending' && !trigger"
        class="h-full flex items-center justify-center"
      >
        <div class="text-center">
          <UIcon
            name="i-lucide-loader-2"
            class="w-8 h-8 animate-spin mx-auto mb-2 text-gray-400"
          />
          <p class="text-sm text-gray-500 dark:text-gray-400">
            Loading trigger...
          </p>
        </div>
      </div>

      <div
        v-else-if="!trigger"
        class="h-full flex items-center justify-center"
      >
        <div class="text-center">
          <UIcon
            name="i-lucide-alert-circle"
            class="w-8 h-8 mx-auto mb-2 text-gray-300 dark:text-gray-700"
          />
          <p class="text-sm text-gray-500 dark:text-gray-400">
            Trigger not found
          </p>
        </div>
      </div>

      <div
        v-else
        class="h-full flex gap-px bg-gray-200 dark:bg-gray-800"
      >
        <!-- Left: Overview & Config -->
        <div class="w-1/2 min-w-0 bg-white dark:bg-gray-950 flex flex-col min-h-0 overflow-hidden">
          <div class="px-4 py-3 border-b border-gray-200 dark:border-gray-800 shrink-0">
            <h2 class="text-sm font-medium text-gray-900 dark:text-gray-100">
              Overview
            </h2>
          </div>
          <div class="flex-1 min-h-0 overflow-y-auto p-6 space-y-6">
            <!-- Description -->
            <div
              v-if="trigger.description"
              class="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg p-4"
            >
              <div class="flex items-start gap-2">
                <UIcon
                  name="i-lucide-info"
                  class="w-4 h-4 text-blue-600 dark:text-blue-400 mt-0.5 shrink-0"
                />
                <p class="text-sm text-blue-900 dark:text-blue-100">
                  {{ trigger.description }}
                </p>
              </div>
            </div>

            <!-- Stats Cards -->
            <div class="grid grid-cols-2 gap-4">
              <div class="bg-gray-50 dark:bg-gray-900/50 rounded-lg p-4">
                <div class="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase mb-1">
                  Total Fires
                </div>
                <div class="text-2xl font-semibold text-gray-900 dark:text-gray-100">
                  {{ formatNumber(trigger.stats.totalFires) }}
                </div>
              </div>
              <div class="bg-gray-50 dark:bg-gray-900/50 rounded-lg p-4">
                <div class="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase mb-1">
                  Success Rate
                </div>
                <div
                  class="text-2xl font-semibold"
                  :class="(trigger.stats.successRate || 100) >= 95 ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'"
                >
                  {{ trigger.stats.successRate?.toFixed(1) || '100' }}%
                </div>
              </div>
              <div class="bg-gray-50 dark:bg-gray-900/50 rounded-lg p-4">
                <div class="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase mb-1">
                  Last 24h
                </div>
                <div class="text-2xl font-semibold text-blue-600 dark:text-blue-400">
                  {{ formatNumber(trigger.stats.last24h) }}
                </div>
              </div>
              <div class="bg-gray-50 dark:bg-gray-900/50 rounded-lg p-4">
                <div class="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase mb-1">
                  Subscribers
                </div>
                <div class="text-2xl font-semibold text-purple-600 dark:text-purple-400">
                  {{ trigger.subscriptionCount }}
                </div>
              </div>
            </div>

            <!-- Configuration -->
            <div>
              <h3 class="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-3">
                Configuration
              </h3>
              <div class="space-y-2 text-sm">
                <div class="flex items-center justify-between py-2 border-b border-gray-100 dark:border-gray-800">
                  <span class="text-gray-500 dark:text-gray-400">Name</span>
                  <span class="font-mono text-gray-900 dark:text-gray-100">{{ trigger.name }}</span>
                </div>
                <div class="flex items-center justify-between py-2 border-b border-gray-100 dark:border-gray-800">
                  <span class="text-gray-500 dark:text-gray-400">Type</span>
                  <span class="text-gray-900 dark:text-gray-100">{{ trigger.type }}</span>
                </div>
                <div class="flex items-center justify-between py-2 border-b border-gray-100 dark:border-gray-800">
                  <span class="text-gray-500 dark:text-gray-400">Scope</span>
                  <span class="text-gray-900 dark:text-gray-100">{{ trigger.scope }}</span>
                </div>
                <div
                  v-if="trigger.source"
                  class="flex items-center justify-between py-2 border-b border-gray-100 dark:border-gray-800"
                >
                  <span class="text-gray-500 dark:text-gray-400">Source</span>
                  <span class="text-gray-900 dark:text-gray-100">{{ trigger.source }}</span>
                </div>
                <div
                  v-if="trigger.registeredAt"
                  class="flex items-center justify-between py-2 border-b border-gray-100 dark:border-gray-800"
                >
                  <span class="text-gray-500 dark:text-gray-400">Registered</span>
                  <span class="text-gray-900 dark:text-gray-100">{{ formatDate(trigger.registeredAt) }}</span>
                </div>
                <div
                  v-if="(trigger.stats as any).lastFiredAt"
                  class="flex items-center justify-between py-2 border-b border-gray-100 dark:border-gray-800"
                >
                  <span class="text-gray-500 dark:text-gray-400">Last Fired</span>
                  <span class="text-gray-900 dark:text-gray-100">{{ formatTime((trigger.stats as any).lastFiredAt) }}</span>
                </div>
                <div
                  v-if="trigger.lastActivityAt"
                  class="flex items-center justify-between py-2 border-b border-gray-100 dark:border-gray-800"
                >
                  <span class="text-gray-500 dark:text-gray-400">Last Modified</span>
                  <span class="text-gray-900 dark:text-gray-100">{{ formatTime(trigger.lastActivityAt) }}</span>
                </div>
              </div>
            </div>

            <!-- Webhook Config -->
            <div v-if="trigger.webhook">
              <h3 class="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-3">
                Webhook Configuration
              </h3>
              <div class="space-y-2 text-sm">
                <div class="flex items-center justify-between py-2 border-b border-gray-100 dark:border-gray-800">
                  <span class="text-gray-500 dark:text-gray-400">Path</span>
                  <span class="font-mono text-gray-900 dark:text-gray-100">{{ trigger.webhook.path }}</span>
                </div>
                <div
                  v-if="trigger.webhook.method"
                  class="flex items-center justify-between py-2 border-b border-gray-100 dark:border-gray-800"
                >
                  <span class="text-gray-500 dark:text-gray-400">Method</span>
                  <UBadge
                    :label="trigger.webhook.method"
                    color="neutral"
                    variant="subtle"
                    size="xs"
                  />
                </div>
              </div>
            </div>

            <!-- Schedule Config -->
            <div v-if="trigger.schedule">
              <h3 class="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-3">
                Schedule Configuration
              </h3>
              <div class="space-y-2 text-sm">
                <div class="flex items-center justify-between py-2 border-b border-gray-100 dark:border-gray-800">
                  <span class="text-gray-500 dark:text-gray-400">Cron</span>
                  <span class="font-mono text-gray-900 dark:text-gray-100">{{ trigger.schedule.cron }}</span>
                </div>
                <div
                  v-if="trigger.schedule.timezone"
                  class="flex items-center justify-between py-2 border-b border-gray-100 dark:border-gray-800"
                >
                  <span class="text-gray-500 dark:text-gray-400">Timezone</span>
                  <span class="text-gray-900 dark:text-gray-100">{{ trigger.schedule.timezone }}</span>
                </div>
                <div class="flex items-center justify-between py-2 border-b border-gray-100 dark:border-gray-800">
                  <span class="text-gray-500 dark:text-gray-400">Enabled</span>
                  <UBadge
                    :label="trigger.schedule.enabled ? 'Yes' : 'No'"
                    :color="trigger.schedule.enabled ? 'success' : 'neutral'"
                    variant="subtle"
                    size="xs"
                  />
                </div>
              </div>
            </div>

            <!-- Subscribed Flows -->
            <div>
              <h3 class="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-3">
                Subscribed Flows ({{ trigger.subscriptionCount }})
              </h3>
              <div
                v-if="trigger.subscriptions.length === 0"
                class="text-sm text-gray-500 dark:text-gray-400 text-center py-4"
              >
                No subscriptions
              </div>
              <div
                v-else
                class="space-y-2"
              >
                <div
                  v-for="sub in trigger.subscriptions"
                  :key="`${sub.flowName}-${sub.triggerName}`"
                  class="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-900/50 rounded-lg"
                >
                  <div class="flex items-center gap-2 min-w-0">
                    <UIcon
                      name="i-lucide-git-branch"
                      class="w-4 h-4 text-blue-500 shrink-0"
                    />
                    <span class="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{{ sub.flowName }}</span>
                  </div>
                  <div class="flex items-center gap-2">
                    <UBadge
                      :label="sub.mode"
                      :color="sub.mode === 'auto' ? 'success' : 'neutral'"
                      variant="subtle"
                      size="xs"
                    />
                    <UButton
                      icon="i-lucide-arrow-right"
                      size="xs"
                      color="neutral"
                      variant="ghost"
                      square
                      @click="goToFlow(sub.flowName)"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Right: Events -->
        <div class="w-1/2 min-w-0 bg-white dark:bg-gray-950 flex flex-col min-h-0 overflow-hidden">
          <div class="px-4 py-3 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between shrink-0">
            <h2 class="text-sm font-medium text-gray-900 dark:text-gray-100">
              Recent Events
            </h2>
            <div class="flex items-center gap-2">
              <USelectMenu
                v-model="eventTypeFilter"
                :items="eventTypeFilterOptions"
                placeholder="All Events"
                size="xs"
              />
              <UButton
                icon="i-lucide-refresh-cw"
                size="xs"
                color="neutral"
                variant="ghost"
                square
                :loading="eventsStatus === 'pending'"
                @click="refreshEvents"
              />
            </div>
          </div>
          <div class="flex-1 min-h-0 overflow-y-auto">
            <div
              v-if="eventsStatus === 'pending' && !events"
              class="h-full flex items-center justify-center"
            >
              <div class="text-center">
                <UIcon
                  name="i-lucide-loader-2"
                  class="w-6 h-6 animate-spin mx-auto mb-2 text-gray-400"
                />
                <p class="text-xs text-gray-500 dark:text-gray-400">
                  Loading events...
                </p>
              </div>
            </div>
            <div
              v-else-if="!events || events.events.length === 0"
              class="h-full flex items-center justify-center"
            >
              <div class="text-center">
                <UIcon
                  name="i-lucide-inbox"
                  class="w-8 h-8 mx-auto mb-2 text-gray-300 dark:text-gray-700"
                />
                <p class="text-sm text-gray-500 dark:text-gray-400">
                  No events yet
                </p>
              </div>
            </div>
            <div
              v-else
              class="divide-y divide-gray-100 dark:divide-gray-800"
            >
              <div
                v-for="(event, idx) in events.events"
                :key="idx"
                class="px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-900/50 transition-colors cursor-pointer"
                @click="selectEvent(event)"
              >
                <div class="flex items-start justify-between gap-3 mb-2">
                  <div class="flex items-center gap-2 min-w-0">
                    <UIcon
                      :name="getEventIcon(event.type)"
                      class="w-4 h-4 shrink-0"
                      :class="getEventIconColor(event.type)"
                    />
                    <span class="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{{ event.type }}</span>
                  </div>
                  <span class="text-xs text-gray-500 dark:text-gray-400 shrink-0">
                    {{ formatTime(event.ts || event.timestamp) }}
                  </span>
                </div>
                <div
                  v-if="event.data"
                  class="text-xs font-mono text-gray-600 dark:text-gray-400 line-clamp-2 ml-6"
                >
                  {{ JSON.stringify(event.data).substring(0, 100) }}...
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Event Detail Modal -->
    <UModal
      v-model:open="eventModalOpen"
      :title="selectedEvent?.type || 'Event Details'"
    >
      <template #header>
        <div>
          <h3 class="text-lg font-semibold flex items-center gap-2">
            <UIcon
              v-if="selectedEvent"
              :name="getEventIcon(selectedEvent.type)"
              class="w-5 h-5"
              :class="getEventIconColor(selectedEvent.type)"
            />
            <span>{{ selectedEvent?.type }}</span>
          </h3>
          <p
            v-if="selectedEvent"
            class="text-sm text-gray-500 mt-1"
          >
            {{ formatDate(selectedEvent.ts || selectedEvent.timestamp) }}
          </p>
        </div>
      </template>
      <template #body>
        <div
          v-if="selectedEvent"
          class="space-y-4"
        >
          <div>
            <label class="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 block">
              Event Data
            </label>
            <pre class="text-xs font-mono bg-gray-50 dark:bg-gray-900 rounded-lg p-4 overflow-x-auto">{{ JSON.stringify(selectedEvent.data, null, 2) }}</pre>
          </div>
          <div>
            <label class="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 block">
              Raw Event
            </label>
            <pre class="text-xs font-mono bg-gray-50 dark:bg-gray-900 rounded-lg p-4 overflow-x-auto">{{ JSON.stringify(selectedEvent, null, 2) }}</pre>
          </div>
        </div>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2">
          <UButton
            color="neutral"
            variant="ghost"
            @click="eventModalOpen = false"
          >
            Close
          </UButton>
        </div>
      </template>
    </UModal>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from '#imports'
import { UButton, UIcon, UBadge, UModal, USelectMenu } from '#components'
import { useTrigger, useTriggerEvents, type TriggerEvent } from '../../composables/useTrigger'
import { useComponentRouter } from '../../composables/useComponentRouter'
import { useTriggerWebSocket } from '../../composables/useTriggerWebSocket'

const router = useComponentRouter()
const route = computed(() => {
  const path = router.route.value?.path || ''
  const match = path.match(/\/triggers\/([^/]+)/)
  return match && match[1] ? decodeURIComponent(match[1]) : null
})

const triggerName = computed(() => route.value)

// Fetch trigger data
const { trigger, status, refresh: refreshTrigger } = useTrigger(triggerName)

// Fetch events
const eventTypeFilter = ref('all')
const eventTypeFilterOptions = ['all', 'trigger.fired', 'trigger.registered', 'trigger.updated']

const eventTypes = computed(() => {
  return eventTypeFilter.value === 'all' ? undefined : [eventTypeFilter.value]
})

const { events: fetchedEvents, refresh: refreshEvents, status: eventsStatus } = useTriggerEvents(triggerName, {
  limit: 100,
  types: eventTypes.value,
})

// WebSocket for live updates
const { isConnected, isReconnecting, events: liveEvents } = useTriggerWebSocket(triggerName)

// Auto-refresh trigger metadata every 5 seconds using useFetch's refresh
onMounted(() => {
  const refreshInterval = setInterval(() => {
    refreshTrigger()
  }, 5000)

  onUnmounted(() => {
    clearInterval(refreshInterval)
  })
})

// Merge live and fetched events
const events = computed(() => {
  if (!fetchedEvents.value) return null
  
  // Combine live events with fetched events, removing duplicates by id or timestamp
  const allEvents = [...liveEvents.value, ...(fetchedEvents.value.events || [])]
  const seen = new Set()
  const unique = allEvents.filter((event: any) => {
    // Use id if available (from store), otherwise use ts+type
    const key = event.id || `${event.type}-${event.ts || event.timestamp}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  
  // Sort by ts/timestamp descending (most recent first)
  unique.sort((a: any, b: any) => {
    const aTime = a.ts || a.timestamp || 0
    const bTime = b.ts || b.timestamp || 0
    return bTime - aTime
  })
  
  return {
    ...fetchedEvents.value,
    events: unique,
  }
})

// Watch filter changes
watch(eventTypeFilter, () => {
  refreshEvents()
})

// Event modal
const eventModalOpen = ref(false)
const selectedEvent = ref<TriggerEvent | null>(null)

const selectEvent = (event: TriggerEvent) => {
  selectedEvent.value = event
  eventModalOpen.value = true
}

const goBack = () => {
  router.push('/triggers')
}

const goToEdit = () => {
  if (triggerName.value) {
    router.push(`/triggers/${encodeURIComponent(triggerName.value)}/edit`)
  }
}

const goToFlow = (flowName: string) => {
  router.push(`/flows?flow=${encodeURIComponent(flowName)}`)
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

const getEventIcon = (type: string) => {
  if (type.includes('fired')) return 'i-lucide-zap'
  if (type.includes('registered')) return 'i-lucide-plus-circle'
  if (type.includes('updated')) return 'i-lucide-pencil'
  if (type.includes('subscription')) return 'i-lucide-link'
  return 'i-lucide-circle-dot'
}

const getEventIconColor = (type: string) => {
  if (type.includes('fired')) return 'text-emerald-500'
  if (type.includes('registered')) return 'text-blue-500'
  if (type.includes('updated')) return 'text-amber-500'
  if (type.includes('subscription')) return 'text-purple-500'
  return 'text-gray-500'
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

const formatDate = (timestamp: number) => {
  return new Date(timestamp).toLocaleString()
}

const formatNumber = (num: number | undefined) => {
  if (num == null) return '0'
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`
  if (num >= 1000) return `${(num / 1000).toFixed(1)}K`
  return num.toString()
}
</script>
