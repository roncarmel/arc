"""
make_splash.py: the launch pictures an iPhone shows while the Home Screen app starts, in place of a white screen.

Each is the page's plain background, dark or light (the default theme's --bg), one per screen size in sizes.json, so the launch screen
(#launchScreen in index.html) comes in over it. A picture with the icon and name was tried and could not line up with the launch screen:
the picture covers the whole screen while the page starts below the status bar (Ron, 2026-11-07).

    python3 splash/make_splash.py

New sizes go in sizes.json and in the apple-touch-startup-image links in index.html. Needs Pillow.
"""
import json
import pathlib

from PIL import Image

HERE = pathlib.Path(__file__).resolve().parent
COLORS = {"dark": "#151517", "light": "#ffffff"}

for w, h, r in json.loads((HERE / "sizes.json").read_text()):
    for scheme, color in COLORS.items():
        Image.new("RGB", (w * r, h * r), color).save(HERE / f"launch-{w * r}x{h * r}-{scheme}.png", optimize=True)
