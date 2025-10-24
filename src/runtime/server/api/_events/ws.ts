import { useEventManager, defineWebSocketHandler } from '#imports'

const unsubMap = new WeakMap<any, () => void>()

export default defineWebSocketHandler({
  open(_peer) {
    // no-op; clients should send { type: 'subscribe', stream } messages
  },
  async message(peer, message) {
    try {
      const payload = JSON.parse(String(message)) as any
      const { subscribeStream } = useEventManager()
      if (payload?.type === 'subscribe' && typeof payload.stream === 'string') {
        const unsub = subscribeStream(payload.stream, (e) => {
          peer.send(JSON.stringify({ v: 1, stream: payload.stream, event: e.kind, record: e }))
        })
        unsubMap.set(peer, unsub)
        peer.send(JSON.stringify({ ok: true, subscribed: payload.stream }))
      }
      if (payload?.type === 'unsubscribe') {
        const unsub = unsubMap.get(peer)
        if (unsub) unsub()
        peer.send(JSON.stringify({ ok: true, unsubscribed: true }))
      }
    }
    catch {
      // ignore malformed frames
    }
  },
  close(peer) {
    const unsub = unsubMap.get(peer)
    if (unsub) unsub()
    unsubMap.delete(peer)
  },
})
