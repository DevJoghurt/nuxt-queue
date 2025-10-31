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
          ref="vueFlowRef"
          v-model:nodes="internalNodes"
          v-model:edges="internalEdges"
          :fit-view-on-init="true"
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
import { computed, ref, watch, nextTick } from '#imports'
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

interface AnalyzedStep extends FlowStep {
  name: string
  dependsOn: string[]
  triggers: string[]
  level: number
}

interface FlowMeta {
  id: string
  entry?: FlowEntry
  steps?: Record<string, FlowStep>
  analyzed?: {
    levels: string[][]
    maxLevel: number
    steps: Record<string, AnalyzedStep>
  }
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
const vueFlowRef = ref<any>(null)

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
  
  const states = props.stepStates || {}
  const colWidth = 250
  const rowHeight = 140
  const horizontalGap = 50
  const verticalGap = 80
  const entryToStepsGap = 140 // Extra gap between entry and first step row
  const nodeWidth = 220
  
  let y = 0
  
  // Entry node (centered) - offset by half width to center properly
  if (f.entry) {
    const entryState = states[f.entry.step]
    const status = mapStatusToNodeStatus(entryState?.status)

    out.push({
      id: `entry:${f.entry.step}`,
      position: { x: -nodeWidth / 2, y: y },
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
      style: { minWidth: `${nodeWidth}px` },
    })
    y += rowHeight + entryToStepsGap
  }
  
  // Use analyzed levels if available, otherwise fall back to simple grid
  const steps = f.steps || {}
  
  // Debug: log what we received
  if (f.analyzed) {
    console.log('[FlowDiagram] Analyzed data:', {
      levels: f.analyzed.levels,
      maxLevel: f.analyzed.maxLevel,
      stepsCount: Object.keys(f.analyzed.steps || {}).length,
    })
  }
  
  if (f.analyzed?.levels && f.analyzed.levels.length > 0) {
    // Use analyzed levels for better layout
    const levels = f.analyzed.levels.filter(level => level.length > 0) // Skip empty levels
    
    levels.forEach((levelSteps) => {
      if (levelSteps.length === 0) return
      
      const cols = Math.min(4, levelSteps.length) // Max 4 columns per level
      const rows = Math.ceil(levelSteps.length / cols)
      
      levelSteps.forEach((stepName, idx) => {
        const step = steps[stepName]
        if (!step) return
        
        const stepState = states[stepName]
        const status = mapStatusToNodeStatus(stepState?.status)
        
        const col = idx % cols
        const row = Math.floor(idx / cols)
        
        // Calculate how many nodes are in this specific row within this level
        const remainingInLevel = levelSteps.length - (row * cols)
        const nodesInThisRow = Math.min(cols, remainingInLevel)
        
        // Center this row based on its actual node count
        const rowWidth = nodesInThisRow * colWidth + (nodesInThisRow - 1) * horizontalGap
        const rowStartX = -rowWidth / 2
        
        const x = rowStartX + col * (colWidth + horizontalGap)
        const yPos = y + row * (rowHeight + verticalGap)

        out.push({
          id: `step:${stepName}`,
          position: { x, y: yPos },
          data: {
            label: stepName,
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
          style: { minWidth: `${nodeWidth}px` },
        })
      })
      
      // Move Y down for next level (account for all rows in this level)
      y += rows * (rowHeight + verticalGap)
    })
  }
  else {
    // Fallback: simple grid layout
    const names = Object.keys(steps)
    const cols = 3
    
    names.forEach((name, idx) => {
      const step = steps[name]
      const stepState = states[name]
      const status = mapStatusToNodeStatus(stepState?.status)
      
      const col = idx % cols
      const row = Math.floor(idx / cols)
      
      // Calculate how many nodes are in this specific row
      const totalRows = Math.ceil(names.length / cols)
      const isLastRow = row === totalRows - 1
      const nodesInThisRow = isLastRow ? (names.length % cols || cols) : cols
      
      // Center this row based on its actual node count
      const rowWidth = nodesInThisRow * colWidth + (nodesInThisRow - 1) * horizontalGap
      const rowStartX = -rowWidth / 2
      
      const x = rowStartX + col * (colWidth + horizontalGap)
      const yPos = y + row * (rowHeight + verticalGap)

      out.push({
        id: `step:${name}`,
        position: { x, y: yPos },
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
        style: { minWidth: `${nodeWidth}px` },
      })
    })
  }
  
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

  // Always use analyzed dependencies
  if (f.analyzed?.steps) {
    const analyzedSteps = f.analyzed.steps
    
    // Add edges based on analyzed dependencies
    for (const [stepName, stepInfo] of Object.entries(analyzedSteps)) {
      const target = `step:${stepName}`
      
      if (stepInfo.dependsOn.length > 0) {
        // Add edges from dependencies
        for (const depName of stepInfo.dependsOn) {
          const source = depName === f.entry?.step ? `entry:${depName}` : `step:${depName}`
          addEdge(source, target)
        }
      }
      else if (f.entry) {
        // No dependencies means it depends on entry
        addEdge(`entry:${f.entry.step}`, target)
      }
    }
  }
  else {
    console.warn('[FlowDiagram] No analyzed data available for edges')
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
  
  // Trigger fit view after nodes are rendered
  setTimeout(() => {
    if (vueFlowRef.value) {
      vueFlowRef.value.fitView({ padding: 0.2, duration: 200 })
    }
  }, 100)
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
  
  // Get fresh positions from computed nodes (without saved positions)
  const freshNodes: VFNode[] = nodes.value.map(n => ({
    id: n.id,
    position: { x: n.position.x, y: n.position.y },
    data: { ...n.data },
    type: n.type,
    style: n.style,
  }))
  
  // Update internal nodes with fresh positions
  internalNodes.value = freshNodes
  
  // Use Vue Flow's fitView to center and zoom the diagram
  nextTick(() => {
    if (vueFlowRef.value) {
      vueFlowRef.value.fitView({
        padding: 0.2,
        includeHiddenNodes: false,
        duration: 300,
      })
    }
  })
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
