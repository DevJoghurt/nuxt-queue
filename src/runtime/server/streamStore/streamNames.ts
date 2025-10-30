import { useRuntimeConfig } from '#imports'

export interface StreamNamesConfig {
  global?: string
  job?: string | ((id: string) => string)
  queue?: string | ((name: string) => string)
  flow?: string | ((name: string) => string)
}

function defaults(): Required<StreamNamesConfig> {
  return {
    global: 'nq:events',
    job: (id: string) => `nq:job:${id}`,
    queue: (name: string) => `nq:queue:${name}`,
    flow: (runId: string) => `nq:flow:${runId}`,
  }
}

// Internal names getter without `use` prefix; utils wrapper will expose useStreamNames
export function getStreamNames() {
  const rc: any = useRuntimeConfig()
  const cfg: StreamNamesConfig = rc?.queue?.eventStore?.streams || {}
  const d = defaults()
  return {
    global: cfg.global || d.global,
    job: typeof cfg.job === 'string' ? (id: string) => `${cfg.job}${id}` : cfg.job || d.job,
    queue: typeof cfg.queue === 'string' ? (name: string) => `${cfg.queue}${name}` : cfg.queue || d.queue,
    flow: typeof cfg.flow === 'string' ? (runId: string) => `${cfg.flow}${runId}` : cfg.flow || d.flow,
  }
}

export default getStreamNames

// Projections naming
export interface ProjectionStreamNamesConfig {
  prefix?: string
  flowRuns?: string | ((flowName: string) => string)
  flowRunList?: string | ((flowName: string) => string)
  flowSnapshot?: string | ((flowName: string, flowId: string) => string)
  flowSteps?: string | ((flowId: string) => string)
  flowStepLogIndex?: string | ((flowId: string) => string)
}

export function getProjectionStreamNames() {
  const rc: any = useRuntimeConfig()
  const cfg: ProjectionStreamNamesConfig = rc?.queue?.eventStore?.streams?.projections || {}
  const prefix = typeof cfg.prefix === 'string' ? cfg.prefix : 'nq:proj:'

  const flowRuns = cfg.flowRuns
    ? (typeof cfg.flowRuns === 'string'
        ? (flowName: string) => `${cfg.flowRuns}${flowName}`
        : cfg.flowRuns)
    : (flowName: string) => `${prefix}flow-runs:${flowName}`

  const flowRunList = cfg.flowRunList
    ? (typeof cfg.flowRunList === 'string'
        ? (flowName: string) => `${cfg.flowRunList}${flowName}`
        : cfg.flowRunList)
    : (flowName: string) => `${prefix}flow:${flowName}`

  const flowSnapshot = cfg.flowSnapshot
    ? (typeof cfg.flowSnapshot === 'string'
        ? (flowName: string, flowId: string) => `${cfg.flowSnapshot}${flowName}:${flowId}`
        : cfg.flowSnapshot)
    : (flowName: string, flowId: string) => `${prefix}flow:${flowName}:${flowId}`

  const flowSteps = cfg.flowSteps
    ? (typeof cfg.flowSteps === 'string'
        ? (flowId: string) => `${cfg.flowSteps}${flowId}`
        : cfg.flowSteps)
    : (flowId: string) => `${prefix}flow-steps:${flowId}`

  const flowStepLogIndex = cfg.flowStepLogIndex
    ? (typeof cfg.flowStepLogIndex === 'string'
        ? (flowId: string) => `${cfg.flowStepLogIndex}${flowId}`
        : cfg.flowStepLogIndex)
    : (flowId: string) => `${prefix}flow-step-index:${flowId}`

  return {
    base: getStreamNames(),
    flowRuns,
    flowRunList,
    flowSnapshot,
    flowSteps,
    flowStepLogIndex,
  }
}

export type ProjectionStreamNames = ReturnType<typeof getProjectionStreamNames>
