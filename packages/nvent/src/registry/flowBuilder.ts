import type { EventIndex, FlowSource, FlowsIndex } from './types'

export function buildFlows(flowSources: FlowSource[]) {
  const flows: FlowsIndex = {}
  const eventIndex: EventIndex = {}
  const seenFlowKeys = new Set<string>()

  for (const src of flowSources) {
    const { flow: f, queue, id } = src
    if (!f?.names?.length || !f.step) continue
    const rawSteps = Array.isArray(f.step) ? f.step : [f.step]
    const steps = rawSteps.filter((s): s is string => typeof s === 'string' && s.length > 0)
    if (steps.length === 0) continue

    for (const flowId of f.names) {
      if (!flows[flowId]) flows[flowId] = { steps: {} }
      const bucket = (flows[flowId] = flows[flowId] || { steps: {} })
      if (f.role === 'entry') {
        const mainStep = steps[0]!
        const key = `${flowId}:${f.role}:${mainStep}`
        if (!seenFlowKeys.has(key)) {
          seenFlowKeys.add(key)
          // Include all relevant fields from the flow config (emits, awaits, etc.)
          bucket.entry = {
            step: mainStep as string,
            queue,
            workerId: id,
            emits: f.emits,
            stepTimeout: f.stepTimeout,
            awaitBefore: f.awaitBefore,
            awaitAfter: f.awaitAfter,
          }
        }
        for (const s of steps.slice(1)) {
          const skey = `${flowId}:step:${s}`
          if (seenFlowKeys.has(skey)) continue
          seenFlowKeys.add(skey)
          bucket.steps[s] = {
            queue,
            workerId: id,
            subscribes: f.subscribes,
            emits: f.emits,
            stepTimeout: f.stepTimeout,
            awaitBefore: f.awaitBefore,
            awaitAfter: f.awaitAfter,
          }
        }
      }
      else {
        for (const s of steps) {
          const skey = `${flowId}:${f.role}:${s}`
          if (seenFlowKeys.has(skey)) continue
          seenFlowKeys.add(skey)
          bucket.steps[s] = {
            queue,
            workerId: id,
            subscribes: f.subscribes,
            emits: f.emits,
            stepTimeout: f.stepTimeout,
            awaitBefore: f.awaitBefore,
            awaitAfter: f.awaitAfter,
          }
        }
      }

      if (f.subscribes) {
        for (const kind of f.subscribes) {
          if (!eventIndex[kind]) eventIndex[kind] = []
          for (const s of steps) {
            eventIndex[kind].push({ flowId, step: s, queue, workerId: id })
          }
        }
      }
    }
  }

  return { flows, eventIndex }
}
