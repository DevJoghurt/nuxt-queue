/**
 * PostgreSQL Schema Migrations - Optimized Flat Design
 *
 * Design Philosophy:
 * - Use native PostgreSQL columns for all frequently accessed fields
 * - Only use JSONB for truly nested/complex data (emittedEvents, awaitingSteps)
 * - Maximize query performance and indexing capabilities
 * - Minimize deep merge operations
 */

import type { Pool } from 'pg'

export interface Migration {
  version: number
  name: string
  up: (pool: Pool, prefix: string) => Promise<void>
}

export const migrations: Migration[] = [
  {
    version: 1,
    name: 'optimized_flat_schema',
    up: async (pool: Pool, prefix: string) => {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')

        // Schema version tracking
        await client.query(`
          CREATE TABLE IF NOT EXISTS ${prefix}_schema_version (
            version INTEGER PRIMARY KEY,
            applied_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            description TEXT
          )
        `)

        // ============================================================
        // HELPER FUNCTION: Deep JSONB Merge
        // Only used for complex nested fields (emittedEvents, awaitingSteps)
        // ============================================================
        await client.query(`
          CREATE OR REPLACE FUNCTION jsonb_deep_merge(target jsonb, source jsonb) 
          RETURNS jsonb AS $$
          DECLARE
            key text;
            value jsonb;
          BEGIN
            IF jsonb_typeof(source) != 'object' OR jsonb_typeof(target) != 'object' THEN
              RETURN source;
            END IF;
            
            FOR key, value IN SELECT * FROM jsonb_each(source) LOOP
              IF target ? key AND jsonb_typeof(target->key) = 'object' AND jsonb_typeof(value) = 'object' THEN
                target := jsonb_set(target, ARRAY[key], jsonb_deep_merge(target->key, value));
              ELSE
                target := jsonb_set(target, ARRAY[key], value);
              END IF;
            END LOOP;
            
            RETURN target;
          END;
          $$ LANGUAGE plpgsql IMMUTABLE;
        `)

        // ============================================================
        // 1. FLOW RUN EVENTS
        // Append-only event log for flow executions
        // ============================================================
        await client.query(`
          CREATE TABLE IF NOT EXISTS ${prefix}_flow_events (
            id BIGSERIAL PRIMARY KEY,
            run_id TEXT NOT NULL,
            flow_name TEXT NOT NULL,
            ts BIGINT NOT NULL,
            type TEXT NOT NULL,
            step_name TEXT,
            step_id TEXT,
            attempt INTEGER,
            data JSONB,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
          )
        `)

        await client.query(`
          CREATE INDEX IF NOT EXISTS idx_${prefix}_flow_events_run 
          ON ${prefix}_flow_events(run_id, ts DESC)
        `)

        await client.query(`
          CREATE INDEX IF NOT EXISTS idx_${prefix}_flow_events_flow_type 
          ON ${prefix}_flow_events(flow_name, type, ts DESC)
        `)

        // ============================================================
        // 2. FLOW RUNS - FLATTENED FOR PERFORMANCE
        // All frequently accessed fields as columns, JSONB for complex nested data only
        // ============================================================
        await client.query(`
          CREATE TABLE IF NOT EXISTS ${prefix}_flow_runs (
            flow_name TEXT NOT NULL,
            run_id TEXT NOT NULL,
            
            -- Flat columns for hot path (direct column updates, indexable)
            status TEXT NOT NULL DEFAULT 'running',
            started_at BIGINT NOT NULL,
            completed_at BIGINT,
            step_count INTEGER,
            completed_steps INTEGER DEFAULT 0,
            last_activity_at BIGINT,
            
            -- JSONB only for complex nested data
            emitted_events JSONB DEFAULT '{}'::jsonb,
            awaiting_steps JSONB DEFAULT '{}'::jsonb,
            
            -- Versioning for optimistic locking
            version INTEGER DEFAULT 0,
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            
            PRIMARY KEY (flow_name, run_id)
          )
        `)

        // Fast status queries
        await client.query(`
          CREATE INDEX IF NOT EXISTS idx_${prefix}_flow_runs_status 
          ON ${prefix}_flow_runs(status) 
          WHERE status IN ('running', 'awaiting')
        `)

        // Fast active runs queries
        await client.query(`
          CREATE INDEX IF NOT EXISTS idx_${prefix}_flow_runs_active 
          ON ${prefix}_flow_runs(flow_name, started_at DESC)
          WHERE status IN ('running', 'awaiting')
        `)

        // Composite index for time-based queries
        await client.query(`
          CREATE INDEX IF NOT EXISTS idx_${prefix}_flow_runs_completed 
          ON ${prefix}_flow_runs(flow_name, completed_at DESC NULLS LAST)
          WHERE completed_at IS NOT NULL
        `)

        // Index on last_activity_at for monitoring/cleanup
        await client.query(`
          CREATE INDEX IF NOT EXISTS idx_${prefix}_flow_runs_activity 
          ON ${prefix}_flow_runs(last_activity_at DESC NULLS LAST)
        `)

        // ============================================================
        // 3. FLOWS - FLATTENED STATS
        // Stats as individual columns for atomic increments
        // ============================================================
        await client.query(`
          CREATE TABLE IF NOT EXISTS ${prefix}_flows (
            flow_name TEXT PRIMARY KEY,
            
            -- Flat columns
            display_name TEXT,
            flow_version INTEGER DEFAULT 1,
            registered_at BIGINT NOT NULL,
            last_run_at BIGINT,
            
            -- Stats as flat columns (atomic increments, no deep merge needed)
            stats_total INTEGER DEFAULT 0,
            stats_success INTEGER DEFAULT 0,
            stats_failure INTEGER DEFAULT 0,
            stats_running INTEGER DEFAULT 0,
            stats_awaiting INTEGER DEFAULT 0,
            stats_cancel INTEGER DEFAULT 0,
            
            -- Versioning
            version INTEGER DEFAULT 0,
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
          )
        `)

        await client.query(`
          CREATE INDEX IF NOT EXISTS idx_${prefix}_flows_last_run 
          ON ${prefix}_flows(last_run_at DESC NULLS LAST)
        `)

        // Index for stats queries
        await client.query(`
          CREATE INDEX IF NOT EXISTS idx_${prefix}_flows_running 
          ON ${prefix}_flows(stats_running DESC)
          WHERE stats_running > 0
        `)

        // ============================================================
        // 4. TRIGGER EVENTS
        // ============================================================
        await client.query(`
          CREATE TABLE IF NOT EXISTS ${prefix}_trigger_events (
            id BIGSERIAL PRIMARY KEY,
            trigger_name TEXT NOT NULL,
            ts BIGINT NOT NULL,
            type TEXT NOT NULL,
            data JSONB,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
          )
        `)

        await client.query(`
          CREATE INDEX IF NOT EXISTS idx_${prefix}_trigger_events_trigger 
          ON ${prefix}_trigger_events(trigger_name, ts DESC)
        `)

        // Index for event type filtering
        await client.query(`
          CREATE INDEX IF NOT EXISTS idx_${prefix}_trigger_events_type 
          ON ${prefix}_trigger_events(type, ts DESC)
        `)

        // ============================================================
        // 5. TRIGGERS - FLATTENED
        // ============================================================
        await client.query(`
          CREATE TABLE IF NOT EXISTS ${prefix}_triggers (
            trigger_name TEXT PRIMARY KEY,
            
            -- Flat columns
            trigger_type TEXT,
            status TEXT DEFAULT 'active',
            registered_at BIGINT NOT NULL,
            last_activity_at BIGINT,
            display_name TEXT,
            description TEXT,
            scope TEXT,
            source TEXT,
            
            -- Stats as flat columns
            stats_total_fires INTEGER DEFAULT 0,
            stats_last_fired_at BIGINT,
            stats_total_flows_started INTEGER DEFAULT 0,
            stats_active_subscribers INTEGER DEFAULT 0,
            
            -- JSONB columns for nested data
            subscriptions JSONB DEFAULT '{}'::jsonb,
            webhook JSONB,
            schedule JSONB,
            config JSONB,
            
            -- Versioning
            version INTEGER DEFAULT 0,
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
          )
        `)

        // Index for active triggers
        await client.query(`
          CREATE INDEX IF NOT EXISTS idx_${prefix}_triggers_status 
          ON ${prefix}_triggers(status)
          WHERE status = 'active'
        `)

        // Index for trigger type queries
        await client.query(`
          CREATE INDEX IF NOT EXISTS idx_${prefix}_triggers_type 
          ON ${prefix}_triggers(trigger_type, registered_at DESC)
        `)

        // ============================================================
        // 6. SCHEDULER JOBS - FLATTENED
        // ============================================================
        await client.query(`
          CREATE TABLE IF NOT EXISTS ${prefix}_scheduler_jobs (
            job_id TEXT PRIMARY KEY,
            
            -- Flat columns
            name TEXT,
            job_name TEXT,
            type TEXT,
            cron TEXT,
            interval BIGINT,
            execute_at BIGINT,
            timezone TEXT,
            enabled BOOLEAN DEFAULT true,
            scheduled_at BIGINT NOT NULL,
            last_run_at BIGINT,
            next_run_at BIGINT,
            status TEXT DEFAULT 'pending',
            
            -- JSONB for nested data
            metadata JSONB,
            config JSONB,
            
            -- Versioning
            version INTEGER DEFAULT 0,
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
          )
        `)

        await client.query(`
          CREATE INDEX IF NOT EXISTS idx_${prefix}_scheduler_jobs_next_run 
          ON ${prefix}_scheduler_jobs(next_run_at) 
          WHERE status = 'pending' AND enabled = true
        `)

        // Index for job type queries
        await client.query(`
          CREATE INDEX IF NOT EXISTS idx_${prefix}_scheduler_jobs_type 
          ON ${prefix}_scheduler_jobs(type, next_run_at)
          WHERE enabled = true
        `)

        // ============================================================
        // 7. KEY-VALUE STORE
        // ============================================================
        await client.query(`
          CREATE TABLE IF NOT EXISTS ${prefix}_kv (
            key TEXT PRIMARY KEY,
            value JSONB NOT NULL,
            expires_at TIMESTAMP WITH TIME ZONE,
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
          )
        `)

        await client.query(`
          CREATE INDEX IF NOT EXISTS idx_${prefix}_kv_expires 
          ON ${prefix}_kv(expires_at) 
          WHERE expires_at IS NOT NULL
        `)

        // Record migration
        await client.query(`
          INSERT INTO ${prefix}_schema_version (version, description)
          VALUES (1, 'Optimized flat schema with minimal JSONB usage')
          ON CONFLICT (version) DO NOTHING
        `)

        await client.query('COMMIT')
      }
      catch (error) {
        await client.query('ROLLBACK')
        throw error
      }
      finally {
        client.release()
      }
    },
  },
]

export async function runMigrations(pool: Pool, prefix: string = 'nvent'): Promise<void> {
  // Ensure schema version table exists
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${prefix}_schema_version (
      version INTEGER PRIMARY KEY,
      applied_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      description TEXT
    )
  `)

  // Get current version
  const result = await pool.query(`
    SELECT MAX(version) as version FROM ${prefix}_schema_version
  `)
  const currentVersion = result.rows[0]?.version || 0

  // Run pending migrations
  for (const migration of migrations) {
    if (migration.version > currentVersion) {
      console.log(`Running migration ${migration.version}: ${migration.name}`)
      await migration.up(pool, prefix)
      console.log(`✓ Migration ${migration.version} completed`)
    }
  }
}
