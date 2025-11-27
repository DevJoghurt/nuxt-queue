/**
 * Store Adapter Interface
 *
 * Three-tier storage system:
 * 1. Event Stream - Append-only event log
 * 2. Sorted Index - Time-ordered metadata storage
 * 3. Key-Value Store - Fast lookups (for state, caching)
 */

export interface StoreAdapter {
  /**
   * Close/cleanup the adapter
   */
  close(): Promise<void>

  // ============================================================
  // Event Stream (append-only event log)
  // ============================================================

  stream: {
    /**
     * Append an event to a subject's event stream
     * @param subject - Event stream identifier (e.g., 'nq:flow:abc-123')
     * @param event - Event to append (id and ts will be auto-generated)
     * @returns The complete event record with generated id and timestamp
     */
    append(subject: string, event: Omit<EventRecord, 'id' | 'ts'>): Promise<EventRecord>

    /**
     * Read events from a subject's event stream
     * @param subject - Event stream identifier
     * @param opts - Query options (filtering, pagination, etc.)
     * @returns Array of event records
     */
    read(subject: string, opts?: EventReadOptions): Promise<EventRecord[]>

    /**
     * Subscribe to new events in a subject's event stream (optional, not all adapters support this)
     * @param subject - Event stream identifier (supports wildcards if adapter allows)
     * @param onEvent - Callback for new events
     * @returns Subscription handle for unsubscribing
     */
    subscribe?(subject: string, onEvent: (event: EventRecord) => void): Promise<EventSubscription>

    /**
     * Delete an entire event stream
     * @param subject - Event stream identifier
     * @returns True if stream was deleted, false if not found
     */
    delete?(subject: string): Promise<boolean>
  }

  // ============================================================
  // Key-Value Store (fast lookups)
  // ============================================================

  kv: {
    /**
     * Get a value by key
     */
    get<T = any>(key: string): Promise<T | null>

    /**
     * Set a value with optional TTL
     * @param key - Key
     * @param value - Value to store
     * @param ttl - Time to live in seconds (optional)
     */
    set<T = any>(key: string, value: T, ttl?: number): Promise<void>

    /**
     * Delete a key
     */
    delete(key: string): Promise<void>

    /**
     * Delete all keys matching a pattern (optional, not all adapters support patterns)
     * @returns Number of keys deleted
     */
    clear?(pattern: string): Promise<number>

    /**
     * Atomic increment operation (optional, for counters)
     * @returns New value after increment
     */
    increment?(key: string, by?: number): Promise<number>
  }

  // ============================================================
  // Sorted Index (for time-ordered listings)
  // ============================================================

  index: {
    /**
     * Add entry to a sorted index
     * @param key - Index key (e.g., 'nq:flows:flowName')
     * @param id - Entry ID
     * @param score - Sort score (typically timestamp)
     * @param metadata - Optional metadata to store with entry
     */
    add(key: string, id: string, score: number, metadata?: Record<string, any>): Promise<void>

    /**
     * Get a single entry from a sorted index
     * @param key - Index key
     * @param id - Entry ID
     * @returns Entry with score and metadata, or null if not found
     */
    get(key: string, id: string): Promise<{ id: string, score: number, metadata?: any } | null>

    /**
     * Read entries from a sorted index (ordered by score descending)
     * @param key - Index key
     * @param opts - Pagination options
     * @param opts.offset - Number of entries to skip
     * @param opts.limit - Maximum number of entries to return
     * @returns Array of entries with scores and metadata
     */
    read(key: string, opts?: { offset?: number, limit?: number }): Promise<Array<{ id: string, score: number, metadata?: any }>>

    /**
     * Update metadata for an entry in a sorted index
     * @param key - Index key
     * @param id - Entry ID
     * @param metadata - Metadata to update
     * @returns True if update succeeded, false if version conflict
     */
    update(key: string, id: string, metadata: Record<string, any>): Promise<boolean>

    /**
     * Update with automatic retries on version conflicts
     * @param key - Index key
     * @param id - Entry ID
     * @param metadata - Metadata to update
     * @param maxRetries - Maximum retry attempts (default: 3)
     */
    updateWithRetry(key: string, id: string, metadata: Record<string, any>, maxRetries?: number): Promise<void>

    /**
     * Atomic increment of a metadata field in an index entry
     * @param key - Index key
     * @param id - Entry ID
     * @param field - Field name to increment
     * @param increment - Amount to increment by (default: 1)
     * @returns New value after increment
     */
    increment(key: string, id: string, field: string, increment?: number): Promise<number>

    /**
     * Delete an entry from a sorted index
     * @param key - Index key
     * @param id - Entry ID
     * @returns True if entry was deleted, false if not found
     */
    delete(key: string, id: string): Promise<boolean>
  }
}

// ============================================================
// Supporting Types
// ============================================================

/**
 * Event record in the event stream
 * This is the storage representation - converts FlowEvent to/from storage format
 */
export interface EventRecord {
  id: string // Auto-generated stream ID
  ts: number // Unix timestamp in milliseconds
  type: string // Event type
  runId: string // Flow run UUID
  flowName: string // Flow definition name
  stepName?: string // Step name (for step events)
  stepId?: string // Step ID (for step events)
  attempt?: number // Attempt number (for step events)
  data?: any // Event-specific data payload
}

/**
 * Options for reading events from the event stream
 */
export interface EventReadOptions {
  /**
   * Filter by event types
   */
  types?: string[]

  /**
   * Read events after this ID
   */
  after?: string

  /**
   * Read events before this ID
   */
  before?: string

  /**
   * Read events from this timestamp
   */
  from?: number

  /**
   * Read events until this timestamp
   */
  to?: number

  /**
   * Maximum number of events to return
   */
  limit?: number

  /**
   * Sort order ('asc' or 'desc')
   */
  order?: 'asc' | 'desc'
}

/**
 * Subscription handle for event stream subscriptions
 */
export interface EventSubscription {
  id: string
  subject: string
  unsubscribe: () => Promise<void>
}

/**
 * Options for listing documents
 */
export interface ListOptions {
  /**
   * Filter documents by field values
   */
  filter?: Record<string, any>

  /**
   * Maximum number of documents to return
   */
  limit?: number

  /**
   * Number of documents to skip
   */
  offset?: number

  /**
   * Sort by field
   */
  sortBy?: string

  /**
   * Sort order
   */
  order?: 'asc' | 'desc'
}
