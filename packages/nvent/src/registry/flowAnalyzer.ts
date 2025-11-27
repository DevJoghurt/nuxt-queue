/**
 * Analyzes flow structure by examining emits and subscribes
 * to determine the execution order and relationships between steps
 */

import type { AwaitConfig } from './types'

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
  awaitBefore?: AwaitConfig
  awaitAfter?: AwaitConfig
}

interface FlowMeta {
  id: string
  entry?: FlowEntry
  steps?: Record<string, FlowStep>
}

interface AnalyzedStep extends FlowStep {
  name: string
  dependsOn: string[] // Direct dependencies (steps that must complete before this)
  triggers: string[] // Steps that this step triggers
  level: number // Execution level (0 = entry, 1 = first level, etc.)
  hasAwaitPattern?: boolean // Quick flag for runtime checks
}

interface AnalyzedFlow {
  id: string
  entry?: FlowEntry
  steps: Record<string, AnalyzedStep>
  levels: string[][] // Steps grouped by execution level
  maxLevel: number
  stallTimeout: number // Calculated based on await patterns (additive)
  awaitPatterns?: {
    steps: string[] // List of steps with await patterns
    beforeCount: number
    afterCount: number
    totalTimeout: number // Sum of all await timeouts
  }
}

/**
 * Parse a subscription token to extract its type and value
 * Formats: "step:name", "queue:name", "worker:name", or just "name"
 */
function parseSubscription(token: string): { type: 'step' | 'queue' | 'worker' | 'implicit', value: string } {
  const [prefix, ...rest] = token.split(':')
  if (rest.length > 0) {
    const type = prefix as 'step' | 'queue' | 'worker'
    return { type, value: rest.join(':') }
  }
  return { type: 'implicit', value: token }
}

/**
 * Find which step emits a given token
 */
function findEmitter(
  token: string,
  entryStep: string | undefined,
  steps: Record<string, FlowStep>,
): string | null {
  const { type, value } = parseSubscription(token)

  // Check entry step
  if (entryStep) {
    const entryEmits = steps[entryStep]?.emits || []
    if (entryEmits.includes(token) || entryEmits.includes(value)) {
      return entryStep
    }
  }

  // Check all steps
  for (const [stepName, step] of Object.entries(steps)) {
    const emits = step.emits || []

    // Direct match on full token
    if (emits.includes(token)) {
      return stepName
    }

    // Match based on type
    switch (type) {
      case 'step':
        if (stepName === value) return stepName
        break
      case 'queue':
        if (step.queue === value) return stepName
        break
      case 'worker':
        if (step.workerId === value) return stepName
        break
      case 'implicit':
        // Try matching as step name, queue, or emitted value
        if (stepName === value || step.queue === value || emits.includes(value)) {
          return stepName
        }
        break
    }
  }

  return null
}

/**
 * Build dependency graph by analyzing subscribes and emits
 */
function buildDependencyGraph(
  entryStep: string | undefined,
  steps: Record<string, FlowStep>,
): Record<string, string[]> {
  const dependencies: Record<string, string[]> = {}

  for (const [stepName, step] of Object.entries(steps)) {
    const deps = new Set<string>()

    const subscribes = step.subscribes || []
    for (const token of subscribes) {
      const emitter = findEmitter(token, entryStep, steps)
      if (emitter && emitter !== stepName) {
        deps.add(emitter)
      }
    }

    dependencies[stepName] = Array.from(deps)
  }

  return dependencies
}

/**
 * Calculate execution levels using topological sort
 */
function calculateLevels(
  entryStep: string | undefined,
  dependencies: Record<string, string[]>,
): Record<string, number> {
  const levels: Record<string, number> = {}
  const visited = new Set<string>()
  const visiting = new Set<string>()

  function visit(stepName: string): number {
    if (visited.has(stepName)) {
      return levels[stepName] ?? 0
    }

    if (visiting.has(stepName)) {
      // Circular dependency detected - assign current max level + 1
      console.warn(`Circular dependency detected involving step: ${stepName}`)
      return 0
    }

    visiting.add(stepName)

    const deps = dependencies[stepName] || []
    let maxDepLevel = -1

    // Entry step is always level 0
    if (stepName === entryStep) {
      maxDepLevel = -1
    }
    else if (deps.length === 0 && entryStep) {
      // No dependencies means it depends on entry
      maxDepLevel = 0
    }
    else {
      for (const dep of deps) {
        const depLevel = visit(dep)
        maxDepLevel = Math.max(maxDepLevel, depLevel)
      }
    }

    levels[stepName] = maxDepLevel + 1
    visiting.delete(stepName)
    visited.add(stepName)

    return levels[stepName]
  }

  // Visit all steps
  const allSteps = Object.keys(dependencies)
  for (const step of allSteps) {
    visit(step)
  }

  return levels
}

/**
 * Find which steps a given step triggers (based on what it emits)
 */
function findTriggeredSteps(
  stepName: string,
  step: FlowStep,
  allSteps: Record<string, FlowStep>,
): string[] {
  const emits = step.emits || []
  const triggered = new Set<string>()

  for (const [targetName, targetStep] of Object.entries(allSteps)) {
    if (targetName === stepName) continue

    const subscribes = targetStep.subscribes || []
    for (const token of subscribes) {
      // Check if this step emits what the target subscribes to
      const { type, value } = parseSubscription(token)

      let matches = false
      switch (type) {
        case 'step':
          matches = stepName === value
          break
        case 'queue':
          matches = step.queue === value
          break
        case 'worker':
          matches = step.workerId === value
          break
        case 'implicit':
          matches = stepName === value || step.queue === value || emits.includes(value)
          break
      }

      if (matches || emits.includes(token)) {
        triggered.add(targetName)
      }
    }
  }

  return Array.from(triggered)
}

/**
 * Calculate total timeout for a single step (awaitBefore + awaitAfter)
 */
function getStepAwaitTimeout(step: AnalyzedStep): number {
  let timeout = 0
  if (step.awaitBefore?.timeout) timeout += step.awaitBefore.timeout
  if (step.awaitAfter?.timeout) timeout += step.awaitAfter.timeout
  return timeout
}

/**
 * Calculate flow-level stall timeout based on await patterns
 *
 * Strategy:
 * - Within same level (parallel): use MAX timeout
 * - Across different levels (sequential): SUM timeouts
 * - Add buffer for processing time
 */
function calculateFlowStallTimeout(steps: Record<string, AnalyzedStep>, levels: string[][]): number {
  const DEFAULT_STALL_TIMEOUT = 30 * 60 * 1000 // 30 minutes
  const MIN_BUFFER = 5 * 60 * 1000 // 5 minutes
  const BUFFER_PERCENTAGE = 0.1 // 10%

  // Calculate max await timeout per level
  const levelTimeouts: number[] = []
  let awaitCount = 0

  for (const levelSteps of levels) {
    let maxLevelTimeout = 0

    for (const stepName of levelSteps) {
      const step = steps[stepName]
      if (!step) continue

      const stepTimeout = getStepAwaitTimeout(step)
      if (stepTimeout > 0) {
        awaitCount++
        maxLevelTimeout = Math.max(maxLevelTimeout, stepTimeout)
      }
    }

    if (maxLevelTimeout > 0) {
      levelTimeouts.push(maxLevelTimeout)
    }
  }

  // No awaits? Use default
  if (levelTimeouts.length === 0) {
    return DEFAULT_STALL_TIMEOUT
  }

  // Sum across levels (sequential execution)
  const totalAwaitTimeout = levelTimeouts.reduce((sum, timeout) => sum + timeout, 0)

  // Calculate timeout with buffer
  // Add 10% buffer or 5 minutes (whichever is larger) for processing time
  const buffer = Math.max(totalAwaitTimeout * BUFFER_PERCENTAGE, MIN_BUFFER)
  const calculatedTimeout = totalAwaitTimeout + buffer

  // Log if significantly different from default
  if (calculatedTimeout > DEFAULT_STALL_TIMEOUT * 2) {
    console.log(
      `[flow-analyzer] Flow has ${awaitCount} await patterns across ${levelTimeouts.length} levels, `
      + `calculated stall timeout: ${calculatedTimeout / 1000}s `
      + `(total await time: ${totalAwaitTimeout / 1000}s, level timeouts: [${levelTimeouts.map(t => `${t / 1000}s`).join(', ')}])`,
    )
  }

  return calculatedTimeout
}

/**
 * Analyze flow structure and relationships
 */
export function analyzeFlow(flow: FlowMeta): AnalyzedFlow {
  const entryStepName = flow.entry?.step
  const steps = flow.steps || {}

  // Build dependency graph
  const dependencies = buildDependencyGraph(entryStepName, steps)

  // Calculate execution levels
  const levels = calculateLevels(entryStepName, dependencies)

  // Build analyzed steps
  const analyzedSteps: Record<string, AnalyzedStep> = {}
  for (const [stepName, step] of Object.entries(steps)) {
    const hasAwaitPattern = !!(step.awaitBefore || step.awaitAfter)
    analyzedSteps[stepName] = {
      ...step,
      name: stepName,
      dependsOn: dependencies[stepName] || [],
      triggers: findTriggeredSteps(stepName, step, steps),
      level: levels[stepName] ?? 1,
      hasAwaitPattern,
    }
  }

  // Group steps by level
  const maxLevel = Math.max(0, ...Object.values(levels))
  const levelGroups: string[][] = Array.from({ length: maxLevel + 1 }, () => [])

  for (const [stepName, level] of Object.entries(levels)) {
    const levelArray = levelGroups[level]
    if (levelArray) {
      levelArray.push(stepName)
    }
  }

  // Calculate stall timeout based on await patterns (needs levelGroups)
  const stallTimeout = calculateFlowStallTimeout(analyzedSteps, levelGroups)

  // Generate flow-level await summary
  const awaitSteps = Object.values(analyzedSteps).filter(s => s.hasAwaitPattern)
  const totalTimeout = awaitSteps.reduce((sum, s) => {
    let stepTimeout = 0
    if (s.awaitBefore?.timeout) stepTimeout += s.awaitBefore.timeout
    if (s.awaitAfter?.timeout) stepTimeout += s.awaitAfter.timeout
    return sum + stepTimeout
  }, 0)

  const awaitPatterns = awaitSteps.length > 0
    ? {
        steps: awaitSteps.map(s => s.name),
        beforeCount: awaitSteps.filter(s => s.awaitBefore).length,
        afterCount: awaitSteps.filter(s => s.awaitAfter).length,
        totalTimeout,
      }
    : undefined

  return {
    id: flow.id,
    entry: flow.entry,
    steps: analyzedSteps,
    levels: levelGroups,
    maxLevel,
    stallTimeout,
    awaitPatterns,
  }
}
