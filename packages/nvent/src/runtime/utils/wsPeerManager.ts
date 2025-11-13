/**
 * WebSocket Peer Manager
 *
 * Tracks active WebSocket connections for graceful shutdown during HMR.
 * Auto-imported in Nitro server context.
 */

/**
 * Track active WebSocket peers globally
 */
const activePeers = new Set<any>()

/**
 * Flag indicating if server is shutting down
 */
let isShuttingDown = false

/**
 * Register a peer to be tracked for graceful shutdown
 */
function registerWsPeer(peer: any) {
  activePeers.add(peer)
}

/**
 * Unregister a peer (called when connection closes normally)
 */
function unregisterWsPeer(peer: any) {
  activePeers.delete(peer)
}

/**
 * Get all currently active WebSocket peers
 */
function getActivePeers() {
  return Array.from(activePeers)
}

/**
 * Check if server is currently shutting down
 */
function isServerShuttingDown() {
  return isShuttingDown
}

/**
 * Set the shutdown state
 */
function setShuttingDown(state: boolean) {
  isShuttingDown = state
}

/**
 * Clear all tracked peers
 */
function clearAllPeers() {
  activePeers.clear()
}

/**
 * Get the count of active peers
 */
function getActivePeerCount() {
  return activePeers.size
}

export const usePeerManager = () => ({
  registerWsPeer,
  unregisterWsPeer,
  getActivePeers,
  isServerShuttingDown,
  setShuttingDown,
  clearAllPeers,
  getActivePeerCount,
})
