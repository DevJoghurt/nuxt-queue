import { onMounted, onBeforeUnmount } from '#imports'

export type EventCompleted = {
  jobId: string
  returnvalue: any
  prev?: any
}

export type EventActive = {
  jobId: string
  prev?: any
}

export type EventWaiting = {
  jobId: string
  prev?: any
}

export type EventProgress = {
  jobId: string
  data: any
}

export type EventAdded = {
  jobId: string
  name: string
}

export type EventFailed = {
  jobId: string
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
      const { eventType = '', message = {} } = JSON.parse(event.data)
      if (eventType === 'completed' && events.onCompleted) events.onCompleted(message)
      if (eventType === 'active' && events.onActive) events.onActive(message)
      if (eventType === 'progress' && events.onProgress) events.onProgress(message)
      if (eventType === 'added' && events.onAdded) events.onAdded(message)
      if (eventType === 'failed' && events.onFailed) events.onFailed(message)
      if (eventType === 'waiting' && events.onWaiting) events.onWaiting(message)
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
