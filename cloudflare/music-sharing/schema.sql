-- Music sharing: the database (Cloudflare D1, which is SQLite) behind cloudflare/music-sharing/worker.js.
-- Apply with: npx wrangler d1 execute music-sharing --remote --file=schema.sql

-- One row per shared playlist. Only what the sharer chose and wrote, the songs as IDs, and a short summary made on their device when they shared it.
CREATE TABLE IF NOT EXISTS shares (
  id TEXT PRIMARY KEY,                -- random, the shared playlist's own ID here
  owner TEXT NOT NULL,                -- HMAC of the sharer's Spotify user ID (never the ID itself)
  playlist TEXT NOT NULL,             -- the sharer's Spotify playlist ID, so their device knows which of its playlists this is
  snapshot TEXT,                      -- Spotify's snapshot ID when shared, to say "Changed since you shared it"
  name TEXT NOT NULL,
  shown_as TEXT,                      -- the name shown as the sharer; NULL is Anonymous
  phases INTEGER NOT NULL,            -- the phases of a session it suits, a bit each: Opening 1, Coming up 2, Plateau 4, Landing 8, Rest 16
  tags TEXT NOT NULL,                 -- JSON: the sharer's tags, lower case, 3 to 10
  notes TEXT,                         -- the sharer's optional notes
  cover TEXT,                         -- the address of the playlist's picture at Spotify, or NULL
  songs TEXT NOT NULL,                -- JSON: [[spotify track ID, ISRC or ""], ...] in order
  song_count INTEGER NOT NULL,
  total_ms INTEGER NOT NULL,
  avg_ms INTEGER NOT NULL,
  artists TEXT NOT NULL,              -- JSON: the few artists heard most
  shared_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  hidden INTEGER NOT NULL DEFAULT 0,  -- 0 shown, 1 hidden by reports (until the owner of the app looks), 2 hidden by the owner of the app
  UNIQUE (owner, playlist)
);

-- One row per report; one report per person per shared playlist.
CREATE TABLE IF NOT EXISTS reports (
  share TEXT NOT NULL,
  reporter TEXT NOT NULL,             -- HMAC of the reporter's Spotify user ID
  reason TEXT NOT NULL,
  note TEXT,
  at INTEGER NOT NULL,
  PRIMARY KEY (share, reporter)
);

-- The app owner's choices about tags: 1 hides a word, 0 shows a word that starts hidden (a common word).
CREATE TABLE IF NOT EXISTS words (
  word TEXT PRIMARY KEY,
  hidden INTEGER NOT NULL
);

-- Writes per person per day, so one script cannot flood the library.
CREATE TABLE IF NOT EXISTS daily (
  who TEXT NOT NULL,
  day TEXT NOT NULL,
  kind TEXT NOT NULL,
  n INTEGER NOT NULL,
  PRIMARY KEY (who, day, kind)
);
