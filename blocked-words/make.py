#!/usr/bin/env python3
"""Makes blocked-words.json: the words Music sharing does not accept in mood words and Other names.

Sources, in this folder:
  surge-ai.csv     Surge AI's English profanity list (github.com/surge-ai/profanity, taken down; recovered from the Wayback Machine)
  dsojevic.json    github.com/dsojevic/profanity-list en.json (MIT)
Decided by Ron, 2026-11-08: every word on both lists, except everyday words on Surge's and most of dsojevic's mildest level.
Matching is whole words only (sharing.js blockedWord, worker.js blockedWord), so exceptions for partial matching are not needed.
Run: python3 blocked-words/make.py
"""
import csv, json, os, re, unicodedata

HERE = os.path.dirname(os.path.abspath(__file__))
SURGE_ALLOW = {"crow", "finger", "forked", "peter", "abbie", "wang", "sack", "sheet", "swine", "tart", "buttermilk", "knickers", "tramp", "coot", "dong", "knob", "booty", "suck", "dolt", "hustler"}
MILD_BLOCK = {"kraut", "wog", "mayonnaise-monkey", "dingleberry", "sod-off", "sodding", "boob", "pubes", "venus-mound", "bollocks", "bugger"}   # dsojevic ids at severity 1


def norm(s):
    """The same as the page and the worker: lower case, no accents, anything but letters and numbers a space."""
    s = unicodedata.normalize("NFKD", s.lower())
    s = "".join(c for c in s if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


words, patterns = set(), set()
with open(os.path.join(HERE, "surge-ai.csv"), newline="", encoding="utf-8") as f:
    for row in csv.DictReader(f):
        t = row["text"].strip().lower()
        if t in SURGE_ALLOW or not re.fullmatch(r"[a-z0-9' -]+", t):   # spellings with marks a tag cannot hold (@55, f*ck) never match a cleaned word
            continue
        n = norm(t)
        if len(n) >= 2:
            words.add(n)
for e in json.load(open(os.path.join(HERE, "dsojevic.json"), encoding="utf-8")):
    if e["severity"] == 1 and e["id"] not in MILD_BLOCK:
        continue
    for m in e["match"].split("|"):
        m = norm(m.replace("*", "qzxq")).replace("qzxq", "*") if "*" in m else m.strip().lower()   # marks a space, as in a cleaned word
        if "*" in m:   # a star repeats the letter before it
            patterns.add("".join(re.escape(c) + ("+" if i + 1 < len(m) and m[i + 1] == "*" else "") for i, c in enumerate(m) if c != "*").replace("\\ ", " "))
        else:
            n = norm(m)
            if len(n) >= 2:
                words.add(n)
out = {"words": sorted(words), "patterns": sorted(patterns)}
with open(os.path.join(HERE, "blocked-words.json"), "w", encoding="utf-8") as f:
    json.dump(out, f, separators=(",", ":"))
print(len(out["words"]), "words,", len(out["patterns"]), "patterns")
