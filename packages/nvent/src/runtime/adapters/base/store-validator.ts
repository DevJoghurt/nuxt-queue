/**
 * Store Adapter Validation
 *
 * Centralized validation logic for index updates to ensure correct usage
 * across all store adapter implementations.
 */

export interface StoreValidatorOptions {
  /** Adapter name for error messages */
  adapterName: string
  /** Enable counter misuse warnings (default: true in development) */
  warnCounters?: boolean
  /** Throw errors on validation failures (default: true) */
  throwOnError?: boolean
}

export class StoreValidator {
  private readonly adapterName: string
  private readonly warnCounters: boolean
  private readonly throwOnError: boolean

  constructor(options: StoreValidatorOptions) {
    this.adapterName = options.adapterName
    this.warnCounters = options.warnCounters ?? (process.env.NODE_ENV === 'development')
    this.throwOnError = options.throwOnError ?? true
  }

  /**
   * Validate index update payload
   * Throws error if dot notation keys are detected (except 'version')
   * Recursively checks all nested objects
   */
  validateUpdatePayload(payload: Record<string, any>, method: string): void {
    // Recursively check for dot notation keys at any level
    this.checkDotNotationKeys(payload, method, [])

    // Warn about potential counter misuse
    if (this.warnCounters) {
      this.detectCounterMisuse(payload, method)
    }
  }

  /**
   * Recursively check for dot notation in object keys
   */
  private checkDotNotationKeys(obj: Record<string, any>, method: string, path: string[]): void {
    for (const key of Object.keys(obj)) {
      const currentPath = [...path, key]

      // Check if this key contains dots (except 'version' at any level)
      if (key.includes('.') && key !== 'version') {
        const fullPath = currentPath.join('.')
        const suggestion = this.buildNestedObjectSuggestion(key)
        const message = [
          `[${this.adapterName}] Invalid update payload in ${method}:`,
          `Dot notation key "${key}" detected at path "${fullPath}".`,
          `Keys should not contain dots. Split "${key}" into nested objects: ${suggestion}`,
        ].join('\n')

        console.error(message)

        if (this.throwOnError) {
          throw new Error(
            `Invalid index update: dot notation keys not supported. Key "${key}" at path "${fullPath}" contains dots.`,
          )
        }
      }

      // Recursively check nested objects
      const value = obj[key]
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        this.checkDotNotationKeys(value, method, currentPath)
      }
    }
  }

  /**
   * Build a nested object suggestion from a dot notation key
   */
  private buildNestedObjectSuggestion(dotKey: string): string {
    const parts = dotKey.split('.')
    let suggestion = '{ '
    for (let i = 0; i < parts.length - 1; i++) {
      suggestion += `${parts[i]}: { `
    }
    suggestion += `${parts[parts.length - 1]}: value `
    for (let i = 0; i < parts.length - 1; i++) {
      suggestion += '}'
    }
    suggestion += ' }'
    return suggestion
  }

  /**
   * Detect potential counter misuse
   * Logs warnings when numeric fields that look like counters are updated
   * via update() instead of increment()
   */
  private detectCounterMisuse(payload: Record<string, any>, method: string): void {
    const checkNested = (obj: any, path: string[] = []): void => {
      for (const [key, value] of Object.entries(obj)) {
        const currentPath = [...path, key]

        // Check if it looks like a counter field
        if (this.isCounterField(key, value, currentPath)) {
          console.warn(
            `[${this.adapterName}] Potential counter misuse in ${method}:`,
            `Field "${currentPath.join('.')}" is numeric.`,
            `Consider using index.increment() for atomic updates instead of ${method}.`,
          )
        }

        if (value && typeof value === 'object' && !Array.isArray(value)) {
          checkNested(value, currentPath)
        }
      }
    }

    checkNested(payload)
  }

  /**
   * Check if a field looks like a counter that should use increment()
   */
  private isCounterField(key: string, value: any, path: string[]): boolean {
    if (typeof value !== 'number') {
      return false
    }

    // Exclude emittedEvents - these are timestamps, not counters
    if (path.includes('emittedEvents')) {
      return false
    }

    // Fields that are numeric metadata, not counters
    // These are set to known values, not incremented
    const metadataFields = [
      'stepCount', // Total steps in flow (constant)
      'timeout', // Timeout duration
      'delay', // Delay duration
      'timestamp', // Timestamp values
      'score', // Score values
      'priority', // Priority values
      'version', // Version field
    ]

    // Exclude known metadata fields
    if (metadataFields.includes(key)) {
      return false
    }

    // Timestamps (fields ending with 'At')
    if (key.endsWith('At')) {
      return false
    }

    // Common counter field names
    const counterKeywords = [
      'count', 'total', 'running', 'awaiting',
      'success', 'failure', 'cancel', 'pending',
      'completed', 'failed', 'retries', 'attempts',
    ]

    // Check if key matches counter patterns
    if (counterKeywords.some(keyword => key.toLowerCase().includes(keyword))) {
      return true
    }

    // Check if it's in a 'stats' object
    if (path.includes('stats')) {
      return true
    }

    return false
  }
}

/**
 * Factory function to create a validator for an adapter
 */
export function createStoreValidator(adapterName: string, options?: Partial<StoreValidatorOptions>): StoreValidator {
  return new StoreValidator({
    adapterName,
    ...options,
  })
}
