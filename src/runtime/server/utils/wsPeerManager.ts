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
export function registerWsPeer(peer: any) {
  activePeers.add(peer)
}

/**
 * Unregister a peer (called when connection closes normally)
 */
export function unregisterWsPeer(peer: any) {
  activePeers.delete(peer)
}

/**
 * Get all currently active WebSocket peers
 */
export function getActivePeers() {
  return Array.from(activePeers)
}

/**
 * Check if server is currently shutting down
 */
export function isServerShuttingDown() {
  return isShuttingDown
}

/**
 * Set the shutdown state
 */
export function setShuttingDown(state: boolean) {
  isShuttingDown = state
}

/**
 * Clear all tracked peers
 */
export function clearAllPeers() {
  activePeers.clear()
}

/**
 * Get the count of active peers
 */
export function getActivePeerCount() {
  return activePeers.size
}
