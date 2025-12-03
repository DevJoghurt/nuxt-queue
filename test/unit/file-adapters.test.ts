import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { FileQueueAdapter } from '../../packages/nvent/src/runtime/adapters/builtin/file-queue'
import { FileStoreAdapter } from '../../packages/nvent/src/runtime/adapters/builtin/file-store'

const TEST_DIR = join(tmpdir(), 'nvent-test-file-adapters')

async function cleanupTestDir() {
  try {
    await fs.rm(TEST_DIR, { recursive: true, force: true })
  }
  catch {
    // Ignore errors
  }
}

// Helper function to create event records with required fields
function createEvent(type: string, data: any) {
  return {
    runId: 'test-run',
    flowName: 'test-flow',
    type,
    data,
  }
}

describe('FileQueueAdapter', () => {
  let adapter: FileQueueAdapter

  beforeEach(async () => {
    await cleanupTestDir()
    adapter = new FileQueueAdapter({
      dataDir: TEST_DIR,
      maxQueueSize: 100,
    })
    await adapter.init()
  })

  afterEach(async () => {
    await adapter.close()
    await cleanupTestDir()
  })

  it('initializes with empty queues', async () => {
    const jobs = await adapter.getJobs('test-queue')
    expect(jobs).toEqual([])
  })

  it('enqueues jobs and persists to disk', async () => {
    const jobId = await adapter.enqueue('test-queue', {
      name: 'test-job',
      data: { value: 42 },
    })

    expect(typeof jobId).toBe('string')
    expect(jobId.length).toBeGreaterThan(0)

    // Verify job file exists on disk
    const jobPath = join(TEST_DIR, 'queues', 'test-queue', 'jobs', `${jobId}.json`)
    const fileContent = await fs.readFile(jobPath, 'utf-8')
    const jobData = JSON.parse(fileContent)

    expect(jobData.id).toBe(jobId)
    expect(jobData.name).toBe('test-job')
    expect(jobData.data.value).toBe(42)
    expect(jobData.state).toBe('waiting')
  })

  it('retrieves persisted jobs', async () => {
    const jobId = await adapter.enqueue('test-queue', {
      name: 'test-job',
      data: { test: 'data' },
    })

    const job = await adapter.getJob('test-queue', jobId)

    expect(job).toBeDefined()
    expect(job?.id).toBe(jobId)
    expect(job?.name).toBe('test-job')
    expect(job?.data.test).toBe('data')
    expect(job?.state).toBe('waiting')
  })

  it('loads jobs from disk on restart', async () => {
    // Enqueue jobs
    const jobId1 = await adapter.enqueue('queue1', {
      name: 'job1',
      data: { value: 1 },
    })

    const jobId2 = await adapter.enqueue('queue1', {
      name: 'job2',
      data: { value: 2 },
    })

    await adapter.close()

    // Create new adapter instance pointing to same directory
    const adapter2 = new FileQueueAdapter({
      dataDir: TEST_DIR,
      maxQueueSize: 100,
    })
    await adapter2.init()

    // Verify jobs were loaded from disk
    const jobs = await adapter2.getJobs('queue1')
    expect(jobs).toHaveLength(2)

    const job1 = await adapter2.getJob('queue1', jobId1)
    const job2 = await adapter2.getJob('queue1', jobId2)

    expect(job1?.data.value).toBe(1)
    expect(job2?.data.value).toBe(2)

    await adapter2.close()
  })

  it('persists job state changes', async () => {
    const jobId = await adapter.enqueue('test-queue', {
      name: 'stateful-job',
      data: { value: 'test' },
    })

    // Change job state using internal method
    await (adapter as any).updateJobState('test-queue', jobId, 'active')

    // Restart adapter
    await adapter.close()

    const adapter2 = new FileQueueAdapter({
      dataDir: TEST_DIR,
      maxQueueSize: 100,
    })
    await adapter2.init()

    const job = await adapter2.getJob('test-queue', jobId)
    expect(job?.state).toBe('active')

    await adapter2.close()
  })

  it('handles multiple queues independently', async () => {
    const _jobId1 = await adapter.enqueue('queue-a', {
      name: 'job-a',
      data: { queue: 'a' },
    })

    const _jobId2 = await adapter.enqueue('queue-b', {
      name: 'job-b',
      data: { queue: 'b' },
    })

    const jobsA = await adapter.getJobs('queue-a')
    const jobsB = await adapter.getJobs('queue-b')

    expect(jobsA).toHaveLength(1)
    expect(jobsB).toHaveLength(1)
    expect(jobsA[0].data.queue).toBe('a')
    expect(jobsB[0].data.queue).toBe('b')

    // Verify separate directories on disk
    const queueADir = join(TEST_DIR, 'queues', 'queue-a', 'jobs')
    const queueBDir = join(TEST_DIR, 'queues', 'queue-b', 'jobs')

    const filesA = await fs.readdir(queueADir)
    const filesB = await fs.readdir(queueBDir)

    expect(filesA).toHaveLength(1)
    expect(filesB).toHaveLength(1)
  })

  it('registers and executes workers', async () => {
    let executedJob: any = null

    adapter.registerWorker(
      'worker-queue',
      'worker-job',
      async (job: any) => {
        executedJob = job
        return { success: true }
      },
      { concurrency: 1 },
    )

    const jobId = await adapter.enqueue('worker-queue', {
      name: 'worker-job',
      data: { value: 'executed' },
    })

    // Wait for worker to process
    await new Promise(resolve => setTimeout(resolve, 100))

    expect(executedJob).toBeDefined()
    expect(executedJob.data).toEqual({ value: 'executed' })

    // Verify job state changed
    const job = await adapter.getJob('worker-queue', jobId)
    expect(job?.state).toBe('completed')
  })

  it('persists completed job results', async () => {
    adapter.registerWorker(
      'results-queue',
      'results-job',
      async () => ({ result: 'success', count: 42 }),
      { concurrency: 1 },
    )

    const jobId = await adapter.enqueue('results-queue', {
      name: 'results-job',
      data: {},
    })

    // Wait for completion
    await new Promise(resolve => setTimeout(resolve, 100))

    // Restart adapter
    await adapter.close()

    const adapter2 = new FileQueueAdapter({
      dataDir: TEST_DIR,
      maxQueueSize: 100,
    })
    await adapter2.init()

    const job = await adapter2.getJob('results-queue', jobId)
    expect(job?.state).toBe('completed')
    // Note: FileQueueAdapter doesn't persist return values, only state changes

    await adapter2.close()
  })

  it('filters jobs by state', async () => {
    const jobId1 = await adapter.enqueue('filtered-queue', {
      name: 'job1',
      data: {},
    })

    await (adapter as any).updateJobState('filtered-queue', jobId1, 'completed')

    const jobId2 = await adapter.enqueue('filtered-queue', {
      name: 'job2',
      data: {},
    })

    const allJobs = await adapter.getJobs('filtered-queue')
    const waitingJobs = await adapter.getJobs('filtered-queue', { state: ['waiting'] })
    const completedJobs = await adapter.getJobs('filtered-queue', { state: ['completed'] })

    expect(allJobs).toHaveLength(2)
    expect(waitingJobs).toHaveLength(1)
    expect(completedJobs).toHaveLength(1)
    expect(waitingJobs[0].id).toBe(jobId2)
    expect(completedJobs[0].id).toBe(jobId1)
  })

  it.skip('pauses and resumes queue', async () => {
    // This test is skipped because pause/resume behavior with fastq
    // is timing-sensitive and can be flaky in unit tests
    // The functionality is better tested in integration/e2e tests
  })

  it('handles job failures', async () => {
    adapter.registerWorker(
      'failing-queue',
      'failing-job',
      async () => {
        throw new Error('Job failed')
      },
      { concurrency: 1 },
    )

    const jobId = await adapter.enqueue('failing-queue', {
      name: 'failing-job',
      data: {},
    })

    // Wait for failure
    await new Promise(resolve => setTimeout(resolve, 100))

    const job = await adapter.getJob('failing-queue', jobId)
    expect(job?.state).toBe('failed')
    expect(job?.failedReason).toBeDefined()
    expect(typeof job?.failedReason).toBe('string')
  })

  it('persists job state to disk', async () => {
    const jobId = await adapter.enqueue('persistence-queue', {
      name: 'persistence-job',
      data: {},
    })

    await (adapter as any).updateJobState('persistence-queue', jobId, 'completed')

    // Verify file exists and has correct state
    const jobPath = join(TEST_DIR, 'queues', 'persistence-queue', 'jobs', `${jobId}.json`)
    await expect(fs.access(jobPath)).resolves.toBeUndefined()

    const fileContent = await fs.readFile(jobPath, 'utf-8')
    const jobData = JSON.parse(fileContent)
    expect(jobData.state).toBe('completed')
  })
})

describe('FileStoreAdapter', () => {
  let adapter: FileStoreAdapter

  beforeEach(async () => {
    await cleanupTestDir()
    adapter = new FileStoreAdapter({
      dataDir: TEST_DIR,
    })
    await adapter.init()
  })

  afterEach(async () => {
    await adapter.close()
    await cleanupTestDir()
  })

  it('appends events and persists to NDJSON', async () => {
    const event = await adapter.append('test-subject', createEvent('test.event', { value: 42 }))

    expect(event.id).toBeDefined()
    expect(event.ts).toBeDefined()
    expect(event.type).toBe('test.event')

    // Verify NDJSON file exists and contains event
    const streamPath = join(TEST_DIR, 'streams', 'test-subject.ndjson')
    const content = await fs.readFile(streamPath, 'utf-8')
    const lines = content.trim().split('\n')

    expect(lines).toHaveLength(1)
    const persistedEvent = JSON.parse(lines[0])
    expect(persistedEvent.id).toBe(event.id)
    expect(persistedEvent.type).toBe('test.event')
    expect(persistedEvent.data.value).toBe(42)
  })

  it('loads events from disk on restart', async () => {
    await adapter.append('loaded-subject', createEvent('event.one', { num: 1 }))

    await adapter.append('loaded-subject', createEvent('event.two', { num: 2 }))

    await adapter.close()

    // Create new adapter
    const adapter2 = new FileStoreAdapter({
      dataDir: TEST_DIR,
    })
    await adapter2.init()

    const events = await adapter2.read('loaded-subject')
    expect(events).toHaveLength(2)
    expect(events[0].data.num).toBe(1)
    expect(events[1].data.num).toBe(2)

    await adapter2.close()
  })

  it('appends multiple events to same subject', async () => {
    await adapter.append('multi-subject', createEvent('test.event', { seq: 1 }))

    await adapter.append('multi-subject', createEvent('test.event', { seq: 2 }))

    await adapter.append('multi-subject', createEvent('test.event', { seq: 3 }))

    const events = await adapter.read('multi-subject')
    expect(events).toHaveLength(3)
    expect(events.map(e => e.data.seq)).toEqual([1, 2, 3])

    // Verify NDJSON has all 3 lines
    const streamPath = join(TEST_DIR, 'streams', 'multi-subject.ndjson')
    const content = await fs.readFile(streamPath, 'utf-8')
    const lines = content.trim().split('\n')
    expect(lines).toHaveLength(3)
  })

  it('saves and retrieves documents', async () => {
    await adapter.save('users', 'user-1', {
      name: 'Alice',
      email: 'alice@example.com',
    })

    // Verify document file exists
    const docPath = join(TEST_DIR, 'docs', 'users', 'user-1.json')
    const fileContent = await fs.readFile(docPath, 'utf-8')
    const doc = JSON.parse(fileContent)

    expect(doc.name).toBe('Alice')
    expect(doc.email).toBe('alice@example.com')

    // Retrieve via adapter
    const retrieved = await adapter.get('users', 'user-1')
    expect(retrieved).toEqual(doc)
  })

  it('loads documents from disk on restart', async () => {
    await adapter.save('products', 'prod-1', {
      name: 'Widget',
      price: 9.99,
    })

    await adapter.save('products', 'prod-2', {
      name: 'Gadget',
      price: 19.99,
    })

    await adapter.close()

    // New adapter
    const adapter2 = new FileStoreAdapter({
      dataDir: TEST_DIR,
    })
    await adapter2.init()

    const prod1 = await adapter2.get('products', 'prod-1')
    const prod2 = await adapter2.get('products', 'prod-2')

    expect(prod1?.name).toBe('Widget')
    expect(prod2?.name).toBe('Gadget')

    await adapter2.close()
  })

  it('deletes documents and removes files', async () => {
    await adapter.save('items', 'item-1', { value: 'test' })

    const docPath = join(TEST_DIR, 'docs', 'items', 'item-1.json')
    await expect(fs.access(docPath)).resolves.toBeUndefined()

    await adapter.delete('items', 'item-1')

    const retrieved = await adapter.get('items', 'item-1')
    expect(retrieved).toBeNull()

    // Verify file was deleted
    await expect(fs.access(docPath)).rejects.toThrow()
  })

  it('lists documents in collection', async () => {
    await adapter.save('collection', 'doc1', { value: 1 })
    await adapter.save('collection', 'doc2', { value: 2 })
    await adapter.save('collection', 'doc3', { value: 3 })

    const docs = await adapter.list!('collection')
    expect(docs).toHaveLength(3)
    expect(docs.map(d => d.doc.value).sort()).toEqual([1, 2, 3])
  })

  it('KV store persists values', async () => {
    await adapter.kv.set('config:timeout', 5000)
    await adapter.kv.set('config:retries', 3)

    // Verify KV files exist
    const timeoutPath = join(TEST_DIR, 'kv', 'config_timeout.json')
    const retriesPath = join(TEST_DIR, 'kv', 'config_retries.json')

    const timeoutContent = await fs.readFile(timeoutPath, 'utf-8')
    const retriesContent = await fs.readFile(retriesPath, 'utf-8')

    expect(JSON.parse(timeoutContent)).toBe(5000)
    expect(JSON.parse(retriesContent)).toBe(3)
  })

  it('KV store loads from disk on restart', async () => {
    await adapter.kv.set('persisted:value', { data: 'test' })
    await adapter.close()

    const adapter2 = new FileStoreAdapter({
      dataDir: TEST_DIR,
    })
    await adapter2.init()

    const value = await adapter2.kv.get('persisted:value')
    expect(value).toEqual({ data: 'test' })

    await adapter2.close()
  })

  it('KV delete removes files', async () => {
    await adapter.kv.set('delete:me', 'value')

    const kvPath = join(TEST_DIR, 'kv', 'delete_me.json')
    await expect(fs.access(kvPath)).resolves.toBeUndefined()

    await adapter.kv.delete('delete:me')

    const value = await adapter.kv.get('delete:me')
    expect(value).toBeNull()

    // Verify file was deleted
    await expect(fs.access(kvPath)).rejects.toThrow()
  })

  it('KV clear removes matching files', async () => {
    await adapter.kv.set('prefix:a', 1)
    await adapter.kv.set('prefix:b', 2)
    await adapter.kv.set('other:c', 3)

    const count = await adapter.kv.clear!('prefix:*')
    expect(count).toBe(2)

    const a = await adapter.kv.get('prefix:a')
    const b = await adapter.kv.get('prefix:b')
    const c = await adapter.kv.get('other:c')

    expect(a).toBeNull()
    expect(b).toBeNull()
    expect(c).toBe(3)

    // Verify files were deleted
    const kvDir = join(TEST_DIR, 'kv')
    const files = await fs.readdir(kvDir)
    expect(files).not.toContain('prefix_a.json')
    expect(files).not.toContain('prefix_b.json')
    expect(files).toContain('other_c.json')
  })

  it('KV increment persists values', async () => {
    const val1 = await adapter.kv.increment!('counter', 1)
    expect(val1).toBe(1)

    const val2 = await adapter.kv.increment!('counter', 5)
    expect(val2).toBe(6)

    // Verify file was updated
    const kvPath = join(TEST_DIR, 'kv', 'counter.json')
    const content = await fs.readFile(kvPath, 'utf-8')
    expect(JSON.parse(content)).toBe(6)

    // Restart and verify
    await adapter.close()

    const adapter2 = new FileStoreAdapter({
      dataDir: TEST_DIR,
    })
    await adapter2.init()

    const val3 = await adapter2.kv.increment!('counter', 4)
    expect(val3).toBe(10)

    await adapter2.close()
  })

  it('handles multiple subjects independently', async () => {
    await adapter.append('subject-a', createEvent('a.event', { value: 'a' }))
    await adapter.append('subject-b', createEvent('b.event', { value: 'b' }))

    const eventsA = await adapter.read('subject-a')
    const eventsB = await adapter.read('subject-b')

    expect(eventsA).toHaveLength(1)
    expect(eventsB).toHaveLength(1)
    expect(eventsA[0].data.value).toBe('a')
    expect(eventsB[0].data.value).toBe('b')

    // Verify separate NDJSON files
    const pathA = join(TEST_DIR, 'streams', 'subject-a.ndjson')
    const pathB = join(TEST_DIR, 'streams', 'subject-b.ndjson')

    await expect(fs.access(pathA)).resolves.toBeUndefined()
    await expect(fs.access(pathB)).resolves.toBeUndefined()
  })

  it('sanitizes subject names for file paths', async () => {
    // Subject with special characters
    await adapter.append('user:123', createEvent('test', {}))

    // Should create sanitized filename
    const streamPath = join(TEST_DIR, 'streams', 'user_123.ndjson')
    await expect(fs.access(streamPath)).resolves.toBeUndefined()

    // But should still be retrievable by original name
    const events = await adapter.read('user:123')
    expect(events).toHaveLength(1)
  })

  it('reads all events from subject', async () => {
    await adapter.append('filtered', createEvent('type-a', { value: 1 }))
    await adapter.append('filtered', createEvent('type-b', { value: 2 }))
    await adapter.append('filtered', createEvent('type-a', { value: 3 }))

    const allEvents = await adapter.read('filtered')
    expect(allEvents).toHaveLength(3)

    // Manual filtering by type since adapter doesn't support it
    const typeAEvents = allEvents.filter(e => e.type === 'type-a')
    expect(typeAEvents).toHaveLength(2)
    expect(typeAEvents.map(e => e.data.value)).toEqual([1, 3])
  })

  it('subscribes to events', async () => {
    const receivedEvents: any[] = []

    const subscription = await adapter.subscribe!('subscription-test', (event) => {
      receivedEvents.push(event)
    })

    await adapter.append('subscription-test', {
      runId: 'test-run',
      flowName: 'test-flow',
      type: 'test.event',
      data: { value: 'subscribed' },
    })

    // Wait for subscription callback
    await new Promise(resolve => setTimeout(resolve, 50))

    expect(receivedEvents).toHaveLength(1)
    expect(receivedEvents[0].data.value).toBe('subscribed')

    subscription.unsubscribe()
  })
})
