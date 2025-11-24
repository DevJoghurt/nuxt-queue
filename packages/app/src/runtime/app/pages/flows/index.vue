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
        <div class="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <div class="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 p-4">
            <div class="flex items-center gap-3">
              <div class="p-2 bg-blue-50 dark:bg-blue-950 rounded-lg">
                <UIcon
                  name="i-lucide-git-branch"
                  class="w-5 h-5 text-blue-600 dark:text-blue-400"
                />
              </div>
              <div>
                <div class="text-2xl font-bold text-gray-900 dark:text-gray-100">
                  {{ flows?.length || 0 }}
                </div>
                <div class="text-sm text-gray-500">
                  Total Flows
                </div>
              </div>
            </div>
          </div>

          <div class="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 p-4">
            <div class="flex items-center gap-3">
              <div class="p-2 bg-green-50 dark:bg-green-950 rounded-lg">
                <UIcon
                  name="i-lucide-layers"
                  class="w-5 h-5 text-green-600 dark:text-green-400"
                />
              </div>
              <div>
                <div class="text-2xl font-bold text-gray-900 dark:text-gray-100">
                  {{ totalSteps }}
                </div>
                <div class="text-sm text-gray-500">
                  Total Steps
                </div>
              </div>
            </div>
          </div>

          <div class="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 p-4">
            <div class="flex items-center gap-3">
              <div class="p-2 bg-purple-50 dark:bg-purple-950 rounded-lg">
                <UIcon
                  name="i-lucide-pause"
                  class="w-5 h-5 text-purple-600 dark:text-purple-400"
                />
              </div>
              <div>
                <div class="text-2xl font-bold text-gray-900 dark:text-gray-100">
                  {{ flowsWithAwait }}
                </div>
                <div class="text-sm text-gray-500">
                  With Await
                </div>
              </div>
            </div>
          </div>

          <div class="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 p-4">
            <div class="flex items-center gap-3">
              <div class="p-2 bg-orange-50 dark:bg-orange-950 rounded-lg">
                <UIcon
                  name="i-lucide-bar-chart-3"
                  class="w-5 h-5 text-orange-600 dark:text-orange-400"
                />
              </div>
              <div>
                <div class="text-2xl font-bold text-gray-900 dark:text-gray-100">
                  {{ maxLevels }}
                </div>
                <div class="text-sm text-gray-500">
                  Max Levels
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Filters -->
        <div class="flex items-center gap-3 mb-4">
          <div class="flex-1">
            <UInput
              v-model="searchQuery"
              icon="i-lucide-search"
              placeholder="Search flows..."
              class="w-full"
            />
          </div>
          <USelectMenu
            v-model="selectedRuntime"
            :items="runtimeOptions"
            placeholder="All Runtimes"
            class="w-48"
          >
            <template #leading>
              <UIcon
                v-if="selectedRuntime"
                name="i-lucide-filter"
                class="w-4 h-4"
              />
            </template>
          </USelectMenu>
        </div>

        <!-- Flows List -->
        <div class="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 overflow-hidden">
          <div class="divide-y divide-gray-200 dark:divide-gray-800">
            <div
              v-if="!filteredFlows || filteredFlows.length === 0"
              class="p-8 text-center text-gray-500"
            >
              <UIcon
                name="i-lucide-git-branch"
                class="w-12 h-12 mx-auto mb-3 opacity-50"
              />
              <div>No flows found</div>
            </div>
            <div
              v-for="flow in filteredFlows"
              :key="flow.id"
              class="p-4 hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer transition-colors"
              @click="openFlow(flow.id)"
            >
              <div class="flex items-start justify-between gap-4">
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-2 mb-1">
                    <h3 class="font-medium text-gray-900 dark:text-gray-100 truncate">
                      {{ flow.id }}
                    </h3>
                    <span
                      class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium"
                      :class="{
                        'bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300': flow.runtime === 'nodejs',
                        'bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300': flow.runtime === 'python',
                      }"
                    >
                      {{ flow.runtime }}
                    </span>
                    <span
                      v-if="flow.hasAwait"
                      class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-300"
                    >
                      <UIcon
                        name="i-lucide-pause"
                        class="w-3 h-3"
                      />
                      await
                    </span>
                  </div>
                  <div class="flex items-center gap-4 text-sm text-gray-500">
                    <div class="flex items-center gap-1">
                      <UIcon
                        name="i-lucide-layers"
                        class="w-3.5 h-3.5"
                      />
                      <span>{{ flow.steps.length }} step{{ flow.steps.length === 1 ? '' : 's' }}</span>
                    </div>
                    <div class="flex items-center gap-1">
                      <UIcon
                        name="i-lucide-bar-chart-3"
                        class="w-3.5 h-3.5"
                      />
                      <span>{{ flow.levels }} level{{ flow.levels === 1 ? '' : 's' }}</span>
                    </div>
                    <div
                      v-if="flow.timeout"
                      class="flex items-center gap-1"
                    >
                      <UIcon
                        name="i-lucide-clock"
                        class="w-3.5 h-3.5"
                      />
                      <span>{{ formatTimeout(flow.timeout) }} timeout</span>
                    </div>
                  </div>
                </div>
                <UIcon
                  name="i-lucide-chevron-right"
                  class="w-5 h-5 text-gray-400 shrink-0 mt-1"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, useAnalyzedFlows, useComponentRouter } from '#imports'
const flows = useAnalyzedFlows()
const router = useComponentRouter()

const searchQuery = ref('')
const selectedRuntime = ref<string | null>(null)

const runtimeOptions = [
  { label: 'All Runtimes', value: null },
  { label: 'Node.js', value: 'nodejs' },
  { label: 'Python', value: 'python' },
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

  // Filter by runtime
  if (selectedRuntime.value) {
    filtered = filtered.filter(flow =>
      flow.runtime === selectedRuntime.value,
    )
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
