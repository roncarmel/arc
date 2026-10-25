"""
engine.py: the playlist-planning logic, with no network or file access.

The page (app.js) reads playlists from Spotify and hands this code plain data. This code decides
which songs go where and returns text. It runs inside Pyodide (Python in the browser), and the
same logic runs unchanged in make_playlists.py.
"""
import ast
import json
import random
import re
import unicodedata

MIN_FILL = 0.9  # a segment must reach at least this fraction of its target minutes

# Silent tracks, keyed by length in seconds. Longer pauses are built by combining them, so a
# silence of 2.5 min uses one 30 sec and two 1 min tracks. They may repeat in every playlist
# and never count toward segment minutes.
SILENCE_TRACKS = {
    30: "spotify:track:5kiJ9x6eX37H5J9lyyXkua",
    60: "spotify:track:4iOpD4OvwCi6ndxpNYk4HG",
    180: "spotify:track:5yM42dAylwB17DomSHGcXM",
    300: "spotify:track:7depNAqAh1r9unkIRzibID",
    600: "spotify:track:3mkOlbSv5RYadx0JsjTrKq",
}


def norm(s):
    s = unicodedata.normalize("NFKC", s).replace("\ufe0f", "").replace("\u200d", "")
    return " ".join(s.lower().split())


def pick(tracks, minutes, used):
    """Random songs totaling about `minutes`. Adds chosen URIs to `used`."""
    target = minutes * 60_000
    pool = [t for t in tracks if t["uri"] not in used]
    random.shuffle(pool)
    chosen, rest, total = [], [], 0
    for t in pool:
        if target - total < 30_000:  # within 30 seconds, done
            rest.append(t)
            continue
        new = total + t["ms"]
        # take the song if it fits, or if overshooting lands closer to the target than stopping
        if new <= target or (new - target) < (target - total):
            chosen.append(t)
            total = new
        else:
            rest.append(t)

    # One pass can end a minute or two short, because songs come in lumps of several minutes.
    # Polish: add, drop, or swap a song while that moves the total closer to the target.
    while abs(total - target) > 30_000:
        error = abs(total - target)
        best = None  # (new error, new total, song to remove or None, song to add or None)
        for r in rest:
            candidate = abs(total + r["ms"] - target)
            if candidate < error and (best is None or candidate < best[0]):
                best = (candidate, total + r["ms"], None, r)
        for c in chosen:
            candidate = abs(total - c["ms"] - target)
            if candidate < error and (best is None or candidate < best[0]):
                best = (candidate, total - c["ms"], c, None)
            for r in rest:
                candidate = abs(total - c["ms"] + r["ms"] - target)
                if candidate < error and (best is None or candidate < best[0]):
                    best = (candidate, total - c["ms"] + r["ms"], c, r)
        if best is None:
            break
        _, total, drop, add = best
        if drop is not None:
            chosen.remove(drop)
            rest.append(drop)
        if add is not None:
            rest.remove(add)
            chosen.append(add)
    random.shuffle(chosen)
    used.update(t["uri"] for t in chosen)
    return chosen, total


def seg_parts(spec):
    """A segment source is a playlist name, a list of names (equal split),
    or a {name: weight} dict. Returns [(playlist name, weight)]."""
    if isinstance(spec, dict):
        return list(spec.items())
    if isinstance(spec, (list, tuple)):
        return [(n, 1) for n in spec]
    return [(spec, 1)]


def seg_label(spec):
    parts = seg_parts(spec)
    if len(parts) == 1:
        return parts[0][0]
    total_w = sum(w for _, w in parts)
    return " + ".join(f"{n} {100 * w / total_w:.0f}%" for n, w in parts)


def seg_sources(segments):
    """Every distinct source playlist name used by a list of segments, in order."""
    names = []
    for spec, _ in segments:
        names += [n for n, _ in seg_parts(spec)]
    return list(dict.fromkeys(names))


def build_one(cache, segments, used):
    """Try to build one playlist.
    Returns (segment results, updated used set, None) on success,
    or (None, None, (segment number, source name, minutes wanted, minutes found)) on failure."""
    local = set(used)
    results = []
    for i, (spec, minutes) in enumerate(segments, 1):
        songs, seg_total = [], 0
        remaining, remaining_w = minutes, sum(w for _, w in seg_parts(spec))
        for name, w in seg_parts(spec):
            # each playlist gets its share of the time still unfilled, so an overshoot on
            # one playlist is absorbed by the next and the segment total stays on target
            part_min = remaining * w / remaining_w
            chosen, total = pick(cache[norm(name)], part_min, local)
            if total < part_min * 60_000 * MIN_FILL:
                return None, None, (i, name, round(part_min, 1), total / 60_000)
            songs += chosen
            seg_total += total
            remaining -= total / 60_000
            remaining_w -= w
        random.shuffle(songs)  # interleave the playlists within the segment
        results.append((seg_label(spec), minutes, songs, seg_total))
    return results, local, None


def fmt_duration(ms):
    mins = round(ms / 60_000)
    return f"{mins // 60}h {mins % 60:02d}m"


def leftover_report(cache, segments, used):
    """Song count and total duration still unused in each source playlist of a format."""
    lines = []
    for name in seg_sources(segments):
        left = [t for t in cache[norm(name)] if t["uri"] not in used]
        lines.append(f"  {name}: {len(left)} songs left, {fmt_duration(sum(t['ms'] for t in left))}")
    return "\n".join(lines)


def parse_silence(value):
    """Turn a friendly setting into ([track URIs, longest first], label).

    Accepts "none" or 0, or any length that is a multiple of 30 seconds, written like
    "30 sec", "1 min", "2.5 min", "90s" or "2 min 30 sec". Longer pauses are built from the
    fewest silent tracks that add up to the length."""
    text = str(value).strip().lower()
    if text in ("0", "none", "off", "no", ""):
        return [], "none"
    units = {"s": 1, "sec": 1, "secs": 1, "second": 1, "seconds": 1,
             "m": 60, "min": 60, "mins": 60, "minute": 60, "minutes": 60}
    parts = re.findall(r"(\d+(?:\.\d+)?)\s*([a-z]+)", text)
    leftover = re.sub(r"(\d+(?:\.\d+)?)\s*([a-z]+)", "", text).strip()
    if not parts or leftover or any(u not in units for _, u in parts):
        raise ValueError(f"Can't read silence setting '{value}'. Use none, or a length such as 30 sec, 1 min, 2.5 min.")
    seconds = round(sum(float(n) * units[u] for n, u in parts))
    step = min(SILENCE_TRACKS)
    if seconds <= 0 or seconds % step:
        raise ValueError(f"Silence must be none, or a multiple of {step} seconds (such as 30 sec, 1 min, 2.5 min). Got '{value}'.")
    # fewest tracks that add up to the length (coin change in 30 second steps)
    coins = sorted(SILENCE_TRACKS, reverse=True)
    best = {0: []}
    for total in range(step, seconds + 1, step):
        options = [best[total - c] + [c] for c in coins if total - c in best]
        if options:
            best[total] = min(options, key=len)
    mins, secs = divmod(seconds, 60)
    label = " ".join(x for x in (f"{mins} min" if mins else "", f"{secs} sec" if secs else "") if x)
    return [SILENCE_TRACKS[c] for c in sorted(best[seconds], reverse=True)], label


def plan_format(fmt):
    """Split a format's segment list into its music segments and the silence around them.
    Returns (music, gaps): music is [(source, minutes)], gaps has one more item than music
    and each gap is ([silent track URIs], label), before the first segment, between each
    pair, and after the last."""
    default = parse_silence(fmt.get("silence between segments", "none"))
    none = ([], "none")

    def combine(entries):
        uris = [u for entry in entries for u in entry[0]]
        labels = [entry[1] for entry in entries if entry[1] != "none"]
        return uris, " + ".join(labels) or "none"

    music, gaps, pending = [], [], []  # pending: silence entries since the last segment
    for item in fmt["segments"]:
        if not isinstance(item, (tuple, list)) or len(item) != 2:
            raise ValueError(f"Each entry in segments must be (source, minutes) or (\"silence\", \"5 min\"). Got: {item!r}")
        if item[0] == "silence" and isinstance(item[1], str):
            pending.append(parse_silence(item[1]))
            continue
        if music:
            gaps.append(combine(pending) if pending else default)
        else:
            gaps.append(combine(pending) if pending else none)
        pending = []
        music.append((item[0], item[1]))
    if not music:
        raise ValueError("A format needs at least one segment.")
    gaps.append(combine(pending) if pending else none)
    return music, gaps


def letters(i):
    """0 -> a, 1 -> b, 25 -> z, 26 -> aa"""
    i += 1
    s = ""
    while i:
        i, r = divmod(i - 1, 26)
        s = chr(97 + r) + s
    return s


# ---------------------------------------------------------------- functions called by app.js
def parse_formats(text):
    """Read the formats text. It can be the whole 'FORMATS = {...}' line or just the {...} part."""
    text = re.sub(r"^\s*FORMATS\s*=\s*", "", text.strip())
    try:
        data = ast.literal_eval(text)
    except (ValueError, SyntaxError) as err:
        raise ValueError(f"Could not read the formats: {err}")
    if not isinstance(data, dict) or not data:
        raise ValueError('The formats should look like { "my-format": { "name": ..., "segments": [...] } }.')
    return data


def format_keys(formats_text):
    return json.dumps(list(parse_formats(formats_text)))


def needed_sources(formats_text, key):
    """Names of the source playlists a format uses, as written in the format."""
    fmt = parse_formats(formats_text)[key]
    music, _ = plan_format(fmt)
    return json.dumps(seg_sources(music))


def match_playlists(names_json, playlists_json, me_id):
    """Match source names to playlists the user can read (owned or collaborative)."""
    names = json.loads(names_json)
    playlists = json.loads(playlists_json)
    found, problems = {}, []
    for name in names:
        same_name = [p for p in playlists if norm(p["name"]) == norm(name)]
        readable = [p for p in same_name if p.get("owner") == me_id or p.get("collaborative")]
        if readable:
            found[name] = readable[0]["id"]
        elif same_name:
            problems.append(
                f"'{name}' is not yours. Spotify only lets this app read playlists you own, "
                "so copy its songs into a playlist of your own and use that."
            )
        else:
            problems.append(f"Could not find a playlist named '{name}'.")
    return json.dumps({"found": found, "problems": problems})


def name_pattern(template):
    """Turn a naming template into a regex, e.g. "evocative {n}" matches "evocative 12"."""
    esc = re.escape(template)
    esc = esc.replace(re.escape("{n}"), r"\d+").replace(re.escape("{letter}"), "[a-z]+")
    return re.compile("^" + esc + "$")


def existing_matches(formats_text, keys_json, playlists_json, me_id):
    """Playlists the user owns whose names match the naming templates of the given formats."""
    formats = parse_formats(formats_text)
    patterns = [name_pattern(formats[key]["name"]) for key in json.loads(keys_json)]
    found = [
        {"id": p["id"], "name": p["name"]}
        for p in json.loads(playlists_json)
        if p.get("owner") == me_id and any(pat.match(p["name"]) for pat in patterns)
    ]
    return json.dumps(found)


def _run_format(fmt, cache, limit):
    """Plan as many playlists as the songs allow. Returns (music, gaps, built, stopped, used)."""
    music, gaps = plan_format(fmt)
    used, built, stopped = set(), [], None
    while len(built) < limit:
        results, new_used, fail = build_one(cache, music, used)
        if fail:
            stopped = fail
            break
        used = new_used
        n = len(built)
        built.append((fmt["name"].format(n=n + 1, letter=letters(n)), results))
    return music, gaps, built, stopped, used


def _stop_message(stopped):
    seg, src, wanted, found = stopped
    return (f"Stopped: segment {seg} ('{src}') needed {wanted:g} min "
            f"but only {found:.0f} min of unused songs were available.")


def _cache_from(tracks_json):
    return {norm(name): tracks for name, tracks in json.loads(tracks_json).items()}


def plan_text(formats_text, key, tracks_json, max_n=None, footer=True):
    """Plan every playlist the format can make from the given songs. Nothing is created."""
    fmt = parse_formats(formats_text)[key]
    cache = _cache_from(tracks_json)
    limit = int(max_n) if max_n else 200
    music, gaps, built, stopped, used = _run_format(fmt, cache, limit)

    lines = [f"=== {key} ==="]
    if any(uris for uris, _ in gaps[1:-1]):
        lines.append("Silence between segments: " + ", ".join(label for _, label in gaps[1:-1]))
    if gaps[0][0]:
        lines.append("Silence at the start: " + gaps[0][1])
    if gaps[-1][0]:
        lines.append("Silence at the end: " + gaps[-1][1])
    for name, results in built:
        total = sum(r[3] for r in results)
        songs = sum(len(r[2]) for r in results)
        minutes = ", ".join(f"{r[3] / 60000:.0f}" for r in results)
        lines.append(f"{name}: {songs} songs, {total / 60000:.0f} min  ({minutes})")
    if stopped:
        lines.append(_stop_message(stopped))
    lines.append(f"{key}: {len(built)} playlist(s) planned.")
    lines.append("Left in source playlists after this format:")
    lines.append(leftover_report(cache, music, used))
    if footer:
        lines.append("")
        lines.append("Preview only, nothing was created.")
    return "\n".join(lines)


def build_playlists(formats_text, key, tracks_json, max_n=None):
    """Everything needed to create the playlists: names and the ordered song URIs, silence included."""
    fmt = parse_formats(formats_text)[key]
    cache = _cache_from(tracks_json)
    limit = int(max_n) if max_n else 200
    music, gaps, built, stopped, used = _run_format(fmt, cache, limit)
    playlists = []
    for name, results in built:
        uris = []
        for idx, r in enumerate(results):
            uris += gaps[idx][0]            # silence before this segment (none before the first unless asked)
            uris += [t["uri"] for t in r[2]]
        uris += gaps[-1][0]                 # silence after the last segment (only if asked)
        playlists.append({
            "name": name,
            "uris": uris,
            "songs": sum(len(r[2]) for r in results),
            "minutes": round(sum(r[3] for r in results) / 60000),
        })
    return json.dumps({"key": key, "playlists": playlists,
                       "stopped": _stop_message(stopped) if stopped else None})
