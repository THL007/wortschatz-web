"""Build public word data (A1-C1) from wordhoard v0.1.0 (CC BY-SA 4.0).

Usage: python3 -I scripts/build_words.py <de_wordhoard.csv> public/data
Only openly licensed data goes in: no Goethe / Hueber material (local-only, see README).
Per level: nouns with gender (article, plural) and verbs with conjugation forms,
ordered by OpenSubtitles frequency rank (most frequent first).
"""
import csv
import json
import re
import sys

src, out = sys.argv[1:3]
csv.field_size_limit(10**9)
LEVELS = ["A1", "A2", "B1", "B2", "C1"]
words = {lv: [] for lv in LEVELS}
seen = set()

for r in csv.DictReader(open(src, encoding="utf-8")):
    lv, pos, lem = r["cefr_estimate"], r["pos"], r["lemma"]
    if lv not in words or pos not in ("NOUN", "VERB") or (lem, pos) in seen:
        continue
    if len(lem) < 3 or not re.fullmatch(r"[a-zäöüß]+", lem):
        continue
    forms = {}
    for part in (r["forms"] or "").split(";"):
        if ":" in part:
            f, feat = part.rsplit(":", 1)
            forms.setdefault(feat, f)
    item = {"id": f"{pos[0].lower()}:{lem}", "lemma": lem, "pos": pos,
            "rank": int(r["frequency_rank"]), "level": lv,
            "anchored": r["notes"].startswith("cefr:anchor")}
    if pos == "NOUN":
        if r["gender"] not in ("der", "die", "das") or "nom.sg" not in forms:
            continue
        item.update(word=forms["nom.sg"], gender=r["gender"], plural=forms.get("nom.pl"))
    else:
        if "pres.3sg" not in forms and "part.perf" not in forms:
            continue
        item.update(word=lem, p3=forms.get("pres.3sg"), pp=forms.get("part.perf"))
    seen.add((lem, pos))
    words[lv].append(item)

for lv in LEVELS:
    words[lv].sort(key=lambda x: x["rank"])
    with open(f"{out}/{lv}.json", "w", encoding="utf-8") as fh:
        json.dump(words[lv], fh, ensure_ascii=False, separators=(",", ":"))
    n = sum(1 for w in words[lv] if w["pos"] == "NOUN")
    print(lv, len(words[lv]), "nouns", n, "verbs", len(words[lv]) - n)
