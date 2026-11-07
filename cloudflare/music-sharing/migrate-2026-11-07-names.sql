-- Song names for each share's page (title, artist, length), read one playlist at a time by GET /songs/:id.
-- Apply once with: npx wrangler d1 execute music-sharing --remote --file=migrate-2026-11-07-names.sql
ALTER TABLE shares ADD COLUMN names TEXT;
