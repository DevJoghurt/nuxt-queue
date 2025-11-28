/**
 * Instance ID Management
 *
 * Provides a stable instance identifier for the current process.
 * Useful for:
 * - Debugging and observability (which instance processed what)
 * - Sticky sessions (routing flows to the same instance)
 * - Distributed coordination (future: lock ownership, leader election)
 * - Instance-specific caching and state management
 */

import { randomUUID } from 'node:crypto'
import { hostname } from 'node:os'

let instanceId: string | null = null

/**
 * Get or create a stable instance ID for this process
 * Format: hostname-pid-uuid
 * Example: server-01-12345-a1b2c3d4
 *
 * The ID is stable for the lifetime of the process and includes:
 * - hostname: Identifies the physical/virtual machine
 * - pid: Distinguishes multiple processes on the same machine
 * - uuid: Ensures uniqueness even if PID is reused
 */
export function getInstanceId(): string {
  if (!instanceId) {
    const host = hostname().toLowerCase().replace(/[^a-z0-9-]/g, '-')
    const pid = process.pid
    const uuid = randomUUID().split('-')[0] // Use first segment for brevity
    instanceId = `${host}-${pid}-${uuid}`
  }
  return instanceId
}

/**
 * Reset instance ID (primarily for testing)
 */
export function resetInstanceId(): void {
  instanceId = null
}

/**
 * Check if an event/operation belongs to this instance
 */
export function isLocalInstance(eventInstanceId?: string): boolean {
  if (!eventInstanceId) return false
  return eventInstanceId === getInstanceId()
}
