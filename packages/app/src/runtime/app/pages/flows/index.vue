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
      </div>
    </div>

    <!-- Main Content -->
    <div class="flex-1 min-h-0 overflow-y-auto">
      <div class="max-w-7xl mx-auto p-6">
        <!-- Stats Overview -->
        <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <StatCard
            icon="i-lucide-git-branch"
            :count="flows?.length || 0"
            label="Total Flows"
            variant="gray"
          />
          <StatCard
            icon="i-lucide-layers"
            :count="totalSteps"
            label="Total Steps"
            variant="blue"
          />
          <StatCard
            icon="i-lucide-pause"
            :count="flowsWithAwait"
            label="With Await"
            variant="purple"
          />
          <StatCard
            icon="i-lucide-bar-chart-3"
            :count="maxLevels"
            label="Max Levels"
            variant="emerald"
          />
        </div>

        <!-- Filters -->
        <div class="mb-4 flex items-center gap-3">
          <div class="flex-1">
            <UInput
              v-model="searchQuery"
              icon="i-lucide-search"
              placeholder="Search flows..."
              size="sm"
            />
          </div>
          <USelectMenu
            v-model="awaitFilter"
            :items="awaitFilterOptions"
            value-key="value"
            placeholder="All Flows"
            size="sm"
            class="w-40"
          >
            <template #label>
              <span v-if="awaitFilter === 'all'">All Flows</span>
              <div
                v-else
                class="flex items-center gap-2"
              >
                <UIcon
                  :name="awaitFilter === 'with-await' ? 'i-lucide-pause' : 'i-lucide-play'"
                  class="w-4 h-4"
                />
                <span>{{ awaitFilter === 'with-await' ? 'With Await' : 'No Await' }}</span>
              </div>
            </template>
          </USelectMenu>
        </div>

        <!-- Flows List -->
        <div
          v-if="!filteredFlows || filteredFlows.length === 0"
          class="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 p-8 text-center text-gray-500"
        >
          <div v-if="searchQuery || awaitFilter !== 'all'">
            <UIcon
              name="i-lucide-search-x"
              class="w-12 h-12 animate-spin mx-auto mb-3 opacity-50"
            />
            <p>No flows match your filters</p>
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
                      <span>{{ flow.steps.length }} step{{ flow.steps.length === 1 ? '' : 's' }}</span>
                    </div>
                    <div class="flex items-center gap-1">
                      <UIcon
                        name="i-lucide-bar-chart-3"
                        class="w-3 h-3"
                      />
                      <span>{{ flow.levels }} level{{ flow.levels === 1 ? '' : 's' }}</span>
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
import { ref, computed } from '#imports'
import { UButton, UIcon, UBadge, UInput, USelectMenu } from '#components'
import { useAnalyzedFlows } from '../../composables/useAnalyzedFlows'
import { useComponentRouter } from '../../composables/useComponentRouter'
import StatCard from '../../components/StatCard.vue'

const flows = useAnalyzedFlows()
const router = useComponentRouter()

// Filters
const searchQuery = ref('')
const awaitFilter = ref('all')

const awaitFilterOptions = [
  { label: 'All Flows', value: 'all' },
  { label: 'With Await', value: 'with-await', icon: 'i-lucide-pause' },
  { label: 'No Await', value: 'no-await', icon: 'i-lucide-play' },
]

const filteredFlows = computed(() => {
  if (!flows.value)
    return []

  let filtered = flows.value

  // Filter by search query
  if (searchQuery.value) {
    const query = searchQuery.value.toLowerCase()
    filtered = filtered.filter(flow =>
      flow.id.toLowerCase().includes(query),
    )
  }

  // Filter by await
  if (awaitFilter.value === 'with-await') {
    filtered = filtered.filter(flow => flow.hasAwait)
  }
  else if (awaitFilter.value === 'no-await') {
    filtered = filtered.filter(flow => !flow.hasAwait)
  }

  return filtered
})

const totalSteps = computed(() => {
  if (!flows.value)
    return 0
  return flows.value.reduce((acc, flow) => acc + flow.steps.length, 0)
})

const flowsWithAwait = computed(() => {
  if (!flows.value)
    return 0
  return flows.value.filter(flow => flow.hasAwait).length
})

const maxLevels = computed(() => {
  if (!flows.value)
    return 0
  return Math.max(...flows.value.map(flow => flow.levels))
})

const clearFilters = () => {
  searchQuery.value = ''
  awaitFilter.value = 'all'
}

const getRuntimes = (flow: any) => {
  const runtimes = new Set<string>()
  if (!flow.steps || !Array.isArray(flow.steps)) {
    return []
  }
  for (const step of flow.steps) {
    if (step.runtime) {
      runtimes.add(step.runtime)
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
