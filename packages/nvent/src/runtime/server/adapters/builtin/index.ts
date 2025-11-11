/**
 * Built-in Adapters
 *
 * In-memory and file-based adapters for development (no external dependencies)
 */

// Memory adapters (ephemeral, no persistence)
export { MemoryQueueAdapter } from './memory-queue'
export { MemoryStreamAdapter } from './memory-stream'
export { MemoryStoreAdapter } from './memory-store'

// File adapters (persisted to disk, survives restarts)
// Note: File deployments use MemoryStreamAdapter (no separate file stream adapter needed)
export { FileQueueAdapter } from './file-queue'
export { FileStoreAdapter } from './file-store'
