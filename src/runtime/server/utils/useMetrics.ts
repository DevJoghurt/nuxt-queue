type Labels = Record<string, string>

type CounterStore = Map<string, Map<string, number>>

const counters: CounterStore = new Map()

const HELP: Record<string, string> = {
  queue_job_events_total: 'Queue job events',
  runner_emits_total: 'Runner emitted events',
  flow_enqueues_total: 'Flow step enqueues by trigger',
}

function labelsKey(labels: Labels): string {
  const keys = Object.keys(labels).sort()
  return keys.map(k => `${k}="${String(labels[k])}"`).join(',')
}

function incCounter(name: string, labels: Labels = {}, value = 1) {
  let series = counters.get(name)
  if (!series) {
    series = new Map<string, number>()
    counters.set(name, series)
  }
  const key = labelsKey(labels)
  const prev = series.get(key) || 0
  series.set(key, prev + value)
}

function getPrometheusMetricsText(): string {
  const lines: string[] = []
  for (const [name, series] of counters.entries()) {
    const help = HELP[name]
    if (help) lines.push(`# HELP ${name} ${help}`)
    lines.push(`# TYPE ${name} counter`)
    for (const [labelKey, value] of series.entries()) {
      const lbl = labelKey ? `{${labelKey}}` : ''
      lines.push(`${name}${lbl} ${value}`)
    }
  }
  return lines.join('\n') + '\n'
}

function resetMetrics() {
  counters.clear()
}

export function useMetrics() {
  return {
    incCounter,
    getPrometheusMetricsText,
    resetMetrics,
  }
}
