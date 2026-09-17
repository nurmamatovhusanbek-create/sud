#!/usr/bin/env python3
"""uz-fix3: data-layer no-value sentinel '—' -> '-' (guide §3) + widen comparisons."""
import pathlib
import sys

ROOT = pathlib.Path("/home/z/my-project")
FAILED = []

def apply(rel, pairs):
    p = ROOT / rel
    s = p.read_text(encoding="utf-8")
    for old, new, cnt in pairs:
        found = s.count(old)
        if cnt is not None and found != cnt:
            FAILED.append(f"{rel}: expected {cnt}, found {found} for {old[:70]!r}")
            continue
        s = s.replace(old, new)
        print(f"  {rel}: {found} × {old[:50]!r}")
    p.write_text(s, encoding="utf-8")

# 1) court-case.ts: all no-value defaults '—' -> '-'
p = ROOT / "src/lib/court-case.ts"
s = p.read_text(encoding="utf-8")
n1 = s.count("|| '—'")
n2 = s.count(": '—',")
s = s.replace("|| '—'", "|| '-'").replace(": '—',", ": '-',")
# L858 guard reads RAW upstream result (sud.uz may still send '—') — accept both dashes
old_guard = "const reviewDecision = review.result && review.result !== '—' ? {"
new_guard = "const reviewDecision = review.result && review.result !== '—' && review.result !== '-' ? {"
if s.count(old_guard) != 1:
    FAILED.append("court-case.ts: reviewDecision guard not found once")
else:
    s = s.replace(old_guard, new_guard)
p.write_text(s, encoding="utf-8")
print(f"court-case.ts: {n1} × || '—'  ->  '-', {n2} × : '—,' -> '-'")

# 2) comparisons that see the mapped sentinel must accept both forms
apply("src/lib/stats.ts", [
    ("if (!raw || !raw.caseNumber || raw.caseNumber === '—') return null",
     "if (!raw || !raw.caseNumber || raw.caseNumber === '—' || raw.caseNumber === '-') return null", 1),
])
apply("src/sources/index.ts", [
    ("if (!c.hearingDate || c.hearingDate === '—' || c.hearingDate === 'null') continue",
     "if (!c.hearingDate || c.hearingDate === '—' || c.hearingDate === '-' || c.hearingDate === 'null') continue", 1),
])
apply("src/components/sections/cases.tsx", [
    ("if (!name || name === '—') return", "if (!name || name === '—' || name === '-') return", 1),
    ("{c.hearingDate && c.hearingDate !== '—' ? ` · ${c.hearingDate}` : ''}",
     "{c.hearingDate && c.hearingDate !== '—' && c.hearingDate !== '-' ? ` · ${c.hearingDate}` : ''}", 1),
])

if FAILED:
    print("\n!! FAILURES:")
    for f in FAILED:
        print("  " + f)
    sys.exit(1)
print("\nuz-fix3 OK.")
