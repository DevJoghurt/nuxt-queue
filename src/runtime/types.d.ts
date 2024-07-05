export type JobCounts = { 
  active: number
  completed: number
  failed: number
  delayed: number
  waiting: number
  paused: number

}

export type QueueData = {
  id: string
  active: boolean
  jobs: JobCounts
}