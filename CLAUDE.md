# Ceremony Playlist Builder

A free, browser-only web app (playlists.roncarmel.com, GitHub Pages, no server) that builds long timed Spotify playlists for ceremony and retreat sessions from the person's own playlists. The owner is Ron, who uses it with clients. It is not public yet, so file formats and wording can still change freely.

## How it works

- Each person makes their own Spotify app (a free Client ID, development mode) and pastes the Client ID in. Sign-in is Spotify's PKCE flow in the browser: no secret, no backend.
- A **recipe** says which of the person's playlists to draw from, in what order, for how many minutes, with silence between segments. The app builds as many playlists from a recipe as the songs allow, each song used once.
- Pyodide runs `engine.py` in the page (songs are picked there). Everything else is plain JavaScript in classic `<script>` files (no build step, no modules, shared global scope).
- Anything the person types goes nowhere but their browser and their own Spotify account. Do not add servers, trackers, or anything that sends their data elsewhere (the only third parties are Spotify, the Pyodide CDN, a Ko-fi donate panel, a GoatCounter page-view counter, and a Tally form for problem reports whose address carries scrubbed details).

## Files

| File | What it is |
|---|---|
| `index.html` | Markup, all CSS, and an inline startup watchdog (`pageStart`) that must work even when every other script fails. |
| `app.js` | Page logic: sign-in, Spotify requests (`spotifyRequest`), planning and building, the cloud save and its merge, the manual backup, notices, version check, startup problems. |
| `editor.js` | The recipe editor UI (tabs, rows, bar, markers), the app menu, the line under the bar (`refreshNoticeLine`), dialogs. CSS is scoped under `#formatEditor` with an `fe-` prefix. |
| `formats.js` | Recipe text parse/serialize, the size limit, and `packFormat`/`unpackFormat` (a recipe packed into a Spotify description). |
| `theme.js` | Color themes as CSS variables. |
| `engine.py` | The playlist engine: `pick`, `build_one`, naming (`name_pattern`, `existing_matches`), silence tracks. |
| `version.txt` | Just the version stamp, fetched by the page to see if it is stale. |
| `backup-cover.jpg`, `playlist-cover.jpg`, `apple-touch-icon.png`, `icons/` | Images. `backup-cover.jpg` (cloud with a check) is the cover of the cloud-save playlists and the picture on the menu button while saving. |

Naming: the person sees "recipe". The code still says "format" in identifiers (`formats`, `FORMATS`, `fe-` classes...). Recipe text is `RECIPES = {...}`; `FORMATS = {...}` is still read. Do not rename identifiers just for tidiness.

## Decisions worth knowing (and why)

**Saving recipes**
- Recipes live in `localStorage` (`formats`) and are saved there on every edit. By default they are also **saved to Spotify** (`backupMode` unset or "spotify"): one private playlist per recipe named `<title> (recipe)`, the recipe packed into its description ("Do not edit." plus dense CJK characters, 14 bits each, magic "CP", version, CRC-16; `SAVE_LIMIT` is 300 characters because Spotify's own app shows 300; the API accepts 512). Saves are found by decoding descriptions, not by name.
- The other choice is **manual backup** (`backupMode` = "manual"): download a text file, restore from one.
- Every recipe has a `revision` and `modified`, written only after its first edit. `mergeFromSpotify` (app.js) settles each recipe against its save using a per-device record `spotifySynced` (`{id: {rev, playlistId}}`): only one side changed means that side wins; both changed, or no record and a difference, opens a **required** dialog (no Escape, no backdrop close). A save that is gone from Spotify asks too (keep or remove). Recipes found only in Spotify are added. Deleting a recipe deletes its save (`spotifyPendingDeletes` survives a closed tab). Unreadable saves are rewritten in place if they have the recipe's name, and never deleted.
- Saves are debounced 5 s with a 30 s maximum wait, flushed when the page is hidden, retried when the connection returns, paused while a build runs. A second failure in a row, or an unexpected one, opens a popup (back up now / try again / report / close).
- **Covers** are queued and sent after a save is done, one at a time, never waited for: a rate-limited upload stops the rest quietly and they go with a later save (`uploadCovers`, `noWait` on `spotifyRequest`).
- Wording rule: say nothing about where the recipes are kept, like a Google Doc ("Saved to Spotify"). The exceptions are the manual backup option, the Privacy section, and Clear saved data, which must say what they erase.

**Messages**
- One place for messages: the line under the editor's colored bar (`#feCaption`), which normally shows "N min of music + N min of silence" (hours from an hour up). `showNotices` takes sentences (shown in turn, with "(1 of 3)") or objects with `hold: true` (kept until used, dismissed, or the recipe is edited). `attentionItems()` in app.js lists trouble that stays until fixed (failed save, unreadable saves, too-long recipe, cover problems). A message about something the person just did (`transient`) comes first. Messages wait while the person is editing. Crossfade between texts, none under reduced motion.
- The ⋯ menu button crossfades to `backup-cover.jpg` while a save runs, for at least a second. No dots or badges anywhere.
- Dialogs that need an answer are `askSyncChoice` (editor.js); `required: true` makes them undismissable.

**Startup and versions**
- The inline script in `index.html` shows a popup (`#startupProblem`) when the page's scripts did not start or disagree on version. The first time in a visit it fetches fresh copies of the page and every script (`cache: "reload"`) and loads the page again by itself (`startupRefreshed` in sessionStorage); a clean start clears that mark.
- After a clean start, and when the person returns to the tab after more than 10 minutes, the page fetches `version.txt`. A different stamp with nothing going on reloads once per new stamp (`versionTried`); otherwise a held message offers Reload. No timers.
- The stamp (e.g. `2026-10-31d`) is in `version.txt`, `APP_VERSION` in `app.js`, five places in `index.html` (a check enforces it), and a few checks in `tests/run.js`. Scripts load as `app.js?v=STAMP`. `python3 bump_version.py` sets every one of them (`--check` says whether they agree); run it for every change that goes to the site.
- Releasing: pushing to `main` publishes the site (GitHub Pages). Git uses HTTPS with the `gh` login at `~/.local/bin/gh`.

**Building**
- A song is used once per playlist and once across the playlists made in one run, compared by Spotify ID. A segment may come in up to 10% short; below that the plan says so instead of repeating songs.
- Before building, songs whose artist and title match (case, accents, punctuation and a remaster note ignored) under different IDs are pointed out in the confirmation, with a link to the list (`findSuspects`). The app never guesses that two songs are the same.
- Earlier playlists that share names with the new ones are replaced after a question; a small link renames them instead to `<name> (version a)` (next letter each time) and builds.
- Playlists are named `<recipe name> N`. Built playlists carry a description marker (`APP_MARKER`) so the app knows they are its own.

**Interface**
- Compact view (stored as `minimalMode`, body class `minimal`) shows only the editor. The ⋯ menu: app header, Compact view, a manual-backup block (only in manual mode), the Spotify row (connect / connecting / connected with Disconnect), the version. Disconnect asks first.
- A phone and a wide window differ: below 760 px the silence stepper says "30 sec gaps", wide it says the whole sentence; its width is fixed to the widest wording so the buttons never move under a thumb.
- Lesson: a short class name (`fe-main`) collided with an existing one and turned a title into a pill. Give new blocks their own prefix (`fe-bk-*`, `fe-sp-*`, `fe-notice-*`).

## Writing and working style (Ron's preferences)

- Never use em dashes or en dashes in any text, including page text, comments and docs.
- Page text: no first person except where already approved; plain, brief, specific; no hedging.
- Answers to Ron: brief, essentials only; answer what was asked. Say what was done and what is next. Do not report passing tests (only failures), and do not report time breakdowns.
- For anything visual, show a mockup early (screenshots of the real page with Playwright, Spotify stubbed with `page.route`) and let Ron pick before building. When he says "let's discuss", discuss and do not build.
- Flag language that suggests an AI has feelings or personhood.

## Known issues and open items

- A song listed **twice in one source playlist** can be picked twice in the same segment (`pick` in engine.py counts the entries separately until after the pick). Fix: de-duplicate the pool by URI first.
- Ron is collecting changes from user testing; he sent a partial list and more is coming.
- Not yet verified on real devices or accounts: iPhone Safari behavior (double-tap guard, text selection, back-forward cache, the `pageshow` reset), a real Spotify account's handling of the full CJK range at exactly 300 characters, cover upload on empty playlists and its rate limit, merge between two real devices, the saving crossfade on a phone, the other color themes.
- Decided against: detecting a completed donation (nothing reliable), auto-connect on load (the Connect button stays).

## Tests

See `tests/README.md`. Run the whole suite after every change; it takes about 4 minutes. New behavior gets new checks in a named area; when wording changes, update the checks that read it.
