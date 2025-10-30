<template>
  <div
    :class="heightClass"
    class="w-full border rounded bg-white/5"
  >
    <ClientOnly>
      <div class="relative h-full">
        <button
          v-if="flowId"
          class="absolute z-10 top-2 right-2 bg-gray-700 hover:bg-gray-600 text-white text-xs px-2 py-1 rounded"
          type="button"
          title="Reset layout"
          @click="resetLayout()"
        >
          Reset
        </button>
        <VueFlow
          v-model:nodes="internalNodes"
          v-model:edges="internalEdges"
          fit-view
          class="h-full w-full"
          @node-click="onNodeClick"
        >
          <template #node-flow-step="{ id, data }">
            <FlowNodeCard
              :id="id"
              :data="data"
              kind="step"
              @action="onAction"
            />
            <Handle
              type="target"
              :position="Position.Top"
            />
            <Handle
              type="source"
              :position="Position.Bottom"
            />
          </template>

          <template #node-flow-entry="{ id, data }">
            <FlowNodeCard
              :id="id"
              :data="data"
              kind="entry"
              @action="onAction"
            />
            <Handle
              type="source"
              :position="Position.Bottom"
            />
          </template>

          <Background
            v-if="showBackground"
            pattern-color="#888"
            :gap="12"
          />
          <Controls v-if="showControls" />
          <MiniMap v-if="showMiniMap" />
        </VueFlow>
      </div>
    </ClientOnly>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from '#imports'
import type { Node as VFNode, Edge as VFEdge } from '@vue-flow/core'
import { Handle, Position } from '@vue-flow/core'
import FlowNodeCard from '../components/FlowNodeCard.vue'

interface FlowEntry {
  step: string
  queue: string
  workerId: string
  runtime?: 'nodejs' | 'python'
  runtype?: 'inprocess' | 'task'
  emits?: string[]
}
interface FlowStep {
  queue: string
  workerId: string
  subscribes?: string[]
  runtime?: 'nodejs' | 'python'
  runtype?: 'inprocess' | 'task'
  emits?: string[]
}
interface FlowMeta {
  id: string
  entry?: FlowEntry
  steps?: Record<string, FlowStep>
}

interface StepStatus {
  status: 'pending' | 'running' | 'completed' | 'failed' | 'retrying' | 'waiting' | 'timeout'
  attempt?: number
  error?: string
}

const props = defineProps<{
  flow?: FlowMeta | null
  heightClass?: string
  showControls?: boolean
  showMiniMap?: boolean
  showBackground?: boolean
  stepStates?: Record<string, StepStatus> // Current execution state
}>()

const heightClass = computed(() => props.heightClass || 'h-80')
const emit = defineEmits<{
  (e: 'nodeSelected', payload: { id: string }): void
  (e: 'nodeAction', payload: { id: string, action: 'run' | 'logs' | 'details' }): void
}>()
const flowId = computed(() => props.flow?.id)

type FlowNode = {
  id: string
  position: { x: number, y: number }
  data: {
    label: string
    queue?: string
    workerId?: string
    status?: 'idle' | 'running' | 'error' | 'done'
    attempt?: number
    error?: string
    runtime?: 'nodejs' | 'python'
    runtype?: 'inprocess' | 'task'
    emits?: string[]
  }
  type?: string
  style?: Record<string, any>
}
type FlowEdge = { id: string, source: string, target: string, label?: string, animated?: boolean }

const nodes = computed<FlowNode[]>(() => {
  const out: FlowNode[] = []
  const f = props.flow
  if (!f) return out
  let y = 0
  const xCenter = 100
  const states = props.stepStates || {}
  
  if (f.entry) {
    const entryState = states[f.entry.step]
    const status = mapStatusToNodeStatus(entryState?.status)

    out.push({
      id: `entry:${f.entry.step}`,
      position: { x: xCenter, y: y },
      data: {
        label: f.entry.step,
        queue: f.entry.queue,
        status,
        attempt: entryState?.attempt,
        error: entryState?.error,
        runtime: f.entry.runtime,
        runtype: f.entry.runtype,
        emits: f.entry.emits,
      },
      type: 'flow-entry',
      style: { minWidth: '220px' },
    })
    y += 120
  }
  const steps = f.steps || {}
  const names = Object.keys(steps)
  const colWidth = 220
  names.forEach((name, idx) => {
    const step = steps[name]
    const stepState = states[name]
    const status = mapStatusToNodeStatus(stepState?.status)

    out.push({
      id: `step:${name}`,
      position: { x: (idx % 3) * colWidth, y: y + Math.floor(idx / 3) * 120 },
      data: {
        label: name,
        queue: step?.queue,
        workerId: step?.workerId,
        status,
        attempt: stepState?.attempt,
        error: stepState?.error,
        runtime: step?.runtime,
        runtype: step?.runtype,
        emits: step?.emits,
      },
      type: 'flow-step',
      style: { minWidth: '220px' },
    })
  })
  return out
})

// Map step status to node visual status
function mapStatusToNodeStatus(status?: string): 'idle' | 'running' | 'error' | 'done' {
  switch (status) {
    case 'running':
    case 'retrying':
    case 'waiting':
      return 'running'
    case 'completed':
      return 'done'
    case 'failed':
    case 'timeout':
      return 'error'
    default:
      return 'idle'
  }
}

const edges = computed<FlowEdge[]>(() => {
  const f = props.flow
  if (!f) return []
  const steps = f.steps || {}
  const stepNames = Object.keys(steps)
  const states = props.stepStates || {}

  const added = new Set<string>()
  const out: FlowEdge[] = []

  function addEdge(source: string, target: string, label?: string) {
    const id = `${source}->${target}${label ? `:${label}` : ''}`
    if (added.has(id)) return

    // Determine if edge should be animated
    // Animate if source is completed and target is running/pending
    const sourceStep = source.split(':')[1]
    const targetStep = target.split(':')[1]
    const sourceState = sourceStep ? states[sourceStep] : undefined
    const targetState = targetStep ? states[targetStep] : undefined

    const animated = sourceState?.status === 'completed'
      && (targetState?.status === 'running' || targetState?.status === 'pending' || !targetState)

    added.add(id)
    out.push({ id, source, target, label, animated })
  }

  let derived = 0
  for (const target of stepNames) {
    const subs = steps[target]?.subscribes || []
    for (const token of subs) {
      const t = String(token)
      const [prefix, valueRaw] = t.includes(':') ? t.split(':', 2) as [string, string] : [undefined, t]
      const value = valueRaw?.trim()
      const sources: string[] = []

      // Match by explicit prefixes
      if (prefix === 'step' && value) {
        if (stepNames.includes(value)) sources.push(`step:${value}`)
      }
      if (prefix === 'queue' && value) {
        for (const s of stepNames) if (steps[s]?.queue === value) sources.push(`step:${s}`)
      }
      if (prefix === 'worker' && value) {
        for (const s of stepNames) if (steps[s]?.workerId === value) sources.push(`step:${s}`)
      }

      // Heuristics without prefix: try step name first, then queue match
      if (!prefix && value) {
        if (stepNames.includes(value)) sources.push(`step:${value}`)
        for (const s of stepNames) if (steps[s]?.queue === value) sources.push(`step:${s}`)
      }

      for (const src of sources) {
        addEdge(src, `step:${target}`, t)
        derived++
      }
    }
  }

  // Fallback: entry -> all steps if nothing derived
  if (derived === 0 && f.entry) {
    const fromId = `entry:${f.entry.step}`
    for (const name of stepNames) addEdge(fromId, `step:${name}`)
  }

  return out
})

// Internal state for interaction and persistence
const internalNodes = ref<VFNode[]>([])
const internalEdges = ref<VFEdge[]>([])

function storageKey(flowId?: string) {
  return flowId ? `flow-layout:${flowId}` : 'flow-layout:unknown'
}

function applySavedPositions(nodesIn: VFNode[], flowId?: string) {
  if (!flowId) return nodesIn
  try {
    const raw = localStorage.getItem(storageKey(flowId))
    if (!raw) return nodesIn
    const saved: Array<{ id: string, x: number, y: number }> = JSON.parse(raw)
    const byId = new Map(saved.map(s => [s.id, s]))
    nodesIn.forEach((n) => {
      const s = byId.get(n.id)
      if (s) n.position = { x: s.x, y: s.y }
    })
  }
  catch {
    // ignore
  }
  return nodesIn
}

function savePositionsDebounced(flowId?: string) {
  if (!flowId) return
  const payload = internalNodes.value.map(n => ({ id: n.id, x: n.position.x, y: n.position.y }))
  try {
    localStorage.setItem(storageKey(flowId), JSON.stringify(payload))
  }
  catch {
    // ignore quota errors
  }
}

// Rebuild internal state when flow changes
watch(() => props.flow, (f) => {
  if (!f) {
    internalNodes.value = []
    internalEdges.value = []
    return
  }
  const builtNodes: VFNode[] = nodes.value.map(n => ({ id: n.id, position: { ...n.position }, data: { ...n.data }, type: n.type, style: n.style }))
  const builtEdges: VFEdge[] = edges.value.map(e => ({ id: e.id, source: e.source, target: e.target, label: e.label, animated: e.animated }))
  applySavedPositions(builtNodes, f.id)
  internalNodes.value = builtNodes
  internalEdges.value = builtEdges
}, { immediate: true, deep: false })

// Update node data when stepStates change (for live status updates)
watch(() => props.stepStates, () => {
  if (!props.flow) return
  // Update node data without changing positions
  const builtNodes: VFNode[] = nodes.value.map(n => ({ id: n.id, position: { ...n.position }, data: { ...n.data }, type: n.type, style: n.style }))
  // Keep existing positions from internalNodes
  const positionMap = new Map(internalNodes.value.map(n => [n.id, n.position]))
  builtNodes.forEach((n) => {
    const existing = positionMap.get(n.id)
    if (existing) n.position = existing
  })
  internalNodes.value = builtNodes
  
  // Update edges for animation
  const builtEdges: VFEdge[] = edges.value.map(e => ({ id: e.id, source: e.source, target: e.target, label: e.label, animated: e.animated }))
  internalEdges.value = builtEdges
}, { deep: true })

// Persist on any node movement
watch(internalNodes, () => savePositionsDebounced(props.flow?.id), { deep: true })

function onNodeClick(evt: any) {
  const id = evt?.node?.id || evt?.id
  if (id) emit('nodeSelected', { id })
}

function onAction(payload: { id: string, action: 'run' | 'logs' | 'details' }) {
  emit('nodeAction', payload)
}

// no-op placeholder removed (status styling handled inside FlowNodeCard)

function resetLayout() {
  const id = flowId.value
  if (!id) return
  try {
    localStorage.removeItem(storageKey(id))
  }
  catch {
    // ignore
  }
  // Rebuild nodes without saved positions
  const builtNodes: VFNode[] = nodes.value.map(n => ({ id: n.id, position: { ...n.position }, data: { ...n.data }, type: n.type }))
  internalNodes.value = builtNodes
}
</script>

<style scoped>
:deep(.vue-flow__node) {
  padding: 0;
  background: transparent;
  border: none;
  box-shadow: none;
  overflow: visible;
  display: inline-block;
}

/* Remove the blue frame from the special "input" node type */
:deep(.vue-flow__node-input) {
  border: none;
}

/* Remove selection/focus blue glow on nodes */
:deep(.vue-flow__node.selected),
:deep(.vue-flow__node:focus) {
  box-shadow: none;
  outline: none;
  border: none;
}
</style>
