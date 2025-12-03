<template>
  <UCard>
    <template #header>
      <div class="flex items-center gap-2">
        <UIcon
          name="i-lucide-git-branch"
          class="w-5 h-5 text-purple-500"
        />
        <h2 class="text-lg font-semibold">
          Flow Subscriptions
        </h2>
        <UBadge
          :label="subscriptions.length.toString()"
          color="primary"
          variant="subtle"
          size="sm"
        />
      </div>
    </template>

    <div class="space-y-4">
      <UFormField
        label="Search Flows"
        name="flowSearch"
      >
        <template #hint>
          <span class="text-xs text-gray-500">Select flows that should be triggered by this trigger</span>
        </template>
        <UInput
          v-model="searchQuery"
          placeholder="Search flows..."
          icon="i-lucide-search"
        />
      </UFormField>

      <div
        v-if="filteredFlows.length > 0"
        class="max-h-64 overflow-y-auto space-y-2 border border-gray-200 dark:border-gray-800 rounded-lg p-3"
      >
        <div
          v-for="flow in filteredFlows"
          :key="getFlowId(flow)"
          class="flex items-center justify-between p-2 hover:bg-gray-50 dark:hover:bg-gray-900/50 rounded-lg transition-colors"
        >
          <div class="flex items-center gap-2 min-w-0">
            <UIcon
              name="i-lucide-git-branch"
              class="w-4 h-4 text-blue-500 shrink-0"
            />
            <span class="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{{ getFlowId(flow) }}</span>
          </div>
          <ClientOnly>
            <UCheckbox
              :model-value="isFlowSubscribed(getFlowId(flow))"
              @update:model-value="$emit('toggle', getFlowId(flow))"
            />
          </ClientOnly>
        </div>
      </div>

      <div
        v-else
        class="text-center py-8 text-gray-500 dark:text-gray-400"
      >
        <UIcon
          name="i-lucide-search-x"
          class="w-8 h-8 mx-auto mb-2 opacity-50"
        />
        <p class="text-sm">
          No flows found
        </p>
      </div>

      <!-- Selected Flows -->
      <div
        v-if="subscriptions.length > 0"
        class="space-y-2"
      >
        <label class="text-sm font-medium text-gray-700 dark:text-gray-300">
          Selected Flows ({{ subscriptions.length }})
        </label>
        <div class="flex flex-wrap gap-2">
          <UBadge
            v-for="flowName in subscriptions"
            :key="flowName"
            :label="flowName"
            color="primary"
            variant="subtle"
            size="md"
          >
            <template #trailing>
              <UButton
                icon="i-lucide-x"
                size="2xs"
                color="neutral"
                variant="ghost"
                square
                @click="$emit('toggle', flowName)"
              />
            </template>
          </UBadge>
        </div>
      </div>
    </div>
  </UCard>
</template>

<script setup lang="ts">
import { ref, computed } from '#imports'

const props = defineProps<{
  subscriptions: string[]
  flows: Array<{ name?: string, id?: string }> | null
}>()

defineEmits<{
  toggle: [flowName: string]
}>()

const searchQuery = ref('')

// Helper to get flow identifier (prefer id over name)
const getFlowId = (flow: { name?: string, id?: string }) => flow.id || flow.name || ''

const filteredFlows = computed(() => {
  if (!props.flows) return []
  const query = searchQuery.value.toLowerCase()
  return props.flows.filter((flow) => {
    const flowId = getFlowId(flow)
    return flowId.toLowerCase().includes(query)
  })
})

const isFlowSubscribed = (flowName: string) => {
  return props.subscriptions.includes(flowName)
}
</script>
