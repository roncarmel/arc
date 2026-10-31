# Tests

About 1,235 checks against the real `index.html`, `app.js`, `editor.js`, `formats.js`, `theme.js` and `engine.py`, with no browser and no network:
the page runs in jsdom, Spotify is a pretend server written in `run.js` (`makeFetch`), and `engine.py` is the real file, run by `bridge.py` in place of Pyodide.

    cd tests && npm install
    node run.js                      # everything, about 4 minutes
    node run.js "--only=newer version|spotify merge"   # only the areas whose names contain any of these
    node run.js --list               # the names of the areas
    APP_DIR=/path/to/app node run.js # if the app is not in the folder above this one

Python 3 is needed (standard library only). Use the quotes around `--only=` when it has a `|`.

## How a check is written

- An area is `if (want("area name")) { try { ... } catch (err) { areaCrashed("area name", err); } }`, and its name is in `SECTION_NAMES` at the top. Checks are `check("what is true", condition)`.
- `boot({ url, session, local, fetchOptions })` starts the page. `session` and `local` are sessionStorage and localStorage; `fetchOptions` steers the pretend Spotify (a few: `extraPlaylists`, `putFails`, `putStatus`, `coverStatus`, `coverRateLimit`, `noCoverFile`, `listDelayMs`, `tokenDelayMs`, `serverVersion`, `versionFail`, `uniqueSongNames`). Read `makeFetch` for the rest.
- `signedIn()` is a session with a token. `MINI` is a small recipe text. `waitFor(condition)` polls.
- Names such as `editor`, `saveState`, `notices`, `noticeTiming`, `versionCheck`, `signingIn` are `let`/`const` in the page; `boot` turns them into `var` so a check can reach them with `w.eval(...)`. A new top-level name that a check needs goes in that list of `.replace(...)` calls in `boot`.

## Quirks of the pretend page

- Scripts added by code are intercepted (treated as files to load), so to put script tags in the page use `insertAdjacentHTML`.
- A clean start removes `startupRefreshed` from sessionStorage, so a check that wants it set sets it after `boot`.
- jsdom has no `Element.animate`; a check that wants to see animation puts its own on `HTMLElement.prototype`.
- The pretend library gives every playlist songs named "Song 0, Song 1 ..." by "Artist", so every song looks like a song in two versions; pass `uniqueSongNames: true` to avoid that.

## The version stamp

The stamp (for example `2026-10-31d`) is in `version.txt`, in `app.js` as `APP_VERSION`, and five times in `index.html`; a check makes sure they agree. The checks also hold it as text in a few places. `python3 bump_version.py` in the folder above changes all of them, `run.js` included.
