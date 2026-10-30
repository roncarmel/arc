// formats.js: turns the formats text into a list the editor can show, and back again.
//
// The text is the same Python-style text the engine reads (engine.py). The editor never asks people to
// type it; it only keeps it up to date. Nothing in this file touches the page.

// Silence lengths the editor steps through, in seconds: 30 sec, 1 to 10 min by the minute, then every 5 min up to 60 min
const SILENCE_STEPS = [30, 60, 120, 180, 240, 300, 360, 420, 480, 540, 600, 900, 1200, 1500, 1800, 2100, 2400, 2700, 3000, 3300, 3600];
// The default silence between segments, in seconds: none, then the same lengths as any other silence
const GAP_STEPS = [0].concat(SILENCE_STEPS);
let ROW_SEQ = 0;

// ---------------------------------------------------------------- reading Python-style literals
class PyDict {
  constructor(pairs) { this.pairs = pairs; }   // a list of [key, value], so the order is kept
  has(key) { return this.pairs.some((p) => p[0] === key); }
  get(key) { const p = this.pairs.find((q) => q[0] === key); return p ? p[1] : undefined; }
}

function parsePythonLiteral(text) {
  let i = 0;
  const n = text.length;
  const fail = (message) => {
    const line = text.slice(0, i).split("\n").length;
    throw new Error(`Could not read the formats: ${message} (line ${line}).`);
  };
  function skip() {
    while (i < n) {
      const c = text[i];
      if (c === " " || c === "\t" || c === "\n" || c === "\r") i += 1;
      else if (c === "#") { while (i < n && text[i] !== "\n") i += 1; }
      else break;
    }
  }
  function string() {
    const quote = text[i];
    if (text.startsWith(quote.repeat(3), i)) fail("triple quotes are not supported");
    i += 1;
    let out = "";
    while (true) {
      if (i >= n) fail("a quotation mark is missing its closing partner");
      const c = text[i];
      if (c === quote) { i += 1; return out; }
      if (c === "\n") fail("a quotation mark is missing its closing partner");
      if (c === "\\") {
        const e = text[i + 1];
        i += 2;
        const simple = { n: "\n", t: "\t", r: "\r", "\\": "\\", "'": "'", '"': '"', "0": "\0", a: "\x07", b: "\b", f: "\f", v: "\v" };
        if (e === "\n") continue;
        if (e in simple) out += simple[e];
        else if (e === "x") { out += String.fromCharCode(parseInt(text.slice(i, i + 2), 16)); i += 2; }
        else if (e === "u") { out += String.fromCharCode(parseInt(text.slice(i, i + 4), 16)); i += 4; }
        else if (e === "U") { out += String.fromCodePoint(parseInt(text.slice(i, i + 8), 16)); i += 8; }
        else out += "\\" + e;
        continue;
      }
      out += c;
      i += 1;
    }
  }
  function number() {
    const m = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(text.slice(i));
    if (!m) fail("I expected a number");
    i += m[0].length;
    return Number(m[0]);
  }
  function sequence(close, isTuple) {
    i += 1;
    const items = [];
    let trailingComma = false;
    while (true) {
      skip();
      if (text[i] === close) { i += 1; break; }
      items.push(value());
      skip();
      trailingComma = false;
      if (text[i] === ",") { i += 1; trailingComma = true; continue; }
      if (text[i] === close) { i += 1; break; }
      fail(`I expected a comma or a closing "${close}"`);
    }
    // Python reads ("x") as just "x", and only ("x",) as a one-item tuple
    return isTuple && items.length === 1 && !trailingComma ? items[0] : items;
  }
  function dict() {
    i += 1;
    const pairs = [];
    while (true) {
      skip();
      if (text[i] === "}") { i += 1; break; }
      const key = value();
      skip();
      if (text[i] !== ":") fail('I expected a ":" after a name');
      i += 1;
      pairs.push([key, value()]);
      skip();
      if (text[i] === ",") { i += 1; continue; }
      if (text[i] === "}") { i += 1; break; }
      fail('I expected a comma or a closing "}"');
    }
    return new PyDict(pairs);
  }
  function value() {
    skip();
    const c = text[i];
    if (c === undefined) fail("the text ends too early");
    if (c === "{") return dict();
    if (c === "[") return sequence("]", false);
    if (c === "(") return sequence(")", true);
    if (c === '"' || c === "'") return string();
    if (c === "-" || c === "+" || c === "." || (c >= "0" && c <= "9")) return number();
    const word = /^[A-Za-z_]\w*/.exec(text.slice(i));
    if (word) {
      if (word[0] === "True") { i += 4; return true; }
      if (word[0] === "False") { i += 5; return false; }
      if (word[0] === "None") { i += 4; return null; }
      fail(`I don't understand "${word[0]}"`);
    }
    fail(`I don't understand "${c}"`);
  }
  const result = value();
  skip();
  if (i < n) fail("there is extra text after the formats");
  return result;
}

function parseFormatsText(text, allowEmpty) {
  const cleaned = String(text).trim().replace(/^FORMATS\s*=\s*/, "");
  const data = parsePythonLiteral(cleaned);
  if (!(data instanceof PyDict) || (!data.pairs.length && !allowEmpty)) {
    throw new Error('The formats should look like { "format-1": { "name": ..., "segments": [...] } }.');
  }
  return data;
}

// ---------------------------------------------------------------- silence lengths
function parseSilenceSeconds(value) {
  const text = String(value).trim().toLowerCase();
  if (["0", "none", "off", "no", ""].includes(text)) return 0;
  const units = { s: 1, sec: 1, secs: 1, second: 1, seconds: 1, m: 60, min: 60, mins: 60, minute: 60, minutes: 60 };
  const re = /(\d+(?:\.\d+)?)\s*([a-z]+)/g;
  let total = 0;
  let found = false;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (!(m[2] in units)) throw new Error(`Can't read silence setting '${value}'. Use none, or a length such as 30 sec, 1 min, 2.5 min.`);
    total += parseFloat(m[1]) * units[m[2]];
    found = true;
  }
  const leftover = text.replace(/(\d+(?:\.\d+)?)\s*([a-z]+)/g, "").trim();
  if (!found || leftover) throw new Error(`Can't read silence setting '${value}'. Use none, or a length such as 30 sec, 1 min, 2.5 min.`);
  return Math.round(total);
}

function formatSilenceText(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return [mins ? `${mins} min` : "", secs ? `${secs} sec` : ""].filter(Boolean).join(" ") || "30 sec";
}

function describeSeconds(seconds) {
  if (seconds < 60) return `${seconds} sec`;
  return seconds % 60 === 0 ? `${seconds / 60} min` : `${(seconds / 60).toFixed(1)} min`;
}

function describeClock(minutes) {
  const m = Math.round(minutes);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} hr${m % 60 ? " " + (m % 60) + " min" : ""}`;
}

// ---------------------------------------------------------------- playlist names, as the engine compares them
function normName(s) {
  return String(s).normalize("NFKC").replace(/\ufe0f/g, "").replace(/\u200d/g, "").toLowerCase().split(/\s+/).filter(Boolean).join(" ");
}

// ---------------------------------------------------------------- the text and the editor's list
// A format here is { id, title, gap, gaps, lead, items: [...] }.
//   items   the segments: { id, kind: "seg", lists: [{ name, weight }], minutes }
//   gap     the default silence between every two segments, in seconds (0 is none)
//   gaps    one entry per place a silence can go: gaps[g] is the silence between segment g-1 and segment g, and
//           gaps[items.length] is the silence after the last one (gaps[0] is not used).
//           undefined: follows the default (between segments) or no silence (after the last one)
//           0: no silence here, although the default says there should be one
//           a number of seconds: a silence of its own
//   lead    a silence before the first segment, kept only so formats that already have one keep playing the same
//           (the editor does not show it)
// The title is what people see; the playlists made from it are called "<title> 1", "<title> 2", and so on.

// What is in gap g: its length, whether the editor draws a tag for it, and how it relates to the default.
function gapInfo(f, g) {
  const n = f.items.length;
  const interior = g > 0 && g < n;
  const hasDefault = interior && f.gap > 0;
  if (g <= 0 || g > n) return { sec: 0, show: false, zero: false, custom: false, interior: false, hasDefault: false };
  const raw = f.gaps[g];
  if (raw === undefined) return { sec: interior ? f.gap : 0, show: hasDefault, zero: false, custom: false, interior, hasDefault };
  if (raw === 0) return { sec: 0, show: hasDefault, zero: true, custom: true, interior, hasDefault };   // only worth showing where there is a default to override
  return { sec: raw, show: true, zero: false, custom: true, interior, hasDefault };
}

function shortSeconds(sec) {
  return sec < 60 ? `${sec}s` : `${+(sec / 60).toFixed(1)}m`;
}

function ensureGaps(f) {
  const want = f.items.length + 1;
  const gaps = Array.isArray(f.gaps) ? f.gaps.slice(0, want) : [];
  while (gaps.length < want) gaps.push(undefined);
  gaps[0] = undefined;
  f.gaps = gaps;
  if (typeof f.gap !== "number" || f.gap < 0) f.gap = 0;
  if (typeof f.lead !== "number" || f.lead < 0) f.lead = 0;
  return f;
}

function cleanTitle(title) {
  // Braces mean something to the engine, so only the two naming placeholders may stay.
  return String(title)
    .replace(/\{n\}/g, "\u0001").replace(/\{letter\}/g, "\u0002")
    .replace(/[{}]/g, "")
    .replace(/\u0001/g, "{n}").replace(/\u0002/g, "{letter}");
}

function nameFromTitle(title) {
  const t = cleanTitle(title);
  return /\{n\}|\{letter\}/.test(t) ? t : `${t} {n}`;
}

function titleFromName(name, fallback) {
  if (typeof name !== "string") return fallback;
  return name.endsWith(" {n}") ? name.slice(0, -4) : name;
}

function textToModel(text, allowEmpty) {
  const root = parseFormatsText(text, allowEmpty);
  const formats = root.pairs.map(([key, fmt]) => {
    if (!(fmt instanceof PyDict)) throw new Error(`The format "${key}" should look like { "name": ..., "segments": [...] }.`);
    const segments = fmt.get("segments");
    if (!Array.isArray(segments)) throw new Error(`The format "${key}" needs a segments list.`);
    const gap = fmt.has("silence between segments") ? parseSilenceSeconds(fmt.get("silence between segments")) : 0;
    const items = [];
    const gaps = [undefined];
    let lead = 0;
    let pending = null;   // seconds of silence written since the last segment, or null when there was none
    segments.forEach((entry) => {
      if (!Array.isArray(entry) || entry.length !== 2) {
        throw new Error('Each entry in segments must be (source, minutes) or ("silence", "5 min").');
      }
      const [spec, amount] = entry;
      if (spec === "silence" && typeof amount === "string") {
        pending = (pending || 0) + parseSilenceSeconds(amount);
        return;
      }
      const minutes = Number(amount);
      if (!Number.isFinite(minutes) || minutes <= 0) throw new Error(`A segment needs a number of minutes, such as ("Warm up", 20). Got: ${JSON.stringify(amount)}.`);
      let lists;
      if (spec instanceof PyDict) lists = spec.pairs.map(([name, weight]) => ({ ...splitPlaylistRef(name), weight: Number(weight) || 1 }));
      else if (Array.isArray(spec)) lists = spec.map((name) => ({ ...splitPlaylistRef(name), weight: 1 }));
      else lists = [{ ...splitPlaylistRef(spec), weight: 1 }];
      if (items.length === 0) lead = pending || 0;
      else gaps[items.length] = pending === null ? undefined : pending;
      pending = null;
      items.push({ id: `r${++ROW_SEQ}`, kind: "seg", lists, minutes });
    });
    if (!items.length) throw new Error(`The format "${key}" needs at least one segment with a playlist.`);
    gaps[items.length] = pending && pending > 0 ? pending : undefined;
    const rawTitle = fmt.get("title");
    const title = typeof rawTitle === "string" ? rawTitle : titleFromName(fmt.get("name"), String(key));
    return ensureGaps({ id: String(key), title, gap, gaps, lead, items });
  });
  return { formats };
}

function pyString(s) { return JSON.stringify(String(s)); }

// A playlist in the saved text is its name followed by its Spotify ID: "Soft landing [id:37i9dQZF1DXcBWIGoYBM5M]". The ID is what the app goes by, so a
// playlist keeps working after it is renamed in Spotify; the name stays in the text so the text can be read, and is what the engine sees.
function splitPlaylistRef(text) {
  const m = String(text).match(/^(.*) \[id:([0-9A-Za-z_-]{1,64})\]$/s);
  return m ? { name: m[1], id: m[2] } : { name: String(text) };
}
function withoutPlaylistIds(text) {
  return String(text).replace(/ \[id:[0-9A-Za-z_-]{1,64}\](?=["'])/g, "");
}
function joinPlaylistRef(list) {
  return list.id ? `${list.name} [id:${list.id}]` : list.name;
}

function modelToText(model) {
  const out = ["FORMATS = {"];
  for (const fmt of model.formats) {
    ensureGaps(fmt);
    const n = fmt.items.length;
    out.push(`    ${pyString(fmt.id)}: {`);
    out.push(`        "title": ${pyString(cleanTitle(fmt.title))},`);
    out.push(`        "name": ${pyString(nameFromTitle(fmt.title))},`);
    out.push(`        "silence between segments": ${fmt.gap > 0 ? pyString(formatSilenceText(fmt.gap)) : '"none"'},`);
    out.push('        "segments": [');
    if (fmt.lead > 0) out.push(`            ("silence", ${pyString(formatSilenceText(fmt.lead))}),`);
    fmt.items.forEach((item, index) => {
      if (item.lists.length === 1) {
        out.push(`            (${pyString(joinPlaylistRef(item.lists[0]))}, ${item.minutes}),`);
      } else {
        const pairs = item.lists.map((l) => `${pyString(joinPlaylistRef(l))}: ${l.weight}`).join(", ");
        out.push(`            ({${pairs}}, ${item.minutes}),`);
      }
      const g = index + 1;
      const raw = fmt.gaps[g];
      if (g < n) {
        if (raw !== undefined && !(raw === 0 && fmt.gap === 0)) out.push(`            ("silence", ${raw === 0 ? '"none"' : pyString(formatSilenceText(raw))}),`);
      } else if (raw > 0) {
        out.push(`            ("silence", ${pyString(formatSilenceText(raw))}),`);
      }
    });
    out.push("        ],");
    out.push("    },");
  }
  out.push("}");
  return out.join("\n");
}

function newFormatId(model) {
  const taken = new Set(model.formats.map((f) => f.id));
  let id;
  do { id = "format-" + Math.random().toString(36).slice(2, 7); } while (taken.has(id));
  return id;
}

function newBlankFormat(model, title) {
  return ensureGaps({ id: newFormatId(model), title, gap: 0, gaps: [], lead: 0, items: [{ id: `r${++ROW_SEQ}`, kind: "seg", lists: [{ name: "", weight: 1 }], minutes: 30 }] });
}

// The model for a first visit: one format with one segment waiting for a playlist.
function defaultModel() {
  return { formats: [ensureGaps({ id: "format-1", title: "Generated playlist", gap: 0, gaps: [], lead: 0, items: [{ id: `r${++ROW_SEQ}`, kind: "seg", lists: [{ name: "", weight: 1 }], minutes: 30 }] })] };
}

// How much of a two-playlist mix is the first playlist, as a whole percent.
function mixPercentA(item) {
  const total = item.lists.reduce((n, l) => n + l.weight, 0) || 1;
  return Math.round((100 * item.lists[0].weight) / total);
}
