-- 2026-11-06: The music and How I use it became phases, tags and notes. Music sharing was not public yet, so the test shares are wiped.
-- Run once, then schema.sql:
--   npx wrangler d1 execute music-sharing --remote --file=migrate-2026-11-06-phases.sql
--   npx wrangler d1 execute music-sharing --remote --file=schema.sql
DROP TABLE IF EXISTS reports;
DROP TABLE IF EXISTS shares;
