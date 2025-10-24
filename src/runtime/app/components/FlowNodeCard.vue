<template>
  <UCard
    :ui="{
      base: 'min-w-[220px] max-w-[300px] p-0',
      body: 'p-0',      
      header: headerClass,
      footer: footerClass,
    }"
  >
    <template #header>
      <div class="flex items-center justify-between gap-2">
        <div class="min-w-0">
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
    </div>

    <template #footer>
      <div class="flex items-center gap-2">
        <UButton
          size="xs"
          color="neutral"
          label="Run"
          icon="i-heroicons-play-20-solid"
          @click.stop="emit('action', { id: props.id, action: 'run' })"
        />
        <UButton
          size="xs"
          color="neutral"
          label="Logs"
          icon="i-heroicons-document-text-20-solid"
          @click.stop="emit('action', { id: props.id, action: 'logs' })"
        />
        <UButton
          size="xs"
          color="neutral"
          label="Details"
          icon="i-heroicons-information-circle-20-solid"
          @click.stop="emit('action', { id: props.id, action: 'details' })"
        />
      </div>
    </template>
  </UCard>
</template>

<script setup lang="ts">
import { computed } from '#imports'

type Status = 'idle' | 'running' | 'error' | 'done' | string | undefined

const props = defineProps<{
  id: string
  data: { label?: string, queue?: string, workerId?: string, status?: Status }
  kind?: 'entry' | 'step'
}>()

const emit = defineEmits<{
  (e: 'action', payload: { id: string, action: 'run' | 'logs' | 'details' }): void
}>()

const headerClass = computed(() => props.kind === 'entry'
  ? 'px-3 py-2 bg-gradient-to-br from-emerald-800 to-emerald-700 text-emerald-50 rounded-t'
  : 'px-3 py-2 bg-gradient-to-br from-gray-800 to-gray-700 text-gray-100 rounded-t')

const footerClass = computed(() => props.kind === 'entry'
  ? 'px-3 pb-2 pt-1'
  : 'px-3 pb-2 pt-1')

function statusColor(status: Status) {
  switch (status) {
    case 'running': return 'warning'
    case 'done': return 'success'
    case 'error': return 'error'
    default: return 'neutral'
  }
}
</script>

<style scoped>
</style>
