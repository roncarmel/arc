-- Shared playlists get a type (ceremony, phase, mood, other) in place of tags and notes. The shares made before are deleted (decided by Ron, 2026-11-08).
-- Apply once with: npx wrangler d1 execute music-sharing --remote --file=migrate-2026-11-08-types.sql
DROP TABLE IF EXISTS shares;
DELETE FROM reports;
CREATE TABLE IF NOT EXISTS shares (
  id TEXT PRIMARY KEY,                -- random, the shared playlist's own ID here
  owner TEXT NOT NULL,                -- HMAC of the sharer's Spotify user ID (never the ID itself)
  playlist TEXT NOT NULL,             -- the sharer's Spotify playlist ID, so their device knows which of its playlists this is
  snapshot TEXT,                      -- Spotify's snapshot ID when shared, to say "Changed in Spotify since you shared it"
  name TEXT NOT NULL,
  shown_as TEXT,                      -- the sharer's Spotify name; NULL is anonymous
  kind TEXT NOT NULL,                 -- ceremony, phase, mood or other
  books INTEGER NOT NULL DEFAULT 0,   -- a ceremony's books, a bit each: Book 1 is 1, Book 2 is 2, Book 3 is 4, Book 4 is 8, Book 5 is 16
  phases INTEGER NOT NULL DEFAULT 0,  -- a phase playlist's phases, a bit each: Beginning 1, Ascent 2, Plateau 4, Descent 8, Ending 16
  moods TEXT,                         -- JSON: a mood playlist's words, lower case
  other TEXT,                         -- what an Other playlist is, in a word or two
  description TEXT,                   -- the sharer's description, or the playlist's Spotify description
  desc_source TEXT,                   -- mine or spotify (kept in step with Spotify when the sharer updates)
  cover TEXT,                         -- the address of the playlist's picture at Spotify, or NULL
  songs TEXT NOT NULL,                -- JSON: [[spotify track ID, ISRC or ""], ...] in order
  song_count INTEGER NOT NULL,
  total_ms INTEGER NOT NULL,
  avg_ms INTEGER NOT NULL,
  artists TEXT NOT NULL,              -- JSON: the few artists heard most
  names TEXT,                         -- JSON: [[title, artist, length in ms], ...] in the order of songs; sent one playlist at a time, never with the library
  shared_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  hidden INTEGER NOT NULL DEFAULT 0,  -- 0 shown, 1 hidden by reports (until the owner of the app looks), 2 hidden by the owner of the app
  UNIQUE (owner, playlist)
);

