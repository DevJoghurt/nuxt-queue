<template>
  <div
    :class="heightClass"
    class="overflow-auto"
  >
    <ul
      v-if="items && items.length"
      class="space-y-2"
    >
      <li
        v-for="e in items"
        :key="e.id"
        class="text-sm"
      >
        <div class="flex gap-2 items-center">
          <span class="text-gray-500">{{ formatTs(e) }}</span>
          <span class="font-mono">{{ e.kind }}</span>
          <span
            v-if="e.subject"
            class="text-gray-500"
          >{{ e.subject }}</span>
        </div>
        <!-- Special rendering for runner.log -->
        <div
          v-if="e.kind === 'runner.log'"
          class="mt-1"
        >
          <div class="flex items-center gap-2">
            <UBadge
              :color="levelColor(e?.data?.level)"
              variant="subtle"
              class="capitalize"
            >
              {{ e?.data?.level || 'info' }}
            </UBadge>
            <span class="">{{ e?.data?.msg || e?.data?.message || '' }}</span>
          </div>
          <div
            v-if="e?.data?.meta"
            class="mt-1"
          >
            <pre class="text-xs bg-gray-100/20 rounded p-2 overflow-auto">{{ pretty(e.data.meta) }}</pre>
          </div>
        </div>
        <pre
          v-else
          class="text-xs bg-gray-100/20 rounded p-2 overflow-auto"
        >{{ pretty(e.data) }}</pre>
      </li>
    </ul>
    <div
      v-else
      class="h-full w-full flex items-center justify-center text-sm text-gray-500"
    >
      No events yet.
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from '#imports'

const props = defineProps<{ items: any[], heightClass?: string }>()

const heightClass = computed(() => props.heightClass || 'h-96')

function pretty(v: any) {
  try {
    return JSON.stringify(v, null, 2)
  }
  catch {
    return String(v)
  }
}

function formatTs(e: any) {
  try {
    const t = e?.ts || (typeof e?.id === 'string' && e.id.includes('-') ? Number(e.id.split('-')[0]) : Date.now())
    return new Date(t).toLocaleString()
  }
  catch {
    return ''
  }
}

function levelColor(level?: string) {
  switch ((level || '').toLowerCase()) {
    case 'debug': return 'neutral'
    case 'info': return 'primary'
    case 'warn': return 'warning'
    case 'error': return 'error'
    default: return 'neutral'
  }
}
</script>

<style scoped>
</style>
