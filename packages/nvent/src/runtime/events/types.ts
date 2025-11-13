// v0.4: Using runId-based routing

export interface PublishContext {
  queue?: string
  jobId?: string
  /** Flow run ID for flow events */
  flowId?: string
  /** Trigger ID for trigger events */
  triggerId?: string
}

export interface PublishPayload<T = any> {
  type: string
  runId: string
  flowName: string
  stepName?: string
  stepId?: string
  attempt?: number
  data?: T
}
