"""
bump_version.py: sets the app's version stamp everywhere it appears, in one go.

The site has no build step, so the stamp is written out in each place that needs it:
  index.html   the app-version meta tag, and ?v= on every script, so browsers fetch the new copies
  app.js       APP_VERSION, so a page that loaded an old script notices the two differ
  version.txt  what a running page asks for, to find out a newer version is on the site

  python3 bump_version.py            next stamp: today's date and the next letter (2026-10-31d -> 2026-10-31e)
  python3 bump_version.py 2026-11-02a  that stamp
  python3 bump_version.py --check    only says whether the three files agree
"""
import datetime
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent
STAMP = r"[A-Za-z0-9._-]{4,40}"
PLACES = [  # file, pattern with the stamp as group 2
    ("index.html", rf'(<meta name="app-version" content=")({STAMP})(")'),
    ("index.html", rf'(\.js\?v=)({STAMP})(")'),
    ("app.js", rf'(const APP_VERSION = ")({STAMP})(";)'),
    ("version.txt", rf"(\A)({STAMP})(\s*\Z)"),
]


def found():
    stamps = {}
    for name, pattern in PLACES:
        for m in re.finditer(pattern, (ROOT / name).read_text()):
            stamps.setdefault(m.group(2), []).append(name)
    return stamps


def next_stamp(current):
    today = datetime.date.today().isoformat()
    m = re.fullmatch(r"(\d{4}-\d{2}-\d{2})([a-z]*)", current)
    if not m or m.group(1) != today:
        return today + "a"
    letters = m.group(2) or "`"
    # a..z, then za..zz, and so on: one more letter each time z is reached
    letters = letters[:-1] + chr(ord(letters[-1]) + 1) if letters[-1] != "z" else letters + "a"
    return today + letters


def main(args):
    stamps = found()
    if args == ["--check"]:
        if len(stamps) == 1:
            print(f"All agree: {next(iter(stamps))}")
            return 0
        print("The stamps differ:", "; ".join(f"{s} in {', '.join(sorted(set(f)))}" for s, f in stamps.items()))
        return 1
    if len(stamps) != 1:
        print("The stamps differ before the change, so it is not clear which is current:", ", ".join(stamps))
        print("Give the new stamp: python3 bump_version.py <stamp>")
        if not args:
            return 1
    new = args[0] if args else next_stamp(next(iter(stamps)))
    if not re.fullmatch(STAMP, new):
        print(f"Not a stamp: {new}")
        return 1
    for name in sorted({n for n, _ in PLACES}):
        path = ROOT / name
        text = path.read_text()
        for n, pattern in PLACES:
            if n == name:
                text = re.sub(pattern, lambda m: m.group(1) + new + m.group(3), text)
        path.write_text(text)
    print(f"{', '.join(stamps)} -> {new}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
