<template>
  <div>
    <section>
      <h1 class="text-xl font-bold">
        Flows
      </h1>
      <p class="text-sm font-thin text-gray-500">
        Inspect flow definitions and their runs.
      </p>
    </section>
    <div class="grid md:grid-cols-3 gap-4 py-4">
      <UCard>
        <template #header>
          <div class="font-semibold">
            Flows
          </div>
        </template>
        <ul class="space-y-1">
          <li
            v-for="f in flows"
            :key="f.id"
          >
            <UButton
              color="neutral"
              variant="ghost"
              class="cursor-pointer w-full justify-start"
              size="sm"
              @click="selectFlow(f.id)"
            >
              {{ f.id }}
            </UButton>
          </li>
        </ul>
      </UCard>
      <UCard class="md:col-span-2">
        <template #header>
          <div class="flex items-center justify-between">
            <div class="font-semibold">
              Runs
            </div>
            <div class="flex gap-2 items-center">
              <UButton
                size="xs"
                color="neutral"
                variant="outline"
                class="cursor-pointer"
                :disabled="!selectedFlow"
                @click="refreshRuns"
              >
                Refresh
              </UButton>
            </div>
          </div>
        </template>
        <div class="space-y-4">
          <UCard>
            <template #header>
              <div class="flex items-center justify-between">
                <div class="font-semibold">
                  Diagram
                </div>
                <div class="text-xs text-gray-500">
                  {{ selectedFlow || 'none' }}
                </div>
              </div>
            </template>
            <FlowDiagram
              :flow="selectedFlowMeta"
              :show-controls="true"
              :show-background="true"
              height-class="h-96"
            />
          </UCard>
          <div class="h-96 overflow-auto">
            <ul class="space-y-2">
              <li
                v-for="r in runs"
                :key="r.id"
                class="text-sm"
              >
                <div class="flex items-center justify-between">
                  <div>
                    <div class="font-mono">
                      {{ r.id }}
                    </div>
                    <div class="text-xs text-gray-500">
                      {{ new Date(r.createdAt || r.ts || r.startedAt || Date.now()).toLocaleString() }}
                    </div>
                  </div>
                  <div>
                    <UButton
                      size="xs"
                      color="neutral"
                      variant="outline"
                      class="cursor-pointer"
                      @click="openRun(r.id)"
                    >
                      Timeline
                    </UButton>
                  </div>
                </div>
              </li>
            </ul>
          </div>
        </div>
      </UCard>
    </div>
    <USlideover
      v-model:open="timelineOpen"
      title="Flow timeline"
    >
      <template #body>
        <div class="space-y-2">
          <div class="flex gap-2 items-center">
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
              :disabled="loadingTimeline"
              :loading="loadingTimeline"
              @click="pageTimeline"
            >
              More
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
            <UButton
              size="xs"
              color="neutral"
              variant="outline"
              class="cursor-pointer"
              :disabled="timeline.length === 0"
              @click="exportTimelineJson"
            >
              Export JSON
            </UButton>
            <UButton
              size="xs"
              color="neutral"
              variant="outline"
              class="cursor-pointer"
              :disabled="timeline.length === 0 && !open"
              @click="clearTimeline"
            >
              Clear
            </UButton>
            <span
              v-if="reconnecting"
              class="text-xs text-amber-500"
            >Reconnecting…</span>
          </div>
          <TimelineList
            :items="timeline"
            height-class="h-96"
          />
        </div>
      </template>
    </USlideover>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from '#imports'
import TimelineList from '../../components/TimelineList.vue'
import FlowDiagram from '../../components/FlowDiagram.vue'
import useEventSSE from '../../composables/useEventSSE'

const flows = ref<any[]>([])
const runs = ref<any[]>([])
const selectedFlow = ref<string>('')

const timelineOpen = ref<boolean>(false)
const timelineRunId = ref<string>('')
const timeline = ref<any[]>([])
const lastTimelineId = ref<string | undefined>(undefined)
const limitStr = ref<string>('100')
const loadingTimeline = ref<boolean>(false)

const { start: startSSE, stop: stopSSE, open, reconnecting } = useEventSSE()

const selectFlow = async (id: string) => {
  selectedFlow.value = id
  await refreshRuns()
}

const selectedFlowMeta = computed(() => {
  const id = selectedFlow.value
  if (!id) return null
  return (flows.value || []).find((f: any) => f?.id === id) || null
})

const refreshRuns = async () => {
  if (!selectedFlow.value) return
  const res = await $fetch<{ items: any[], nextFromId?: string }>(`/api/_flows/${encodeURIComponent(selectedFlow.value)}/runs`)
  runs.value = res?.items || []
}

const openRun = async (runId: string) => {
  timelineOpen.value = true
  timelineRunId.value = runId
  timeline.value = []
  lastTimelineId.value = undefined
  await pageTimeline()
}

const pageTimeline = async () => {
  if (!selectedFlow.value || !timelineRunId.value) return
  try {
    loadingTimeline.value = true
    const limit = Number(limitStr.value || '100')
    const url = `/api/_flows/${encodeURIComponent(selectedFlow.value)}/runs/${encodeURIComponent(timelineRunId.value)}/timeline?limit=${limit}${lastTimelineId.value ? `&fromId=${encodeURIComponent(lastTimelineId.value)}` : ''}`
    const res = await $fetch<{ items: any[], nextFromId?: string }>(url)
    const recs = res?.items || []
    if (recs.length) {
      timeline.value.push(...recs)
      lastTimelineId.value = res?.nextFromId || recs[recs.length - 1].id
    }
  }
  finally {
    loadingTimeline.value = false
  }
}

const toggleTail = async () => {
  if (open.value) return stopSSE()
  if (!selectedFlow.value || !timelineRunId.value) return
  const url = `/api/_flows/${encodeURIComponent(selectedFlow.value)}/runs/${encodeURIComponent(timelineRunId.value)}/tail`
  console.log('Starting tail with URL', url)
  startSSE(url, (msg) => {
    console.log('Received tail message', msg)
    if (msg?.record) {
      timeline.value.push(msg.record)
      lastTimelineId.value = msg.record.id
    }
  }, { autoReconnect: true, maxRetries: 30, baseDelayMs: 500, maxDelayMs: 10000 })
}

const exportTimelineJson = () => {
  const blob = new Blob([JSON.stringify(timeline.value, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `flow-${selectedFlow.value}-${timelineRunId.value}-events-${new Date().toISOString()}.json`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

const clearTimeline = () => {
  timeline.value = []
  lastTimelineId.value = undefined
}

onMounted(async () => {
  flows.value = await $fetch<any[]>('/api/_flows')
})
</script>
