<template>
  <div>
    <section>
      <h1 class="text-xl font-bold">
        Dashboard
      </h1>
      <p class="text-sm font-thin text-gray-500">
        Aggregate view of queues and recent events.
      </p>
    </section>
    <div class="grid md:grid-cols-3 gap-4 py-4">
      <UCard>
        <template #header>
          <div class="flex items-center justify-between">
            <div class="font-semibold">
              Queues Metrics
            </div>
            <UButton
              size="xs"
              color="neutral"
              variant="outline"
              class="cursor-pointer"
              :loading="loadingMetrics"
              @click="refreshMetrics()"
            >
              Refresh
            </UButton>
          </div>
        </template>
        <div class="space-y-2">
          <div
            v-for="(m, name) in metrics"
            :key="String(name)"
            class="p-2 rounded bg-gray-100/10"
          >
            <div class="flex items-center justify-between">
              <div class="text-sm font-semibold">
                {{ name }}
              </div>
              <UBadge
                variant="subtle"
                color="neutral"
              >
                {{ m?.paused ? 'Paused' : 'Running' }}
              </UBadge>
            </div>
            <div class="mt-2 grid grid-cols-2 gap-2 text-xs">
              <div>Active: <span class="font-mono">{{ m?.counts?.active || 0 }}</span></div>
              <div>Waiting: <span class="font-mono">{{ m?.counts?.waiting || 0 }}</span></div>
              <div>Completed: <span class="font-mono">{{ m?.counts?.completed || 0 }}</span></div>
              <div>Failed: <span class="font-mono">{{ m?.counts?.failed || 0 }}</span></div>
            </div>
          </div>
          <div
            v-if="!metrics || Object.keys(metrics || {}).length === 0"
            class="text-xs text-gray-500"
          >
            No queues discovered yet.
          </div>
        </div>
      </UCard>
      <UCard class="md:col-span-2">
        <template #header>
          <div class="flex items-center justify-between">
            <div class="font-semibold">
              Recent Events
            </div>
            <div class="flex gap-2 items-center">
              <UInput
                v-model="stream"
                class="w-48"
                placeholder="stream"
              />
              <UInput
                v-model="limitStr"
                class="w-24"
                placeholder="limit"
              />
              <UButton
                size="xs"
                color="neutral"
                variant="outline"
                class="cursor-pointer"
                :disabled="loadingEvents"
                :loading="loadingEvents"
                @click="loadHistory"
              >
                Load
              </UButton>
              <UButton
                size="xs"
                color="neutral"
                variant="outline"
                class="cursor-pointer"
                :disabled="events.length === 0"
                @click="exportJson"
              >
                Export JSON
              </UButton>
              <UButton
                size="xs"
                color="neutral"
                variant="outline"
                class="cursor-pointer"
                :disabled="events.length === 0 && !open"
                @click="clearEvents"
              >
                Clear
              </UButton>
              <UButton
                size="xs"
                color="neutral"
                variant="outline"
                class="cursor-pointer"
                @click="toggleTail"
              >
                {{ open ? 'Stop tail' : 'Tail' }}
              </UButton>
              <span
                v-if="reconnecting"
                class="text-xs text-amber-500"
              >Reconnecting…</span>
            </div>
          </div>
        </template>
        <TimelineList
          :items="events"
          height-class="h-96"
        />
      </UCard>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, useRuntimeConfig } from '#imports'
import TimelineList from '../../components/TimelineList.vue'
import useEventSSE from '../../composables/useEventSSE'

// Metrics
const metrics = ref<Record<string, any> | null>(null)
const loadingMetrics = ref(false)
const refreshMetrics = async () => {
  try {
    loadingMetrics.value = true
    const m = await $fetch<Record<string, any>>('/api/_queue/metrics')
    metrics.value = m || {}
  }
  finally {
    loadingMetrics.value = false
  }
}

// Events
const events = ref<any[]>([])
const lastId = ref<string | undefined>(undefined)
const limitStr = ref<string>('100')
const stream = ref<string>('')
const loadingEvents = ref(false)
const { start: startSSE, stop: stopSSE, open, reconnecting } = useEventSSE()

const loadHistory = async () => {
  try {
    loadingEvents.value = true
    const limit = Number(limitStr.value || '100')
    const s = stream.value || defaultStream.value
    const url = `/api/_events/${encodeURIComponent(s)}?limit=${limit}${lastId.value ? `&fromId=${encodeURIComponent(lastId.value)}` : ''}`
    const recs = await $fetch<any[]>(url)
    if (recs && recs.length) {
      events.value.push(...recs)
      lastId.value = recs[recs.length - 1].id
    }
  }
  finally {
    loadingEvents.value = false
  }
}

const toggleTail = async () => {
  if (open.value) return stopSSE()
  const s = stream.value || defaultStream.value
  const url = `/api/_events/sse?stream=${encodeURIComponent(s)}`
  startSSE(url, (msg) => {
    if (msg?.record) {
      events.value.push(msg.record)
      lastId.value = msg.record.id
    }
  }, { autoReconnect: true, maxRetries: 30, baseDelayMs: 500, maxDelayMs: 10000 })
}

const clearEvents = () => {
  events.value = []
  lastId.value = undefined
}

const exportJson = () => {
  const blob = new Blob([JSON.stringify(events.value, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `events-${new Date().toISOString()}.json`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

// Prefill stream from runtime config
const rc: any = useRuntimeConfig()
const defaultStream = ref<string>('nq:events')
const cfg = rc?.queue?.eventStore?.streams
if (typeof cfg?.global === 'string' && cfg.global) defaultStream.value = cfg.global
if (!stream.value) stream.value = defaultStream.value

// Initial load
refreshMetrics()
await loadHistory()
</script>
