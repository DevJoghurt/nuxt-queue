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
            <div class="flex gap-2 items-center text-xs text-gray-500">
              <span v-if="runsReconnecting">Runs reconnecting…</span>
              <span v-else-if="runsOpen">Runs live</span>
              <span v-else>Runs idle</span>
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
          <UCard>
            <template #header>
              <div class="flex items-center justify-between">
                <div class="font-semibold">
                  Run snapshot
                </div>
                <div class="text-xs text-gray-500">
                  {{ timelineRunId }}
                </div>
              </div>
            </template>
            <div
              v-if="runSnapshot"
              class="grid grid-cols-2 md:grid-cols-3 gap-2 text-sm"
            >
              <div><span class="text-gray-500">Status:</span> {{ runSnapshot.status || 'unknown' }}</div>
              <div><span class="text-gray-500">Started:</span> {{ runSnapshot.startedAt ? new Date(runSnapshot.startedAt).toLocaleString() : '—' }}</div>
              <div><span class="text-gray-500">Completed:</span> {{ runSnapshot.completedAt ? new Date(runSnapshot.completedAt).toLocaleString() : '—' }}</div>
              <div><span class="text-gray-500">Logs:</span> {{ runSnapshot.logsCount ?? 0 }}</div>
              <div><span class="text-gray-500">Last level:</span> {{ runSnapshot.lastLogLevel || '—' }}</div>
            </div>
            <div
              v-else
              class="text-xs text-gray-500"
            >
              Loading snapshot…
            </div>
          </UCard>
          <UCard>
            <template #header>
              <div class="flex items-center justify-between">
                <div class="font-semibold">
                  Steps
                </div>
                <div class="text-xs text-gray-500">
                  {{ flowState.stepList.value.length }} total
                </div>
              </div>
            </template>
            <div class="text-sm">
              <div
                v-if="flowState.stepList.value.length === 0"
                class="text-xs text-gray-500"
              >
                No steps yet…
              </div>
              <ul
                v-else
                class="divide-y divide-gray-100"
              >
                <li
                  v-for="s in flowState.stepList.value"
                  :key="s.key"
                  class="py-1 flex items-center justify-between"
                >
                  <div>
                    <div class="font-mono">
                      {{ s.key }}
                    </div>
                    <div class="text-xs text-gray-500">
                      <span>Status: {{ s.status || 'pending' }}</span>
                      <span v-if="s.startedAt"> · Started: {{ new Date(s.startedAt).toLocaleString() }}</span>
                      <span v-if="s.completedAt"> · Completed: {{ new Date(s.completedAt).toLocaleString() }}</span>
                      <span v-if="s.awaitType"> · Waiting: {{ s.awaitType }}</span>
                    </div>
                  </div>
                  <div class="text-xs text-gray-500">
                    <span>Attempt: {{ s.attempt || 1 }}</span>
                    <span v-if="s.error"> · Error: {{ s.error.substring(0, 50) }}</span>
                  </div>
                </li>
              </ul>
            </div>
          </UCard>
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
            <span class="text-xs text-gray-500">
              <template v-if="timelineReconnecting">Timeline reconnecting…</template>
              <template v-else-if="timelineOpenSSE">Timeline live</template>
              <template v-else>Timeline idle</template>
            </span>
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
              :disabled="timeline.length === 0 && !timelineOpenSSE"
              @click="clearTimeline"
            >
              Clear
            </UButton>
            <span
              v-if="timelineReconnecting"
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
import { ref, onMounted, onBeforeUnmount, computed, watch } from '#imports'
import TimelineList from '../../components/TimelineList.vue'
import FlowDiagram from '../../components/FlowDiagram.vue'
import useEventSSE from '../../composables/useEventSSE'
import { useFlowState } from '../../composables/useFlowState'

const flows = ref<any[]>([])
const runs = ref<any[]>([])
const selectedFlow = ref<string>('')

const timelineOpen = ref<boolean>(false)
const timelineRunId = ref<string>('')
const limitStr = ref<string>('100')
const loadingTimeline = ref<boolean>(false)

// v0.3: Use client-side reducer for flow state
const flowState = useFlowState()

// Separate SSE channels for runs list and timeline
const runsSSE = useEventSSE()
const timelineSSE = useEventSSE()
const runsOpen = runsSSE.open
const runsReconnecting = runsSSE.reconnecting
const timelineOpenSSE = timelineSSE.open
const timelineReconnecting = timelineSSE.reconnecting

// Computed state from reducer
const runSnapshot = computed(() => {
  const state = flowState.state.value
  return {
    status: state.status,
    startedAt: state.startedAt,
    completedAt: state.completedAt,
    logsCount: state.logs.length,
    lastLogLevel: state.logs.length > 0 ? state.logs[state.logs.length - 1]?.level : undefined,
  }
})

const timeline = computed(() => flowState.events.value)

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
  // v0.3: Use generic list endpoint
  const res = await $fetch<{ items: any[] }>(`/api/_events/flow/list?name=${encodeURIComponent(selectedFlow.value)}`)
  runs.value = res?.items || []
}

const openRun = async (runId: string) => {
  timelineOpen.value = true
  timelineRunId.value = runId
  
  // v0.3: Reset flow state and load events
  flowState.reset()
  
  // Load initial events
  await loadMoreEvents()
  
  // Start SSE stream for live updates
  startTimelineTail()
}

const loadMoreEvents = async () => {
  if (!timelineRunId.value) return
  try {
    loadingTimeline.value = true
    const limit = Number(limitStr.value || '100')
    const lastId = flowState.events.value.length > 0
      ? flowState.events.value[flowState.events.value.length - 1]?.id
      : undefined

    // v0.3: Use generic state endpoint
    const url = `/api/_events/flow/${encodeURIComponent(timelineRunId.value)}${lastId ? `?fromId=${encodeURIComponent(lastId)}&limit=${limit}` : `?limit=${limit}`}`
    const res = await $fetch<{ events: any[] }>(url)
    const events = res?.events || []

    if (events.length) {
      flowState.addEvents(events)
    }
  }
  finally {
    loadingTimeline.value = false
  }
}

const pageTimeline = async () => {
  await loadMoreEvents()
}

const startTimelineTail = () => {
  if (!timelineRunId.value) return
  // v0.3: Use generic SSE stream endpoint
  const url = `/api/_events/flow/${encodeURIComponent(timelineRunId.value)}/stream`
  timelineSSE.start(url, (msg) => {
    console.log('Timeline SSE message', msg)
    if (msg?.record) {
      console.log('Timeline SSE received event', msg.record)
      flowState.addEvent(msg.record)
    }
  }, {
    autoReconnect: true,
    maxRetries: 30,
    baseDelayMs: 500,
    maxDelayMs: 10000,
  })
}

const exportTimelineJson = () => {
  const blob = new Blob([JSON.stringify(flowState.events.value, null, 2)], { type: 'application/json' })
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
  flowState.reset()
}

onMounted(async () => {
  flows.value = await $fetch<any[]>('/api/_flows')
})

// Auto-manage runs SSE when selectedFlow changes
watch(selectedFlow, async (name, _prev) => {
  try {
    runsSSE.stop()
  }
  catch {
    // ignore
  }
  runs.value = []
  if (name) {
    await refreshRuns()
    // Start polling for new runs every 5 seconds
    startRunsPolling()
  }
  else {
    stopRunsPolling()
  }
})

let pollInterval: ReturnType<typeof setInterval> | null = null

const startRunsPolling = () => {
  stopRunsPolling()
  pollInterval = setInterval(async () => {
    if (selectedFlow.value && !timelineOpen.value) {
      await refreshRuns()
    }
  }, 5000)
}

const stopRunsPolling = () => {
  if (pollInterval) {
    clearInterval(pollInterval)
    pollInterval = null
  }
}

onBeforeUnmount(() => {
  stopRunsPolling()
})

// Stop timeline SSE when the slideover closes
watch(timelineOpen, (isOpen) => {
  if (!isOpen) {
    try {
      timelineSSE.stop()
    }
    catch {
      // ignore
    }
  }
})
</script>
