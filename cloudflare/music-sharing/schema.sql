-- Music sharing: the database (Cloudflare D1, which is SQLite) behind cloudflare/music-sharing/worker.js.
-- Apply with: npx wrangler d1 execute music-sharing --remote --file=schema.sql

-- One row per shared playlist. Only what the sharer chose and wrote, the songs as IDs, and a short summary made on their device when they shared it.
CREATE TABLE IF NOT EXISTS shares (
  id TEXT PRIMARY KEY,                -- random, the shared playlist's own ID here
  owner TEXT NOT NULL,                -- HMAC of the sharer's user ID (never the ID itself): a Spotify ID alone, a TIDAL one as tidal:<ID>
  playlist TEXT NOT NULL,             -- the sharer's playlist ID on their service, so their device knows which of its playlists this is
  snapshot TEXT,                      -- Spotify's snapshot ID when shared, to say "Changed in Spotify since you shared it"
  name TEXT NOT NULL,
  shown_as TEXT,                      -- the sharer's Spotify name; NULL is anonymous
  kind TEXT NOT NULL,                 -- ceremony, phase, mood or other
  books INTEGER NOT NULL DEFAULT 0,   -- a ceremony's books, a bit each: Book 1 is 1, Book 2 is 2, Book 3 is 4, Book 4 is 8, Book 5 is 16, Other is 32
  book_other TEXT,                   -- with Other: its code, up to 2 letters or numbers in capitals (added 2026-11-08: add-book-other.sql)
  phases INTEGER NOT NULL DEFAULT 0,  -- a phase playlist's phases, a bit each: Beginning 1, Ascent 2, Plateau 4, Descent 8, Ending 16
  moods TEXT,                         -- JSON: a mood playlist's words, lower case
  other TEXT,                         -- what an Other playlist is, in a word or two
  description TEXT,                   -- the sharer's description, or the playlist's Spotify description
  desc_source TEXT,                   -- mine or spotify (kept in step with Spotify when the sharer updates)
  cover TEXT,                         -- the address of the playlist's picture at Spotify or TIDAL, or NULL
  songs TEXT NOT NULL,                -- JSON: [[Spotify ID, ISRC or "", TIDAL ID], ...] in order, the sharer's service's column filled (shares from before TIDAL have two)
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

-- One row per report; one report per person per shared playlist.
CREATE TABLE IF NOT EXISTS reports (
  share TEXT NOT NULL,
  reporter TEXT NOT NULL,             -- HMAC of the reporter's Spotify user ID
  reason TEXT NOT NULL,
  note TEXT,
  at INTEGER NOT NULL,
  PRIMARY KEY (share, reporter)
);

-- The app owner's choices about mood words: 1 hides a word, 0 shows a word that starts hidden (a common word).
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

-- Songs matched across services by ISRC (work/tidal-plan.md, stage 6; added 2026-11-16: add-recordings.sql). A share keeps the IDs its sharer's
-- service gave; other IDs come from here, found by people's own Arc with their own sign-in and sent back (POST /matches). As small as it can be.
CREATE TABLE IF NOT EXISTS recordings (
  isrc TEXT PRIMARY KEY,
  spotify TEXT,                       -- up to 3 Spotify track IDs, space separated, the one that last played for someone first; NULL: none
  tidal TEXT,                         -- the same for TIDAL
  spotify_none INTEGER,               -- when it was last looked for on Spotify and not found (ms), while there is no ID; looked for again after 30 days
  tidal_none INTEGER
);
