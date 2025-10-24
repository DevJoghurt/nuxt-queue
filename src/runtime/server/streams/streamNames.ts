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
