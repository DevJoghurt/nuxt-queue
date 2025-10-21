import type { EventRecord } from './contracts'

type Handler = (e: EventRecord) => void

const streamSubs = new Map<string, Set<Handler>>()
const kindSubs = new Map<string, Set<Handler>>()

function publish(event: EventRecord) {
  const s = streamSubs.get(event.stream)
  if (s) s.forEach(h => h(event))
  const k = kindSubs.get(event.kind)
  if (k) k.forEach(h => h(event))
}

function subscribeStream(stream: string, handler: Handler) {
  let set = streamSubs.get(stream)
  if (!set) {
    set = new Set<Handler>()
    streamSubs.set(stream, set)
  }
  set.add(handler)
  return () => set!.delete(handler)
}

function onKind(kind: string, handler: Handler) {
  let set = kindSubs.get(kind)
  if (!set) {
    set = new Set<Handler>()
    kindSubs.set(kind, set)
  }
  set.add(handler)
  return () => set!.delete(handler)
}

export function useEventBus() {
  return {
    publish,
    subscribeStream,
    onKind,
  }
}
