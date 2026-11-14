"""
engine.py: the playlist-planning logic, with no network or file access.

The page (app.js) reads playlists from Spotify and hands this code plain data. This code decides
which songs go where and returns text. It runs inside Pyodide (Python in the browser).
"""
import ast
import json
import random
import re
import unicodedata

MIN_FILL = 0.9  # a segment must reach at least this fraction of its target minutes

# Songs a participant has heard, for a playlist built for them: song id -> when it was last in one of their playlists (a number, larger is later).
# Set by build_playlists for one run. pick() takes songs not in it first, then the ones heard longest ago, so a song comes back only when the
# fresh ones run out. Empty for an ordinary build.
HEARD = {}

# Repeat songs, for a participant's playlist (Ron, 2026-11-13): about SHARE of the playlist's minutes (within REPEAT_SLACK) from the songs in SONGS (their
# most recent playlist, or everything they heard), every song still from its own segment's source playlists. Set by build_playlists for one run; share 0 is off.
REPEAT = {"share": 0, "songs": set()}
REPEAT_SLACK = 0.05

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


def song_id(t):
    """What makes two entries one song: the recording's ISRC when Spotify gives one (the same recording on an album and on a
    compilation has two Spotify IDs but one ISRC), else the Spotify ID."""
    return t.get("key") or t["uri"]


def pick(tracks, minutes, used):
    """Random songs totaling about `minutes`. Adds chosen songs to `used`.
    Songs that only this source playlist has come first, so a song shared with another source is left for it where possible."""
    target = minutes * 60_000
    pool = [t for t in tracks if song_id(t) not in used]
    random.shuffle(pool)
    pool.sort(key=lambda t: bool(t.get("shared")))
    if HEARD:
        # for a participant: the songs they have not heard, then the ones heard longest ago (the sort keeps the order above within each)
        pool.sort(key=lambda t: (song_id(t) in HEARD, HEARD.get(song_id(t), 0)))
        fresh_ms = sum(t["ms"] for t in pool if song_id(t) not in HEARD)
        if fresh_ms >= target * MIN_FILL:
            # enough fresh songs: the heard ones are not used, even to land closer to the minutes
            pool = [t for t in pool if song_id(t) not in HEARD]
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
    used.update(song_id(t) for t in chosen)
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


def pick_with_repeats(tracks, minutes, used, tally):
    """pick() for a part of a segment when REPEAT is on: first the repeat songs this part owes, then the rest from the other songs, then, if those
    run short, more repeat songs to fill it (the share is checked once the playlist is done). `tally` carries [repeat ms, all ms] across parts, so a
    part that came out over or under is made up by the next."""
    pool = REPEAT["songs"]
    again = [t for t in tracks if song_id(t) in pool]
    other = [t for t in tracks if song_id(t) not in pool]
    owed = REPEAT["share"] * (tally[1] + minutes * 60_000) - tally[0]
    chosen, got = pick(again, max(0, owed) / 60_000, used) if owed >= 30_000 else ([], 0)
    more, total = pick(other, max(0, minutes - got / 60_000), used)
    chosen += more
    total += got
    short = minutes * 60_000 - total
    if short >= 30_000:
        extra, add = pick(again, short / 60_000, used)
        chosen += extra
        total += add
        got += add
    tally[0] += got
    tally[1] += total
    random.shuffle(chosen)
    return chosen, total


def build_one(cache, segments, used, order=None):
    """Try to build one playlist. Segments are filled in `order` (the ones with the least to spare first, so they get first pick
    of songs they share with other segments), and come back in their own order.
    Returns (segment results, updated used set, None) on success,
    or (None, None, (segment number, source name, minutes wanted, minutes found)) on failure."""
    local = set(used)
    results = [None] * len(segments)
    tally = [0, 0]   # repeat ms, all ms, when REPEAT is on
    for idx in (order or range(len(segments))):
        spec, minutes = segments[idx]
        i = idx + 1
        songs, seg_total = [], 0
        remaining, remaining_w = minutes, sum(w for _, w in seg_parts(spec))
        for name, w in seg_parts(spec):
            # each playlist gets its share of the time still unfilled, so an overshoot on
            # one playlist is absorbed by the next and the segment total stays on target
            part_min = remaining * w / remaining_w
            if REPEAT["share"]:
                chosen, total = pick_with_repeats(cache[norm(name)], part_min, local, tally)
            else:
                chosen, total = pick(cache[norm(name)], part_min, local)
            if total < part_min * 60_000 * MIN_FILL:
                return None, None, (i, name, round(part_min, 1), total / 60_000)
            songs += chosen
            seg_total += total
            remaining -= total / 60_000
            remaining_w -= w
        random.shuffle(songs)  # interleave the playlists within the segment
        results[idx] = (seg_label(spec), minutes, songs, seg_total)
    return results, local, None


def fill_order(cache, segments):
    """Segment indexes, the one whose source playlists have the fewest minutes to spare first."""
    need = {}
    for spec, minutes in segments:
        parts = seg_parts(spec)
        total_w = sum(w for _, w in parts)
        for name, w in parts:
            need[name] = need.get(name, 0) + minutes * w / total_w
    def spare(idx):
        names = [n for n, _ in seg_parts(segments[idx][0])]
        return min(sum(t["ms"] for t in cache[norm(n)]) / 60_000 / need[n] if need[n] > 0 else float("inf") for n in names)
    return sorted(range(len(segments)), key=spare)


def fmt_duration(ms):
    mins = round(ms / 60_000)
    return f"{mins // 60}h {mins % 60:02d}m"


def leftover_report(cache, segments, used):
    """Song count and total duration still unused in each source playlist of a format."""
    lines = []
    for name in seg_sources(segments):
        left = [t for t in cache[norm(name)] if song_id(t) not in used]
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
        raise ValueError("A recipe needs at least one segment.")
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
    text = re.sub(r"^\s*(?:RECIPES|FORMATS)\s*=\s*", "", text.strip())
    # the app writes a playlist as "name [id:...]" so it can follow a rename; the engine goes by the name alone
    text = re.sub(r" \[id:[0-9A-Za-z_-]{1,64}\](?=[\"'])", "", text)
    try:
        data = ast.literal_eval(text)
    except (ValueError, SyntaxError) as err:
        raise ValueError(f"Could not read the recipes: {err}")
    if not isinstance(data, dict) or not data:
        raise ValueError('The recipes should look like { "recipe-1": { "name": ..., "segments": [...] } }.')
    return data


def format_keys(formats_text):
    return json.dumps(list(parse_formats(formats_text)))


def needed_sources(formats_text, key):
    """Names of the source playlists a format uses, as written in the format."""
    fmt = parse_formats(formats_text)[key]
    music, _ = plan_format(fmt)
    return json.dumps(seg_sources(music))


def source_needs(formats_text, key):
    """Minutes one playlist takes from each source playlist of a format: {name: minutes}."""
    music, _ = plan_format(parse_formats(formats_text)[key])
    need = {}
    for spec, minutes in music:
        parts = seg_parts(spec)
        total_w = sum(w for _, w in parts)
        for name, w in parts:
            need[name] = need.get(name, 0) + minutes * w / total_w
    return json.dumps(need)


def match_playlists(names_json, playlists_json, me_id):
    """Match source names to playlists the user can read (owned or collaborative)."""
    names = json.loads(names_json)
    playlists = json.loads(playlists_json)
    found, problems, missing, not_mine = {}, [], [], []
    for name in names:
        same_name = [p for p in playlists if norm(p["name"]) == norm(name)]
        readable = [p for p in same_name if p.get("owner") == me_id or p.get("collaborative")]
        if readable:
            found[name] = readable[0]["id"]
        elif same_name:
            not_mine.append(name)
            problems.append(
                f"'{name}' is not yours. Spotify only lets this app read playlists you own, "
                "so copy its songs into a playlist of your own and use that."
            )
        else:
            missing.append(name)
            problems.append(f"Could not find a playlist named '{name}'.")
    return json.dumps({"found": found, "problems": problems, "missing": missing, "notMine": not_mine})


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


def _run_format(fmt, cache, limit, reserved=frozenset()):
    """Plan as many playlists as the songs allow. Returns (music, gaps, built, stopped, used).
    Names already in use (reserved) are skipped, so a new playlist never shares a name with one that stays."""
    music, gaps = plan_format(fmt)
    order = fill_order(cache, music)
    used, built, stopped = set(), [], None
    counter = 0
    while len(built) < limit:
        results, new_used, fail = build_one(cache, music, used, order)
        if fail:
            stopped = fail
            break
        used = new_used
        while True:
            name = fmt["name"].format(n=counter + 1, letter=letters(counter))
            counter += 1
            if norm(name) not in reserved:
                break
        built.append((name, results))
    return music, gaps, built, stopped, used


def _stop_message(stopped):
    seg, src, wanted, found = stopped
    return (f"Stopped: segment {seg} ('{src}') needed {wanted:g} min "
            f"but only {found:.0f} min of unused songs were available.")


def _cache_from(tracks_json):
    """Songs by source playlist name. A song listed more than once in a playlist counts once, and a song that is also in
    another of these playlists is marked "shared"."""
    cache = {}
    for name, tracks in json.loads(tracks_json).items():
        seen, songs = set(), []
        for t in tracks:
            if song_id(t) not in seen:
                seen.add(song_id(t))
                songs.append(dict(t))
        cache[norm(name)] = songs
    count = {}
    for songs in cache.values():
        for t in songs:
            count[song_id(t)] = count.get(song_id(t), 0) + 1
    for songs in cache.values():
        for t in songs:
            t["shared"] = count[song_id(t)] > 1
    return cache


def format_label(key, fmt):
    """What people call a format: its title, else its name without the trailing number placeholder, else its key."""
    if not isinstance(fmt, dict):
        return key
    title = fmt.get("title")
    if isinstance(title, str) and title.strip():
        return title
    name = fmt.get("name")
    if isinstance(name, str) and name.endswith(" {n}") and "{" not in name[:-4] and name[:-4].strip():
        return name[:-4]
    return key


def _plan_lines(key, music, gaps, built, stopped, used, cache, label=None):
    """The text shown in a preview, from one planning run."""
    label = label or key
    lines = [f"=== {label} ==="]
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
    lines.append(f"{label}: {len(built)} playlist(s) planned.")
    lines.append("Left in source playlists after this recipe:")
    lines.append(leftover_report(cache, music, used))
    return lines


def plan_text(formats_text, key, tracks_json, max_n=None, footer=True):
    """Plan every playlist the format can make from the given songs. Nothing is created."""
    fmt = parse_formats(formats_text)[key]
    cache = _cache_from(tracks_json)
    limit = int(max_n) if max_n else 200
    music, gaps, built, stopped, used = _run_format(fmt, cache, limit)
    lines = _plan_lines(key, music, gaps, built, stopped, used, cache, format_label(key, fmt))
    if footer:
        lines.append("")
        lines.append("Preview only, nothing was created.")
    return "\n".join(lines)


def gap_seconds(uris):
    """How long a run of silent tracks lasts, in seconds."""
    lengths = {uri: sec for sec, uri in SILENCE_TRACKS.items()}
    return sum(lengths.get(u, 0) for u in uris)


def source_report(cache, music):
    """For each source playlist: the minutes one playlist takes from it, the minutes of songs it has,
    and how many playlists that is enough for, going by minutes alone."""
    per = {}
    for spec, minutes in music:
        parts = seg_parts(spec)
        total_w = sum(w for _, w in parts)
        for name, w in parts:
            per[name] = per.get(name, 0) + minutes * w / total_w
    rows = []
    for name, need in per.items():
        has = sum(t["ms"] for t in cache[norm(name)]) / 60_000
        rows.append({"name": name, "per": round(need, 1), "has": round(has, 1),
                     "enough": int(has // need) if need > 0 else None})
    return rows


def shared_count(cache, music):
    """How many songs are in more than one of a format's source playlists."""
    count = {}
    for name in seg_sources(music):
        for t in cache[norm(name)]:
            count[song_id(t)] = count.get(song_id(t), 0) + 1
    return sum(1 for n in count.values() if n > 1)


def repeat_most(cache, music):
    """About the largest share of a playlist's minutes that can come from REPEAT's songs: each part of each segment takes at most its own minutes
    of them, each song counted once."""
    seen, can, whole = set(), 0, 0
    for spec, minutes in music:
        parts = seg_parts(spec)
        total_w = sum(w for _, w in parts)
        for name, w in parts:
            part = minutes * w / total_w * 60_000
            whole += part
            have = 0
            for t in cache[norm(name)]:
                if song_id(t) in REPEAT["songs"] and song_id(t) not in seen and have < part:
                    seen.add(song_id(t))
                    have += t["ms"]
            can += min(have, part)
    return can / whole if whole else 0


def repeat_share(results):
    """The share of a planned playlist's minutes that are REPEAT's songs."""
    again = sum(t["ms"] for r in results for t in r[2] if song_id(t) in REPEAT["songs"])
    whole = sum(r[3] for r in results)
    return again / whole if whole else 0


def build_playlists(formats_text, key, tracks_json, max_n=None, reserved_json="[]", heard_json="{}", repeat_json="{}"):
    """One planning run that gives both the preview text and everything needed to create the playlists:
    names and ordered song URIs, silence included. Creating from this result makes exactly what was previewed.
    heard_json, for a playlist built for a participant: {song id: when last heard}, songs to use only when the fresh ones run out.
    repeat_json, for a participant's playlist too: {"share": 0 to 1, "songs": [song ids]}, about that share of the minutes from those songs (REPEAT).
    When the songs cannot come within REPEAT_SLACK of it, nothing is planned and "repeat" says how close they come."""
    global HEARD, REPEAT
    HEARD = json.loads(heard_json or "{}") or {}
    rep = json.loads(repeat_json or "{}") or {}
    REPEAT = {"share": float(rep.get("share") or 0), "songs": set(rep.get("songs") or [])}
    fmt = parse_formats(formats_text)[key]
    cache = _cache_from(tracks_json)
    limit = int(max_n) if max_n else 200
    reserved = {norm(name) for name in json.loads(reserved_json or "[]")}
    music, gaps, built, stopped, used = _run_format(fmt, cache, limit, reserved)
    repeat = None
    if REPEAT["share"] and built:
        got = repeat_share(built[0][1])
        if abs(got - REPEAT["share"]) > REPEAT_SLACK:
            # too few of their songs in this recipe's playlists (most: about the largest share that can repeat), or too few new ones (got: the least)
            repeat = {"wanted": round(REPEAT["share"] * 100), "got": round(got * 100), "most": int(repeat_most(cache, music) * 100)}
            built = []
    playlists = []
    for name, results in built:
        uris = []
        for idx, r in enumerate(results):
            uris += gaps[idx][0]            # silence before this segment (none before the first unless asked)
            uris += [t["uri"] for t in r[2]]
        uris += gaps[-1][0]                 # silence after the last segment (only if asked)
        # the shape of this playlist, for the small bar beside it: [minutes, is silence], in order
        pieces = []
        for idx, r in enumerate(results):
            if gaps[idx][0]:
                pieces.append([gap_seconds(gaps[idx][0]) / 60, True])
            pieces.append([round(r[3] / 60_000, 1), False])
        if gaps[-1][0]:
            pieces.append([gap_seconds(gaps[-1][0]) / 60, True])
        playlists.append({
            "name": name,
            "uris": uris,
            "songs": sum(len(r[2]) for r in results),
            "minutes": round(sum(r[3] for r in results) / 60000),
            "length": round((sum(r[3] for r in results) / 1000 + sum(gap_seconds(g[0]) for g in gaps)) / 60),
            "pieces": pieces,
            # the segments in order, for the playlist's description: [source names joined with " + ", minutes of music]
            "segments": [[" + ".join(n for n, _ in seg_parts(music[idx][0])), round(r[3] / 60_000)] for idx, r in enumerate(results)],
        })
    sources = source_report(cache, music)
    # What ran out, and how many more minutes of songs it needed for one more playlist. Not when the limit on the number was reached first.
    ran_out = None
    if stopped:
        ran_out = {"name": stopped[1], "more": max(1, -int(-(stopped[2] - stopped[3]) // 1))}
    # With nothing planned, every source playlist that is too short on its own. Most of the time the minutes alone tell;
    # when they do not (the songs did not fit), it is the one the engine stopped on.
    short = []
    if not built and not repeat:
        short = [{"name": r["name"], "need": r["per"], "has": r["has"]} for r in sources if r["has"] < r["per"] * MIN_FILL]
        if not short and stopped:
            # there are enough minutes, but the song lengths cannot add up to the segment's length closely enough
            has = next((r["has"] for r in sources if r["name"] == stopped[1]), round(stopped[3], 1))
            short = [{"name": stopped[1], "need": stopped[2], "has": has, "fit": True}]
    HEARD = {}   # only for this run
    REPEAT = {"share": 0, "songs": set()}
    return json.dumps({"key": key, "playlists": playlists, "sources": sources, "ranOut": ran_out, "short": short, "repeat": repeat,
                       "shared": shared_count(cache, music),
                       "stopped": _stop_message(stopped) if stopped else None,
                       "text": "\n".join(_plan_lines(key, music, gaps, built, stopped, used, cache, format_label(key, fmt)))})
