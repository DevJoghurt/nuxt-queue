<template>
  <div>
    <section>
      <h1 class="text-xl font-bold">
        Events
      </h1>
      <p class="text-sm font-thin text-gray-500">
        Explore event streams. Tail live or page through history.
      </p>
    </section>
    <div class="grid md:grid-cols-3 gap-4 py-4">
      <UCard>
        <template #header>
          <div class="font-semibold">
            Stream
          </div>
        </template>
        <div class="space-y-2">
          <UInput
            v-model="stream"
            placeholder="Stream name (e.g. nq:events)"
          />
          <div class="flex gap-2">
            <UButton
              size="xs"
              color="neutral"
              variant="outline"
              class="cursor-pointer"
              :disabled="loading"
              :loading="loading"
              @click="loadHistory"
            >
              Load
            </UButton>
            <UButton
              size="xs"
              color="neutral"
              variant="outline"
              class="cursor-pointer"
              @click="toggleTail"
            >
              {{ open ? 'Stop tail' : 'Start tail' }}
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
          </div>
          <div class="text-xs text-gray-500">
            Default stream is the configured global stream.
          </div>
        </div>
      </UCard>
      <UCard class="md:col-span-2">
        <template #header>
          <div class="flex items-center justify-between">
            <div class="font-semibold">
              Timeline
            </div>
            <div class="flex gap-2 items-center">
              <UCheckbox
                v-model="logsOnly"
                label="Logs only"
                size="xs"
              />
              <UInput
                v-model="kindFilter"
                class="w-36"
                placeholder="kind filter"
              />
              <UInput
                v-model="subjectFilter"
                class="w-36"
                placeholder="subject filter"
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
                @click="pageMore"
              >
                More
              </UButton>
              <span
                v-if="reconnecting"
                class="text-xs text-amber-500"
              >Reconnecting…</span>
            </div>
          </div>
        </template>
        <TimelineList
          :items="visibleEvents"
          height-class="h-96"
        />
      </UCard>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, useRuntimeConfig } from '#imports'
import TimelineList from '../../components/TimelineList.vue'
import useEventSSE from '../../composables/useEventSSE'

const stream = ref<string>('')
const events = ref<any[]>([])
const lastId = ref<string | undefined>(undefined)
const limitStr = ref<string>('100')
const loading = ref<boolean>(false)
const { start: startSSE, stop: stopSSE, open, reconnecting } = useEventSSE()
const kindFilter = ref('')
const subjectFilter = ref('')
const logsOnly = ref(false)
const visibleEvents = computed(() => {
  const k = kindFilter.value.trim().toLowerCase()
  const s = subjectFilter.value.trim().toLowerCase()
  const src = logsOnly.value ? events.value.filter(e => e?.kind === 'runner.log') : events.value
  if (!k && !s) return src
  return src.filter((e) => {
    const ek = String(e?.kind || '').toLowerCase()
    const es = String(e?.subject || '').toLowerCase()
    return (!k || ek.includes(k)) && (!s || es.includes(s))
  })
})

// pretty now provided by TimelineList; keep only local event parsing

const loadHistory = async () => {
  try {
    loading.value = true
    const limit = Number(limitStr.value || '100')
    const s = stream.value || ''
    const url = s
      ? `/api/_events/${encodeURIComponent(s)}?limit=${limit}${lastId.value ? `&fromId=${encodeURIComponent(lastId.value)}` : ''}`
      : `/api/_events/${encodeURIComponent('nq:events')}?limit=${limit}${lastId.value ? `&fromId=${encodeURIComponent(lastId.value)}` : ''}`
    const recs = await $fetch<any[]>(url)
    if (recs && recs.length) {
      events.value.push(...recs)
      lastId.value = recs[recs.length - 1].id
    }
  }
  finally {
    loading.value = false
  }
}

const pageMore = async () => {
  await loadHistory()
}

const toggleTail = async () => {
  if (open.value) return stopSSE()
  const s = stream.value || ''
  const url = s ? `/api/_events/sse?stream=${encodeURIComponent(s)}` : '/api/_events/sse'
  startSSE(url, (msg) => {
    if (msg?.record) {
      events.value.push(msg.record)
      lastId.value = msg.record.id
    }
  }, { autoReconnect: true, maxRetries: 30, baseDelayMs: 500, maxDelayMs: 10000 })
}

const exportJson = () => {
  const blob = new Blob([JSON.stringify(visibleEvents.value, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `events-${new Date().toISOString()}.json`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

const clearEvents = () => {
  events.value = []
  lastId.value = undefined
}

// Prefill from runtime config default global stream if user leaves it blank
const rc: any = useRuntimeConfig()
if (!stream.value) {
  const cfg = rc?.queue?.eventStore?.streams
  if (typeof cfg?.global === 'string' && cfg.global) stream.value = cfg.global
}
</script>
