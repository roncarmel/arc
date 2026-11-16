-- Applied once with: npx wrangler d1 execute music-sharing --remote --file=add-recordings.sql
-- Songs matched across services by ISRC (work/tidal-plan.md, stage 6; added 2026-11-16: add-recordings.sql). A share keeps the IDs its sharer's
-- service gave; other IDs come from here, found by people's own Arc with their own sign-in and sent back (POST /matches). As small as it can be.
CREATE TABLE IF NOT EXISTS recordings (
  isrc TEXT PRIMARY KEY,
  spotify TEXT,                       -- up to 3 Spotify track IDs, space separated, the one that last played for someone first; NULL: none
  tidal TEXT,                         -- the same for TIDAL
  spotify_none INTEGER,               -- when it was last looked for on Spotify and not found (ms), while there is no ID; looked for again after 30 days
  tidal_none INTEGER
);
