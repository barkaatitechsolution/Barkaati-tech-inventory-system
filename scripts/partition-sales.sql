-- Barkaati Tech Inventory System - converting `sales` / `sale_items` to monthly
-- range partitions.
--
-- WHY: at ~36M sales and ~90M sale_items per year, a single 43 GB table makes
-- index maintenance, VACUUM and "delete the year we no longer need" slow and
-- bloat-heavy. Partitioning by `created_at` lets old months be detached and
-- dropped instantly instead of row-by-row deletes.
--
-- THIS SCRIPT IS A REHEARSAL TEMPLATE. Partitioning an existing table with
-- foreign keys is a schema rewrite, not an online change. Before running it:
--
--   1. Take a fresh backup:      scripts/backup.sh
--   2. Restore it to a scratch database and run this whole script there.
--   3. Verify row counts and that the app boots against the scratch copy.
--   4. Only then run it against the live database during a maintenance window
--      (the app must be stopped:  sudo systemctl stop barkaati-inventory).
--
-- The rename-and-reparent steps below assume the app is stopped and that
-- nothing else holds a lock on `sales`.

\set ON_ERROR_STOP on

BEGIN;

-- 1. Build the partitioned parents. The primary key must include the partition
--    key, and child tables that reference `sales(id)` are re-pointed afterwards.
CREATE TABLE sales_part (
  LIKE sales INCLUDING DEFAULTS INCLUDING GENERATED INCLUDING IDENTITY
) PARTITION BY RANGE (created_at);

CREATE TABLE sale_items_part (
  LIKE sale_items INCLUDING DEFAULTS INCLUDING GENERATED INCLUDING IDENTITY
) PARTITION BY RANGE (created_at);

ALTER TABLE sales_part ADD PRIMARY KEY (id, created_at);
ALTER TABLE sale_items_part ADD PRIMARY KEY (id, created_at);

-- 2. One partition per month. Create a rolling window ahead of time (this makes
--    the current year plus next year); older months are created as data is
--    migrated. Adjust the range to your data.
DO $$
DECLARE
  start date := date_trunc('month', (SELECT MIN(created_at)::date FROM sales));
  stop  date := date_trunc('month', (SELECT MAX(created_at)::date FROM sales)) + interval '2 years';
  m date := start;
BEGIN
  WHILE m < stop LOOP
    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS %I PARTITION OF sales_part FOR VALUES FROM (%L) TO (%L)',
      'sales_' || to_char(m, 'YYYY_MM'), m, m + interval '1 month');
    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS %I PARTITION OF sale_items_part FOR VALUES FROM (%L) TO (%L)',
      'sale_items_' || to_char(m, 'YYYY_MM'), m, m + interval '1 month');
    m := m + interval '1 month';
  END LOOP;
END $$;

-- 3. Copy the data across. This is the long step; run it outside the transaction
--    (remove the BEGIN/COMMIT) if you prefer to commit per month. `created_at`
--    on sale_items is derived from its parent sale.
INSERT INTO sales_part SELECT * FROM sales;

INSERT INTO sale_items_part (id, sale_id, product_id, qty, price, purchase_price,
                             discount, tax, tax_amt, hsn_code, profit, created_at)
SELECT si.id, si.sale_id, si.product_id, si.qty, si.price, si.purchase_price,
       si.discount, si.tax, si.tax_amt, si.hsn_code, si.profit, s.created_at
  FROM sale_items si
  JOIN sales s ON s.id = si.sale_id;

-- 4. Swap the tables in. Re-create the foreign keys and the sync/stock triggers
--    on the new parents, then point the sequence at the copied max.
ALTER TABLE sale_items_part
  ADD CONSTRAINT sale_items_sale_id_fkey
  FOREIGN KEY (sale_id, created_at) REFERENCES sales_part(id, created_at) ON DELETE CASCADE;

ALTER TABLE sales RENAME TO sales_old;
ALTER TABLE sale_items RENAME TO sale_items_old;
ALTER TABLE sales_part RENAME TO sales;
ALTER TABLE sale_items_part RENAME TO sale_items;

-- Recreate the app triggers (see server/db.js and server/sync.js) on the new
-- parents, e.g.:
--   CREATE TRIGGER sync_touch_updated_at BEFORE UPDATE ON sales FOR EACH ROW EXECUTE FUNCTION sync_touch_updated_at();
--   CREATE TRIGGER sync_capture_change AFTER INSERT OR UPDATE OR DELETE ON sales FOR EACH ROW EXECUTE FUNCTION sync_capture_change();
--   ...and the product_stock / sales_daily_summary triggers.

SELECT setval(pg_get_serial_sequence('sales', 'id'),
              GREATEST((SELECT COALESCE(MAX(id), 1) FROM sales), 1), true);
SELECT setval(pg_get_serial_sequence('sale_items', 'id'),
              GREATEST((SELECT COALESCE(MAX(id), 1) FROM sale_items), 1), true);

COMMIT;

-- 5. After the app is verified against the new tables, reclaim the old space:
--      DROP TABLE sale_items_old;
--      DROP TABLE sales_old;
--      VACUUM (ANALYZE) sales; VACUUM (ANALYZE) sale_items;
