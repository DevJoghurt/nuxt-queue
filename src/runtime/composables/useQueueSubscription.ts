import { onMounted, onBeforeUnmount } from '#imports'

export type EventCompleted = {
  id: string
  returnvalue: any
  prev?: any
}

export type EventActive = {
  id: string
  prev?: any
}

export type EventWaiting = {
  id: string
  prev?: any
}

export type EventProgress = {
  id: string
  progress: any
}

export type EventAdded = {
  id: string
  name: string
}

export type EventFailed = {
  id: string
  failedReason: any
  prev?: any
}

export type Event = {
  eventType: string
  job: EventCompleted | EventActive | EventProgress | EventAdded
}

export default function useQueueSubscription(id: string, events: {
  onCompleted?: (event: EventCompleted) => void
  onActive?: (event: EventActive) => void
  onProgress?: (event: EventProgress) => void
  onAdded?: (event: EventAdded) => void
  onFailed?: (event: EventFailed) => void
  onWaiting?: (event: EventWaiting) => void
}) {
  let ws: WebSocket | undefined

  const subscribe = async () => {
    const isSecure = location.protocol === 'https:'
    const url = (isSecure ? 'wss://' : 'ws://') + location.host + '/api/_queue/ws?id=' + id
    console.log('ws', 'Connecting to', url, '...')
    ws = new WebSocket(url)
    ws.addEventListener('message', (event) => {
      const { eventType = '', job = {} } = JSON.parse(event.data)
      if (eventType === 'completed' && events.onCompleted) events.onCompleted(job)
      if (eventType === 'active' && events.onActive) events.onActive(job)
      if (eventType === 'progress' && events.onProgress) events.onProgress(job)
      if (eventType === 'added' && events.onAdded) events.onAdded(job)
      if (eventType === 'failed' && events.onFailed) events.onFailed(job)
      if (eventType === 'waiting' && events.onWaiting) events.onWaiting(job)
      console.log(eventType, job)
    })
    await new Promise(resolve => ws!.addEventListener('open', resolve))
  }

  onMounted(async () => {
    await subscribe()
  })

  onBeforeUnmount(() => {
    ws?.close()
  })
}
