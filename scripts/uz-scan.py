#!/usr/bin/env python3
"""Uzbek typography scan: classify violations per the guide.
- A: in-word straight apostrophe [A-Za-z]'[A-Za-z]
- B: em dash —
- C: straight-quoted phrases that look like visible copy (heuristic)
- D: o/g + apostrophe immediately before a quote/delimiter (regex edge case)
Output: report grouped by file, only for files under src/ (ts/tsx/css).
"""
import re
import pathlib

ROOT = pathlib.Path("/home/z/my-project/src")
FILES = sorted(p for p in ROOT.rglob("*") if p.suffix in (".ts", ".tsx", ".css"))

RE_A = re.compile(r"[A-Za-z]'[A-Za-z]")
RE_D = re.compile(r"[oOgG]'[\"'<>]")
RE_EM = "—"
# strings in double quotes that contain a lowercase-heavy latin phrase of 2+ words
RE_C = re.compile(r'"([a-zà-ÿʻʼ][A-Za-zà-ÿʻʼ .,\d«»!?/-]{3,60})"')

tot = {"A": 0, "B": 0, "C": 0, "D": 0}
for f in FILES:
    try:
        lines = f.read_text(encoding="utf-8").splitlines()
    except Exception as e:
        print(f"!! cannot read {f}: {e}")
        continue
    hits = []
    for i, ln in enumerate(lines, 1):
        if RE_A.search(ln):
            hits.append(("A", i, ln.strip()))
        if RE_EM in ln:
            hits.append(("B", i, ln.strip()))
        if RE_D.search(ln):
            hits.append(("D", i, ln.strip()))
        for m in RE_C.finditer(ln):
            # heuristic: at least 2 space-separated tokens, no uppercase-heavy code feel
            s = m.group(1)
            toks = s.split()
            if len(toks) >= 2 and sum(ch.islower() for ch in s) >= len(s) * 0.5:
                hits.append(("C", i, f'"{s}"'))
    if hits:
        rel = f.relative_to("/home/z/my-project")
        print(f"\n=== {rel} ===")
        for kind, i, txt in hits:
            tot[kind] += 1
            print(f"  [{kind}] L{i}: {txt[:220]}")

print(f"\nTOTALS: A={tot['A']} B={tot['B']} C={tot['C']} D={tot['D']}")
