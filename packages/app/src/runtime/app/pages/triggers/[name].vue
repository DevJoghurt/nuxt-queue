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
            size="sm"
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
        <!-- Left: Events List -->
        <div class="w-1/3 min-w-0 flex-shrink-0 bg-white dark:bg-gray-950 flex flex-col min-h-0 overflow-hidden">
          <div class="px-4 py-3 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between shrink-0">
            <h2 class="text-sm font-medium text-gray-900 dark:text-gray-100">
              Events
            </h2>
            <div class="flex items-center gap-2">
              <USelectMenu
                v-model="eventTypeFilter"
                :items="eventTypeFilterOptions"
                value-key="value"
                placeholder="All Events"
                size="xs"
                class="w-40"
              >
                <template #label>
                  <div class="flex items-center gap-2">
                    <UIcon
                      :name="getFilterIcon(eventTypeFilter)"
                      class="w-4 h-4"
                      :class="getFilterIconColor(eventTypeFilter)"
                    />
                    <span class="text-xs">{{ getFilterLabel(eventTypeFilter) }}</span>
                  </div>
                </template>
                <template #option="{ option }">
                  <div class="flex items-center gap-2">
                    <UIcon
                      :name="getFilterIcon(option.value)"
                      class="w-4 h-4"
                      :class="getFilterIconColor(option.value)"
                    />
                    <span>{{ option.label }}</span>
                  </div>
                </template>
              </USelectMenu>
            </div>
          </div>
          
          <div
            v-if="eventsStatus === 'pending' && !events"
            class="flex-1 flex items-center justify-center"
          >
            <div class="text-center">
              <UIcon
                name="i-lucide-loader-2"
                class="w-8 h-8 animate-spin mx-auto mb-2 text-gray-400"
              />
              <p class="text-sm text-gray-500 dark:text-gray-400">
                Loading events...
              </p>
            </div>
          </div>

          <div
            v-else-if="!events || events.events.length === 0"
            class="flex-1 flex items-center justify-center"
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
            class="flex-1 min-h-0 overflow-y-auto"
          >
            <div class="divide-y divide-gray-100 dark:divide-gray-800">
              <div
                v-for="(event, idx) in paginatedEvents"
                :key="idx"
                class="px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-900/50 cursor-pointer transition-colors"
                :class="{
                  'bg-blue-50 dark:bg-blue-950/30 border-l-2 border-l-blue-500': selectedEvent && selectedEvent.type === event.type && (selectedEvent.ts || selectedEvent.timestamp) === (event.ts || event.timestamp)
                }"
                @click="selectEvent(event)"
              >
                <div class="flex items-start gap-3">
                  <div class="flex-shrink-0 mt-0.5">
                    <UIcon
                      :name="getEventIcon(event.type)"
                      class="w-5 h-5"
                      :class="getEventIconColor(event.type)"
                    />
                  </div>
                  <div class="flex-1 min-w-0">
                    <div class="flex items-center justify-between gap-2 mb-1">
                      <h3 class="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                        {{ event.type }}
                      </h3>
                      <UBadge
                        :label="event.type.split('.')[1] || 'event'"
                        :color="getEventBadgeColor(event.type)"
                        variant="subtle"
                        size="xs"
                        class="capitalize flex-shrink-0"
                      />
                    </div>
                    <p class="text-xs text-gray-500 dark:text-gray-400 font-mono truncate mb-1">
                      {{ formatDate(event.ts || event.timestamp) }}
                    </p>
                    <div class="flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400">
                      <span>
                        {{ formatTime(event.ts || event.timestamp) }}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Pagination Footer -->
          <div
            v-if="events && (events.total || events.count) > eventsPerPage"
            class="border-t border-gray-200 dark:border-gray-800 px-4 py-3 flex items-center justify-center shrink-0"
          >
            <UPagination
              v-model:page="currentPage"
              :items-per-page="eventsPerPage"
              :total="events.total || events.count"
              size="xs"
            />
          </div>
        </div>

        <!-- Right: Overview or Event Details -->
        <div class="flex-1 min-w-0 bg-white dark:bg-gray-950 flex flex-col min-h-0 overflow-hidden">
          <div class="px-4 py-2.5 border-b border-gray-200 dark:border-gray-800 shrink-0">
            <div class="flex items-center justify-between">
              <UTabs
                v-model="activeTab"
                :items="tabItems"
                size="xs"
                :ui="{
                  root: 'gap-0',
                  trigger: 'px-2 py-0.5',
                }"
              />
            </div>
          </div>

          <div class="flex-1 min-h-0 overflow-y-auto">
            <!-- Overview Tab -->
            <div
              v-if="activeTab === 'overview'"
              class="p-6 space-y-6"
            >

            <!-- Stats Cards -->
            <div>
              <h3 class="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-4">
                Trigger Statistics
              </h3>
              <div class="grid grid-cols-2 gap-4">
                <StatCard
                  icon="i-lucide-zap"
                  :count="trigger.stats.totalFires"
                  label="Total Fires"
                  variant="gray"
                />
                <StatCard
                  icon="i-lucide-target"
                  :count="trigger.stats.last24h"
                  label="Last 24h"
                  variant="blue"
                />
                <StatCard
                  icon="i-lucide-check-circle-2"
                  :count="`${trigger.stats.successRate?.toFixed(1) || '100'}%`"
                  label="Success Rate"
                  :variant="(trigger.stats.successRate || 100) >= 95 ? 'emerald' : 'amber'"
                />
                <StatCard
                  icon="i-lucide-git-branch"
                  :count="trigger.subscriptionCount"
                  label="Subscribers"
                  variant="purple"
                />
              </div>
            </div>

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

            <!-- Configuration -->
            <div>
              <h3 class="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-4">
                Configuration
              </h3>
              <div class="bg-gray-50 dark:bg-gray-900/50 rounded-lg p-4 space-y-3">
                <div class="flex items-center justify-between py-2 border-b border-gray-200 dark:border-gray-800">
                  <span class="text-sm text-gray-600 dark:text-gray-400">Name</span>
                  <span class="text-sm font-medium font-mono text-gray-900 dark:text-gray-100">{{ trigger.name }}</span>
                </div>
                <div class="flex items-center justify-between py-2 border-b border-gray-200 dark:border-gray-800">
                  <span class="text-sm text-gray-600 dark:text-gray-400">Type</span>
                  <UBadge
                    :label="trigger.type"
                    :color="getTriggerTypeColor(trigger.type)"
                    variant="subtle"
                    size="xs"
                  />
                </div>
                <div class="flex items-center justify-between py-2 border-b border-gray-200 dark:border-gray-800">
                  <span class="text-sm text-gray-600 dark:text-gray-400">Scope</span>
                  <span class="text-sm font-medium text-gray-900 dark:text-gray-100">{{ trigger.scope }}</span>
                </div>
                <div
                  v-if="trigger.source"
                  class="flex items-center justify-between py-2 border-b border-gray-200 dark:border-gray-800"
                >
                  <span class="text-sm text-gray-600 dark:text-gray-400">Source</span>
                  <span class="text-sm font-medium text-gray-900 dark:text-gray-100">{{ trigger.source }}</span>
                </div>
                <div
                  v-if="trigger.registeredAt"
                  class="flex items-center justify-between py-2 border-b border-gray-200 dark:border-gray-800"
                >
                  <span class="text-sm text-gray-600 dark:text-gray-400">Registered</span>
                  <span class="text-sm font-medium text-gray-900 dark:text-gray-100">{{ formatDate(trigger.registeredAt) }}</span>
                </div>
                <div
                  v-if="(trigger.stats as any).lastFiredAt"
                  class="flex items-center justify-between py-2 border-b border-gray-200 dark:border-gray-800"
                >
                  <span class="text-sm text-gray-600 dark:text-gray-400">Last Fired</span>
                  <span class="text-sm font-medium text-gray-900 dark:text-gray-100">{{ formatTime((trigger.stats as any).lastFiredAt) }}</span>
                </div>
                <div
                  v-if="trigger.lastActivityAt"
                  class="flex items-center justify-between py-2"
                >
                  <span class="text-sm text-gray-600 dark:text-gray-400">Last Modified</span>
                  <span class="text-sm font-medium text-gray-900 dark:text-gray-100">{{ formatTime(trigger.lastActivityAt) }}</span>
                </div>
              </div>
            </div>

            <!-- Webhook Config -->
            <div v-if="trigger.webhook">
              <h3 class="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-3">
                Webhook Configuration
              </h3>
              <div class="space-y-3">
                <div class="bg-gray-50 dark:bg-gray-900/50 rounded-lg p-3">
                  <div class="flex items-center justify-between mb-2">
                    <span class="text-xs text-gray-500 dark:text-gray-400">Webhook URL</span>
                    <UButton
                      v-if="trigger.webhook.fullUrl"
                      icon="i-lucide-copy"
                      size="xs"
                      color="neutral"
                      variant="ghost"
                      @click="copyToClipboard(trigger.webhook.fullUrl)"
                    />
                  </div>
                  <code class="text-xs font-mono text-blue-600 dark:text-blue-400 break-all">
                    {{ trigger.webhook.fullUrl || trigger.webhook.path }}
                  </code>
                </div>
                <div class="flex items-center justify-between py-2 border-b border-gray-100 dark:border-gray-800">
                  <span class="text-sm text-gray-500 dark:text-gray-400">Method</span>
                  <UBadge
                    :label="trigger.webhook.method || 'POST'"
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
              <h3 class="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-4">
                Subscribed Flows ({{ trigger.subscriptionCount }})
              </h3>
              <div
                v-if="trigger.subscriptions.length === 0"
                class="text-center py-8"
              >
                <UIcon
                  name="i-lucide-git-branch-plus"
                  class="w-8 h-8 mx-auto mb-2 text-gray-300 dark:text-gray-700"
                />
                <p class="text-sm text-gray-500 dark:text-gray-400">
                  No subscriptions
                </p>
              </div>
              <div
                v-else
                class="space-y-2"
              >
                <div
                  v-for="sub in trigger.subscriptions"
                  :key="`${sub.flowName}-${sub.triggerName}`"
                  class="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-900/50 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-900 transition-colors cursor-pointer"
                  @click="goToFlow(sub.flowName)"
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
                    <UIcon
                      name="i-lucide-arrow-right"
                      class="w-4 h-4 text-gray-400"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>

            <!-- Event Details Tab -->
            <div
              v-else-if="activeTab === 'details' && selectedEvent"
              class="p-6 space-y-6"
            >
              <!-- Event Info -->
              <div>
                <h3 class="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-4 flex items-center gap-2">
                  <UIcon
                    :name="getEventIcon(selectedEvent.type)"
                    class="w-5 h-5"
                    :class="getEventIconColor(selectedEvent.type)"
                  />
                  <span>Event Information</span>
                </h3>
                <div class="bg-gray-50 dark:bg-gray-900/50 rounded-lg p-4 space-y-3">
                  <div class="flex items-center justify-between py-2 border-b border-gray-200 dark:border-gray-800">
                    <span class="text-sm text-gray-600 dark:text-gray-400">Type</span>
                    <UBadge
                      :label="selectedEvent.type"
                      :color="getEventBadgeColor(selectedEvent.type)"
                      variant="subtle"
                      size="xs"
                    />
                  </div>
                  <div class="flex items-center justify-between py-2">
                    <span class="text-sm text-gray-600 dark:text-gray-400">Timestamp</span>
                    <span class="text-sm font-medium text-gray-900 dark:text-gray-100">{{ formatDate(selectedEvent.ts || selectedEvent.timestamp) }}</span>
                  </div>
                </div>
              </div>

              <!-- Event Data -->
              <div>
                <h3 class="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-4">
                  Event Data
                </h3>
                <div class="bg-gray-50 dark:bg-gray-900 rounded-lg p-4 overflow-x-auto">
                  <pre class="text-xs font-mono">{{ JSON.stringify(selectedEvent.data, null, 2) }}</pre>
                </div>
              </div>

              <!-- Raw Event -->
              <div>
                <h3 class="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-4">
                  Raw Event
                </h3>
                <div class="bg-gray-50 dark:bg-gray-900 rounded-lg p-4 overflow-x-auto">
                  <pre class="text-xs font-mono">{{ JSON.stringify(selectedEvent, null, 2) }}</pre>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from '#imports'
import { UButton, UIcon, UBadge, USelectMenu, UTabs } from '#components'
import { useTrigger, useTriggerEvents, type TriggerEvent } from '../../composables/useTrigger'
import { useComponentRouter } from '../../composables/useComponentRouter'
import { useTriggerWebSocket } from '../../composables/useTriggerWebSocket'
import { useRoute, useRouter } from '#app'
import StatCard from '../../components/StatCard.vue'

const componentRouter = useComponentRouter()
const router = useRouter()
const route = useRoute()

const triggerName = computed(() => {
  const path = componentRouter.route.value?.path || ''
  const match = path.match(/\/triggers\/([^/]+)/)
  return match && match[1] ? decodeURIComponent(match[1]) : null
})

// Fetch trigger data
const { trigger, status, refresh: refreshTrigger } = useTrigger(triggerName)

// Fetch events with URL-based filters
const eventTypeFilter = computed({
  get: () => (route.query.type as string) || 'all',
  set: (value: string) => {
    router.push({
      query: {
        ...route.query,
        type: value === 'all' ? undefined : value,
        page: undefined, // Reset page when filter changes
      },
    })
  },
})

const currentPage = computed({
  get: () => {
    const page = route.query.page as string
    return page ? parseInt(page, 10) : 1
  },
  set: (value: number) => {
    router.push({
      query: {
        ...route.query,
        page: value > 1 ? value.toString() : undefined,
      },
    })
  },
})

const eventTypeFilterOptions = [
  { label: 'All Events', value: 'all' },
  { label: 'Fired', value: 'trigger.fired' },
  { label: 'Registered', value: 'trigger.registered' },
  { label: 'Updated', value: 'trigger.updated' },
]

const eventsPerPage = 20

// Build query options for server-side filtering
const eventQueryOptions = computed(() => {
  const options: any = {
    limit: eventsPerPage,
    offset: (currentPage.value - 1) * eventsPerPage,
  }
  
  if (eventTypeFilter.value !== 'all') {
    options.types = [eventTypeFilter.value]
  }
  
  return options
})

const { events: fetchedEvents, refresh: refreshEvents, status: eventsStatus } = useTriggerEvents(triggerName, eventQueryOptions)

// WebSocket for live updates
const liveEvents = ref<TriggerEvent[]>([])
const { connected: isConnected, reconnecting: isReconnecting, subscribe, unsubscribe } = useTriggerWebSocket()

// Subscribe to trigger events when triggerName changes (client-side only)
watch([triggerName], () => {
  // Skip on server
  if (import.meta.server) return
  
  if (!triggerName.value) {
    unsubscribe()
    liveEvents.value = []
    return
  }

  subscribe({
    triggerName: triggerName.value,
    onEvent: (event: any) => {
      // Add new event to the beginning of the array
      liveEvents.value = [event, ...liveEvents.value].slice(0, 50) // Keep last 50 live events
    },
    onHistory: (events: any[]) => {
      // Replace live events with history (on reconnect or initial load)
      liveEvents.value = events.slice(0, 50)
    },
  })
}, { immediate: true })

// Auto-refresh trigger metadata every 5 seconds using useFetch's refresh
onMounted(() => {
  const refreshInterval = setInterval(() => {
    refreshTrigger()
  }, 5000)

  onUnmounted(() => {
    clearInterval(refreshInterval)
    unsubscribe()
  })
})

// Use fetched events directly (already paginated by server)
const events = computed(() => {
  return fetchedEvents.value
})

// Display paginated events from server
const paginatedEvents = computed(() => {
  if (!events.value) return []
  
  // Only merge live events if we're on page 1
  if (currentPage.value === 1) {
    // For live events, only show those that match current filter
    const filteredLiveEvents = liveEvents.value.filter((event: any) => {
      if (eventTypeFilter.value === 'all') return true
      return event.type === eventTypeFilter.value
    })
    
    // Combine with fetched events, removing duplicates by id or timestamp
    const allEvents = [...filteredLiveEvents, ...(events.value.events || [])]
    const seen = new Set()
    const unique = allEvents.filter((event: any) => {
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
    
    // Only return up to eventsPerPage items
    return unique.slice(0, eventsPerPage)
  }
  
  // For other pages, just return the fetched events
  return events.value.events || []
})

// Watch query changes to refresh data
watch(() => eventQueryOptions.value, () => {
  refreshEvents()
}, { deep: true })

// Tabs
const activeTab = ref<'overview' | 'details'>('overview')
const tabItems = computed(() => [
  { label: 'Overview', value: 'overview', icon: 'i-lucide-bar-chart-3' },
  {
    label: 'Event Details',
    value: 'details',
    icon: 'i-lucide-file-text',
    disabled: !selectedEvent.value,
  },
])

// Selected event
const selectedEvent = ref<TriggerEvent | null>(null)

const selectEvent = (event: TriggerEvent) => {
  selectedEvent.value = event
  activeTab.value = 'details'
}

// Watch for event selection
watch(selectedEvent, (newEvent) => {
  if (newEvent) {
    activeTab.value = 'details'
  }
  else {
    activeTab.value = 'overview'
  }
})

const goBack = () => {
  componentRouter.push('/triggers')
}

const goToEdit = () => {
  if (triggerName.value) {
    componentRouter.push(`/triggers/${encodeURIComponent(triggerName.value)}/edit`)
  }
}

const goToFlow = (flowName: string) => {
  componentRouter.push(`/flows?flow=${encodeURIComponent(flowName)}`)
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

const getEventBadgeColor = (type: string): 'success' | 'primary' | 'warning' | 'secondary' | 'neutral' => {
  if (type.includes('fired')) return 'success'
  if (type.includes('registered')) return 'primary'
  if (type.includes('updated')) return 'warning'
  if (type.includes('subscription')) return 'secondary'
  return 'neutral'
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

const getFilterIcon = (value: string) => {
  switch (value) {
    case 'trigger.fired': return 'i-lucide-zap'
    case 'trigger.registered': return 'i-lucide-plus-circle'
    case 'trigger.updated': return 'i-lucide-pencil'
    default: return 'i-lucide-filter'
  }
}

const getFilterIconColor = (value: string) => {
  switch (value) {
    case 'trigger.fired': return 'text-emerald-500'
    case 'trigger.registered': return 'text-blue-500'
    case 'trigger.updated': return 'text-amber-500'
    default: return 'text-gray-500'
  }
}

const getFilterLabel = (value: string) => {
  const option = eventTypeFilterOptions.find(o => o.value === value)
  return option?.label || 'All Events'
}

const copyToClipboard = async (text: string) => {
  try {
    await navigator.clipboard.writeText(text)
    // You could add a toast notification here if you have one
  }
  catch (err) {
    console.error('Failed to copy:', err)
  }
}
</script>
