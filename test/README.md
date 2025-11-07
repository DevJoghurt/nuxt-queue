# Test Suite

This directory contains the test suite for nuxt-queue v0.4.

## Test Structure

Tests are organized by functionality and use `@nuxt/test-utils` for e2e testing:

### E2E Tests (require Nuxt app)
- **basic.test.ts** - Basic queue functionality and API endpoints
- **flows.e2e.test.ts** - Complete flow orchestration test suite including:
  - Flow registry and metadata
  - Flow execution and step orchestration
  - Event schema and streams (v0.4)
  - Flow emit functionality
  - Worker context (ctx.flowId, ctx.flowName, etc.)
  - Retry and failure handling
  - Flow analyzer (dependency analysis)
  - Stream naming patterns (nq:flow:{runId})

### Unit Tests
- **state.unit.test.ts** - State provider unit tests (mocked)

## Running Tests

```bash
# Start Redis first (required for most tests)
docker run -d -p 6379:6379 redis:alpine

# Run all tests
yarn test

# Run specific test file
yarn test basic.test.ts
yarn test flows.e2e.test.ts
```

## Test Fixtures

Test fixtures are located in `./fixtures/`:
- **basic/** - Minimal Nuxt app for basic queue testing
- **flows/** - Nuxt app with sample flows for orchestration testing (has server/queues with sample workers)

Both fixtures have:
- `queue.ui = false` to avoid UI dependencies
- Redis configuration pointing to localhost:6379
- Sample queue workers in `server/queues/` directory

## Redis Requirement

Most e2e tests require a running Redis instance. Tests automatically detect Redis availability using the `canConnectRedis()` helper and skip Redis-dependent tests if not available.

**Default Redis connection:** `redis://127.0.0.1:6379`

To run Redis for testing:
```bash
docker run -d -p 6379:6379 --name nuxt-queue-test-redis redis:alpine

# Stop when done
docker stop nuxt-queue-test-redis && docker rm nuxt-queue-test-redis
```

## Current Status

✅ **Consolidated test structure** - Reduced from 11 separate test files to 3 organized files  
✅ **Single Nuxt server per fixture** - Each test file uses one `setup()` call  
✅ **Proper @nuxt/test-utils usage** - Following official Nuxt 4.x testing guidelines  
✅ **Test fixtures configured** - Both fixtures have proper queue workers and Redis config  

⚠️ **Known Issues:**
- Some tests may timeout if Redis is not available
- API endpoints in tests have been corrected to use `/api/_flows/` instead of `/api/_queue/flows/`
- Worker files use `defineQueueWorker` without import (provided by Nuxt module at runtime)

## Test Best Practices

1. **Single setup per fixture** - Each test file uses one `setup()` call per fixture to avoid spawning multiple Nuxt servers
2. **Redis detection** - Use `canConnectRedis()` helper to conditionally run tests
3. **Async waits** - Use appropriate delays for async operations (events, job processing)
4. **Cleanup** - Tests are isolated by using unique flow runs (runId)

## Troubleshooting

### Tests hang or timeout
- Ensure Redis is running: `docker ps | grep redis`
- Check Redis connection: `redis-cli ping` (should return "PONG")
- Increase test timeout in `vitest.config.ts` if needed

### "Cannot find name 'defineQueueWorker'" errors
- These are expected TypeScript errors in test fixtures
- `defineQueueWorker` is provided by the Nuxt module at runtime
- Tests will still run correctly despite these lint errors

### HTML instead of JSON responses
- Endpoint may not exist - check the correct API path
- Module may not be properly loaded - check fixture `nuxt.config.ts`
- Server may not have started - check terminal output

## Migration Notes

The test suite was refactored to consolidate separate test files:
- ✅ Consolidated 11 separate test files into 3 organized files
- ✅ Fixed API endpoint paths (`/api/_flows/` instead of `/api/_queue/flows/`)
- ✅ Added proper Redis configuration to test fixtures
- ✅ Removed non-existent API endpoint tests (e.g., `/api/_queues/registry`)
- ✅ Fixed SSE streaming test to use correct URL
- ✅ Updated all worker configs to use `names` instead of `name` for flow arrays

