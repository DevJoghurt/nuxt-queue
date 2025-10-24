import type { EventRecord } from '../streams/types'

type Handler = (e: EventRecord) => void

type BusStore = {
  streamSubs: Map<string, Set<Handler>>
  kindSubs: Map<string, Set<Handler>>
}

// Ensure a single bus across Nitro HMR and module reloads
declare global {
  var __nq_bus: BusStore | undefined
}

const store: BusStore = globalThis.__nq_bus ??= {
  streamSubs: new Map<string, Set<Handler>>(),
  kindSubs: new Map<string, Set<Handler>>(),
}

function publish(event: EventRecord) {
  const s = store.streamSubs.get(event.stream)
  if (s) for (const h of s) h(event)
  const k = store.kindSubs.get(event.kind)
  if (k) for (const h of k) h(event)
}

function subscribeStream(stream: string, handler: Handler) {
  let set = store.streamSubs.get(stream)
  if (!set) {
    set = new Set<Handler>()
    store.streamSubs.set(stream, set)
  }
  set.add(handler)
  return () => {
    set!.delete(handler)
    if (set!.size === 0) store.streamSubs.delete(stream)
  }
}

function onKind(kind: string, handler: Handler) {
  let set = store.kindSubs.get(kind)
  if (!set) {
    set = new Set<Handler>()
    store.kindSubs.set(kind, set)
  }
  set.add(handler)
  return () => {
    set!.delete(handler)
    if (set!.size === 0) store.kindSubs.delete(kind)
  }
}

export const eventBus = { publish, subscribeStream, onKind }

export function getEventBus() {
  return eventBus
}
