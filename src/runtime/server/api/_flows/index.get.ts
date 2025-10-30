import { defineEventHandler, $useQueueRegistry } from '#imports'

export default defineEventHandler(() => {
  const registry = $useQueueRegistry() as any
  const flows = registry?.flows || {}
  const workers = registry?.workers || []

  // Create a map of workerId -> worker metadata for quick lookup
  const workerMetaMap = new Map()
  for (const worker of workers) {
    workerMetaMap.set(worker.id, {
      runtime: worker.kind === 'py' ? 'python' : 'nodejs',
      runtype: worker.runtype,
      queueCfg: worker.queueCfg,
      workerOpts: worker.worker,
      emits: worker.flow?.emits,
    })
  }

  // Return as an array for UI convenience, with runtime information added
  return Object.entries(flows).map(([id, meta]: any) => {
    // Add runtime to entry
    const workerMeta = meta?.entry ? workerMetaMap.get(meta.entry.workerId) : undefined
    const entry = meta?.entry
      ? {
          ...meta.entry,
          runtime: workerMeta?.runtime,
          runtype: workerMeta?.runtype,
          emits: workerMeta?.emits,
        }
      : undefined

    // Add runtime to each step
    const steps = meta?.steps
      ? Object.fromEntries(
          Object.entries(meta.steps).map(([stepName, stepData]: [string, any]) => {
            const stepWorkerMeta = workerMetaMap.get(stepData.workerId)
            return [
              stepName,
              {
                ...stepData,
                runtime: stepWorkerMeta?.runtime,
                runtype: stepWorkerMeta?.runtype,
                emits: stepWorkerMeta?.emits,
              },
            ]
          }),
        )
      : {}

    return {
      id,
      entry,
      steps,
    }
  })
})
