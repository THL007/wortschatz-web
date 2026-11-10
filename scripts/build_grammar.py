"""Build public/data/grammar.json from the user's curated German grammar inventory (Nantia vault).

Usage: python3 -I scripts/build_grammar.py <grammar_de.csv> public/data
Levels A1-C1 (the app's levels). Order inside a level = order in the CSV (teaching order).
"""
import csv
import json
import sys

src, out = sys.argv[1:3]
LEVELS = ["A1", "A2", "B1", "B2", "C1"]
topics = []
for i, r in enumerate(csv.DictReader(open(src, encoding="utf-8"))):
    if r["lang"] != "de" or r["cefrLevel"] not in LEVELS:
        continue
    topics.append({"id": f"g:{r['name']}", "name": r["name"], "label": r["label"], "level": r["cefrLevel"], "category": r["category"], "order": i})
with open(f"{out}/grammar.json", "w", encoding="utf-8") as fh:
    json.dump(topics, fh, ensure_ascii=False, separators=(",", ":"))
for lv in LEVELS:
    print(lv, sum(1 for t in topics if t["level"] == lv))
