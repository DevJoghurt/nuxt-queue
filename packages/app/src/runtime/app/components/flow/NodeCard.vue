<template>
  <UCard
    class="min-w-[220px] max-w-[300px]"
    :ui="{
      body: 'p-0',
      header: headerClass,
      footer: footerClass,
    }"
  >
    <template #header>
      <div class="flex items-center justify-between gap-2">
        <div class="flex items-center gap-2 min-w-0">
          <UIcon
            v-if="runnerIcon"
            :name="runnerIcon"
            class="size-4 flex-shrink-0"
            :title="data?.workerId"
          />
          <p
            class="truncate font-medium"
            :title="data?.label"
          >
            {{ data?.label }}
          </p>
        </div>
        <UBadge
          :label="(data?.status || 'idle').toUpperCase()"
          size="xs"
          :color="statusColor(data?.status)"
        />
      </div>
    </template>

    <div class="px-3 py-2 text-xs space-y-1">
      <div class="flex items-center justify-between">
        <span class="text-gray-500 dark:text-gray-400">Queue</span>
        <span
          class="truncate ml-2 font-mono"
          :title="data?.queue"
        >{{ data?.queue || '-' }}</span>
      </div>
      <div class="flex items-center justify-between">
        <span class="text-gray-500 dark:text-gray-400">Worker</span>
        <span
          class="truncate ml-2 font-mono"
          :title="data?.workerId"
        >{{ data?.workerId || '-' }}</span>
      </div>
      <div
        v-if="data?.runtype"
        class="flex items-center justify-between"
      >
        <span class="text-gray-500 dark:text-gray-400">Mode</span>
        <UBadge
          :label="data.runtype"
          size="xs"
          color="neutral"
          variant="soft"
        />
      </div>
      <div
        v-if="data?.emits && data.emits.length > 0"
        class="flex items-start justify-between gap-2"
      >
        <span class="text-gray-500 dark:text-gray-400">Emits</span>
        <div class="flex flex-wrap gap-1 justify-end">
          <UBadge
            v-for="event in data.emits"
            :key="event"
            :label="event"
            size="xs"
            color="primary"
            variant="soft"
          />
        </div>
      </div>
      <div
        v-if="data?.attempt && data.attempt > 1"
        class="flex items-center justify-between"
      >
        <span class="text-gray-500 dark:text-gray-400">Attempts</span>
        <span class="ml-2 font-medium text-amber-600 dark:text-amber-400">
          {{ data.attempt }}
        </span>
      </div>
      <div
        v-if="data?.error"
        class="pt-1 border-t border-gray-200 dark:border-gray-700"
      >
        <span
          class="text-red-500 dark:text-red-400 block truncate"
          :title="data.error"
        >
          ⚠️ {{ data.error }}
        </span>
      </div>
    </div>

    <template #footer>
      <div class="flex items-center justify-center gap-2 w-full">
        <UButton
          size="xs"
          color="neutral"
          label="Logs"
          icon="i-heroicons-document-text-20-solid"
          @click="handleAction('logs')"
        />
        <UButton
          size="xs"
          color="neutral"
          label="Details"
          icon="i-heroicons-information-circle-20-solid"
          @click="handleAction('details')"
        />
      </div>
    </template>
  </UCard>
</template>

<script setup lang="ts">
import { computed } from '#imports'
import { UCard, UButton, UBadge, UIcon } from '#components'

type Status = 'idle' | 'running' | 'error' | 'done' | 'canceled' | string | undefined

const props = defineProps<{
  id: string
  data: {
    label?: string
    queue?: string
    workerId?: string
    status?: Status
    attempt?: number
    error?: string
    runtime?: 'nodejs' | 'python'
    runtype?: 'inprocess' | 'task'
    emits?: string[]
  }
  kind?: 'entry' | 'step'
}>()

const emit = defineEmits<{
  (e: 'action', payload: { id: string, action: 'run' | 'logs' | 'details' }): void
}>()

function handleAction(action: 'run' | 'logs' | 'details') {
  emit('action', { id: props.id, action })
}

const headerClass = computed(() => props.kind === 'entry'
  ? 'px-3 py-2 bg-gradient-to-br from-emerald-800 to-emerald-700 text-emerald-50 rounded-t'
  : 'px-3 py-2 bg-gradient-to-br from-gray-800 to-gray-700 text-gray-100 rounded-t')

const footerClass = computed(() => props.kind === 'entry'
  ? 'px-3 pb-2 pt-1'
  : 'px-3 pb-2 pt-1')

const runnerIcon = computed(() => {
  // Use explicit runtime field if available
  const runtime = props.data?.runtime
  if (runtime === 'python') {
    return 'i-devicon-python'
  }
  if (runtime === 'nodejs') {
    return 'i-devicon-nodejs'
  }

  return runtime ? 'i-lucide-code' : undefined
})

function statusColor(status: Status) {
  switch (status) {
    case 'running': return 'warning'
    case 'done': return 'success'
    case 'error': return 'error'
    case 'canceled': return 'orange'
    default: return 'neutral'
  }
}
</script>

<style scoped>
</style>
