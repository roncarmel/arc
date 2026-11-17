// shared-service.js: what every music service file uses (service-spotify.js, service-tidal.js), and the page with them: the hooks the page fills, the
// sign-in's helpers (PKCE), this page's address and window, requests that give up when nothing answers, and the record kept in this browser. Loaded first.
(globalThis.scriptVersions = globalThis.scriptVersions || {})["shared-service.js"] = "261116a";   // this file's version, checked against the app's at startup

const serviceHooks = {
  scopes: "",                  // the permissions the sign-in asks for, space separated; empty: the service's own
  requiredScopes: null,        // a kept sign-in without all of these is not used; null: the service's own
  log: (text) => {},           // a step, for problem reports
  oldSignIn: () => {},         // a kept sign-in was missing a required permission and was dropped
  expiredText: () => "Your sign-in expired. Connect again.",
  signInExpired: (message) => {},   // the sign-in ran out and could not be renewed
  refusedText: (what) => `This was not allowed (${what}). Sign in again and approve every permission it asks for.`,
  pauseStarted: (first) => {}, // a long wait from the service began (first: none was running)
  pauseChanged: (secondsLeft) => {},   // every second of a wait, and once with 0 at its end
  pauseEnded: () => {},        // the wait is over: time to connect again
};

function redirectUri() {
  // The exact address of this page. It must be added to the service app's redirect URIs.
  return location.origin + location.pathname.replace(/index\.html$/, "");
}

function randomString(length) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

function base64url(buffer) {
  let text = "";
  for (const b of new Uint8Array(buffer)) text += String.fromCharCode(b);
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sha256(text) {
  return crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
}

// the window that holds the page: itself, or, in Developer options' Phone width frame, the outer page (Spotify's sign-in will not open in a frame)
function pageWindow() {
  try { if (window.top !== window && window.top.location.origin === location.origin && window.top.document.getElementById("devPhoneFrame")) return window.top; } catch (e) {}
  return window;
}

// A request that gets no answer at all (a stalled connection) fails after this long, instead of waiting for the browser to give up.
let answerLimitMs = 30000;
async function fetchWithAnswerLimit(url, init, noAnswer = `${service.name} did not answer. Check your internet connection and try again.`) {
  const stop = new AbortController();
  const timer = setTimeout(() => stop.abort(), answerLimitMs);
  try {
    return await fetch(url, { ...init, signal: stop.signal });
  } catch (err) {
    if (stop.signal.aborted) throw new Error(noAnswer);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// the record each service keeps in this browser (requests per minute, refusals), as JSON in localStorage
function readRecord(key, empty) {
  try { const v = JSON.parse(localStorage.getItem(key) || "null"); return v && typeof v === "object" ? v : empty; } catch (err) { return empty; }
}
function writeRecord(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (err) { /* private browsing, or full */ }
}
