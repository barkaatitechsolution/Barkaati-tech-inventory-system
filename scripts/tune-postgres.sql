-- Barkaati Tech Inventory System - PostgreSQL tuning.
--
-- The defaults PostgreSQL ships with are sized for a small VM, not for a
-- machine that keeps a multi-year sales ledger. On a ~15 GB / 8-core box the
-- values below give the planner room to cache the hot pages and to vacuum the
-- high-churn sales tables without stalling billing.
--
-- Run as a superuser, then restart PostgreSQL for shared_buffers to take effect
-- (the other settings apply on reload):
--
--   psql -U postgres -d store_master -f scripts/tune-postgres.sql
--   sudo systemctl restart postgresql
--
-- Scale shared_buffers / effective_cache_size to about 25% / 70% of total RAM if
-- the machine has a different amount.

ALTER SYSTEM SET shared_buffers = '4GB';                 -- ~25% of 15 GB RAM
ALTER SYSTEM SET effective_cache_size = '10GB';          -- ~70% of 15 GB RAM
ALTER SYSTEM SET maintenance_work_mem = '1GB';           -- faster VACUUM / index builds
ALTER SYSTEM SET work_mem = '16MB';                      -- per sort/hash node; keep modest
ALTER SYSTEM SET wal_buffers = '16MB';
ALTER SYSTEM SET max_wal_size = '8GB';                   -- fewer checkpoints under load
ALTER SYSTEM SET min_wal_size = '1GB';
ALTER SYSTEM SET checkpoint_completion_target = 0.9;
ALTER SYSTEM SET random_page_cost = 1.1;                 -- SSD/NVMe storage
ALTER SYSTEM SET effective_io_concurrency = 200;
ALTER SYSTEM SET default_statistics_target = 200;        -- better plans for skewed data

-- Global autovacuum: the default 20% scale factor lets a 36M-row sales table
-- accumulate tens of millions of dead tuples before it is cleaned, which then
-- shows up as slow dashboards and bloat.
ALTER SYSTEM SET autovacuum_vacuum_scale_factor = 0.05;
ALTER SYSTEM SET autovacuum_analyze_scale_factor = 0.02;
ALTER SYSTEM SET autovacuum_vacuum_cost_limit = 2000;

-- Per-table overrides for the tables that churn the most. These apply without a
-- restart and are the ones that matter most on a busy shop.
ALTER TABLE sales SET (
  autovacuum_vacuum_scale_factor = 0.02,
  autovacuum_analyze_scale_factor = 0.01,
  autovacuum_vacuum_cost_limit = 2000
);
ALTER TABLE sale_items SET (
  autovacuum_vacuum_scale_factor = 0.02,
  autovacuum_analyze_scale_factor = 0.01,
  autovacuum_vacuum_cost_limit = 2000
);
ALTER TABLE sync_changes SET (
  autovacuum_vacuum_scale_factor = 0.02,
  autovacuum_analyze_scale_factor = 0.01
);

-- Reclaim space left by years of deletes/updates once, then let autovacuum keep
-- up. VACUUM (not FULL) is safe to run while the app is live.
VACUUM (ANALYZE) sales;
VACUUM (ANALYZE) sale_items;
VACUUM (ANALYZE) sync_changes;
