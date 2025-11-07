import {
  defineNitroPlugin,
  getActivePeerCount,
  getActivePeers,
  setShuttingDown,
  clearAllPeers,
  isServerShuttingDown,
  useServerLogger,
} from '#imports'

const logger = useServerLogger('plugin-ws-lifecycle')

/**
 * Nitro plugin to handle graceful WebSocket shutdown during HMR
 */
export default defineNitroPlugin((nitroApp) => {
  logger.info('[ws-lifecycle] WebSocket lifecycle plugin initialized')

  // Suppress WebSocket ECONNRESET errors during shutdown
  // These are expected when we're closing connections
  const originalUnhandledRejection = process.listeners('unhandledRejection')

  // Hook into Nitro's close event to gracefully close all WebSocket connections
  nitroApp.hooks.hook('close', async () => {
    setShuttingDown(true)

    const peerCount = getActivePeerCount()
    if (peerCount === 0) {
      logger.info('[ws-lifecycle] No active WebSocket connections to close')
      return
    }

    logger.info(`[ws-lifecycle] Closing ${peerCount} active WebSocket connections...`)

    const closePromises: Promise<void>[] = []
    const peers = getActivePeers()

    for (const peer of peers) {
      closePromises.push(
        new Promise<void>((resolve) => {
          try {
            // Send a close message before disconnecting
            peer.send(JSON.stringify({
              type: 'server-restart',
              message: 'Server is restarting (HMR)',
            }))

            // Wait longer to ensure message is sent and any pending reads complete
            setTimeout(() => {
              try {
                peer.close(1001, 'Server restarting')
              }
              catch {
                // Ignore errors, connection might already be closed
              }
              resolve()
            }, 200)
          }
          catch {
            // If send fails, just close immediately
            try {
              peer.close(1001, 'Server restarting')
            }
            catch {
              // Ignore
            }
            resolve()
          }
        }),
      )
    }

    await Promise.all(closePromises)
    clearAllPeers()
    logger.info('[ws-lifecycle] All WebSocket connections closed')

    // Reset shutdown flag after a delay
    setTimeout(() => {
      setShuttingDown(false)
    }, 500)
  })

  // Suppress WebSocket-related ECONNRESET errors during shutdown
  process.on('unhandledRejection', (reason: any) => {
    // During shutdown, suppress WebSocket connection errors
    if (isServerShuttingDown() && reason?.code === 'ECONNRESET') {
      // Silently ignore ECONNRESET during shutdown
      return
    }
    // Re-emit for other handlers
    for (const handler of originalUnhandledRejection) {
      if (typeof handler === 'function') {
        handler(reason, Promise.reject(reason))
      }
    }
  })
})
