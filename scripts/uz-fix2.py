#!/usr/bin/env python3
"""Corrected PART B for the 4 files skipped by uz-fix.py (counts fixed)."""
import pathlib
import sys

ROOT = pathlib.Path("/home/z/my-project")
FAILED = []

P = {
    "src/components/views/settings-view.tsx": [
        ("<h3>GitHub&apos;dagi so&apos;nggi</h3>", "<h3>GitHubʼdagi soʻnggi</h3>", 1),
        ("'GitHub‘da yangi commit bor — yangilash tugmasi orqali oling.'", "'GitHubʼda yangi commit bor. Yangilash tugmasi orqali oling.'", 1),
        ("Lokal kod GitHub&apos;dagi", "Lokal kod GitHubʼdagi", 1),
        ("toast('Yangilanish o‘rnatilmoqda…')", "toast('Yangilanish oʻrnatilmoqda…')", 1),
        ("<b>Test o&apos;tdi</b>", "<b>Test oʻtdi</b>", 1),
        ("toast.error('Testni o‘tkazib bo‘lmadi')", "toast.error('Testni oʻtkazib boʻlmadi')", 1),
        ("toast.success('Worker qo‘shildi (workers.json)')", "toast.success('Worker qoʻshildi (workers.json)')", 1),
        ("toast.error('Qo‘shib bo‘lmadi')", "toast.error('Qoʻshib boʻlmadi')", 1),
        ("writeText('// proxy.js — cloudflare-worker/proxy.js faylini ko‘ring')", "writeText('// proxy.js · cloudflare-worker/proxy.js faylini koʻring')", 1),
        ("worker&apos;ni qo&apos;shing", "workerʼni qoʻshing", 1),
        ("<h3>Yangi worker qo&apos;shish</h3>", "<h3>Yangi worker qoʻshish</h3>", 1),
        ("Qo&apos;shish", "Qoʻshish", 1),
        ("<Check />Eng so&apos;nggi</span>", "<Check />Eng soʻnggi</span>", 1),
        ("Ustunga sichqonchani olib boring", "Ustun ustiga bosing", 1),
        ("Jami so&apos;rov", "Jami soʻrov", 1),
        ("O&apos;rtacha javob", "Oʻrtacha javob", 1),
        ("<h3>So&apos;rov hajmi</h3>", "<h3>Soʻrov hajmi</h3>", 1),
        ("workerlar bo&apos;yicha", "workerlar boʻyicha", 1),
        ("<h2>Workerlar bo&apos;yicha</h2>", "<h2>Workerlar boʻyicha</h2>", 1),
        ("kartani bosing — so&apos;rovlar tarixi", "kartani bosing · soʻrovlar tarixi", 1),
        ("<h3>Worker yo&apos;q</h3>", "<h3>Worker yoʻq</h3>", 2),
        ("Workerlar bo&apos;limidan qo&apos;shing — holat shu yerda ko&apos;rinadi.", "Workerlar boʻlimidan qoʻshing. Holat shu yerda koʻrinadi.", 1),
        ("So&apos;rovlar</span>", "Soʻrovlar</span>", 1),
        ("So&apos;nggi so&apos;rovlar", "Soʻnggi soʻrovlar", 1),
        ("Tarix bo&apos;sh", "Tarix boʻsh", 1),
        ("{w.totalRequests} so&apos;rov", "{w.totalRequests} soʻrov", 1),
        ("document.title = 'Sozlamalar — Sud Signal'", "document.title = 'Sozlamalar · Sud Signal'", 1),
        ("Soʻnggi test: xato — ${", "Soʻnggi test: xato · ${", 1),
        ("ga saqlanadi — qayta ishga tushirish shart emas.", "ga saqlanadi. Qayta ishga tushirish shart emas.", 1),
        ("?? '—'}ms", "?? '-'}ms", 2),
        ("labels: ['—']", "labels: ['-']", 1),
        ("|| '—'", "|| '-'", 5),
        (": '—'}</b>", ": '-'}</b>", 1),
        (": '—'}</span>)", ": '-'}</span>)", 1),
    ],
    # cases.tsx + bills.tsx were fixed in the previous run — blocks removed.
    "src/components/sections/overview.tsx": [
        (">Ma&apos;lumot yo&apos;q</div>", ">Maʼlumot yoʻq</div>", 2),
        ("<b>Solishtirib bo‘lmadi</b>", "<b>Solishtirib boʻlmadi</b>", 1),
        ("<h3>Ro&apos;yxat bo&apos;sh</h3>", "<h3>Roʻyxat boʻsh</h3>", 1),
        ("Avval boshqa kompaniyalarni oching — so&apos;ng ularni solishtirish mumkin.", "Avval boshqa kompaniyalarni oching. Soʻng ularni solishtirish mumkin.", 1),
        ("foot=\"3 sud turi bo&apos;yicha\"", "foot=\"3 sud turi boʻyicha\"", 1),
        ("label=\"Yutuq darajasi\"", "label=\"Gʻalaba darajasi\"", 1),
        ("${l} — ${v} ish", "${l} · ${v} ish", 1),
        ("Ustunni bosing — o&apos;sha oydagi ishlar", "Ustunni bosing · oʻsha oydagi ishlar", 1),
        ("<h3>Sud turi bo&apos;yicha yutuq</h3>", "<h3>Sud turi boʻyicha yutuq</h3>", 1),
        ("'O‘tkazib yuborilgan'", "'Oʻtkazib yuborilgan'", 1),
        ("` — sudya ${nextHearing.judge as string}`", "` · sudya ${nextHearing.judge as string}`", 1),
        ("— to&apos;lovlar va qarorlar", "· toʻlovlar va qarorlar", 1),
        ("<h3>So&apos;nggi to&apos;lovlar</h3>", "<h3>Soʻnggi toʻlovlar</h3>", 1),
        ("To&apos;lovlar hali yuklanmagan — To&apos;lovlar bo&apos;limini oching.", "Toʻlovlar hali yuklanmagan. Toʻlovlar boʻlimini oching.", 1),
        ("'To‘lov'", "'Toʻlov'", 1),
        ("<h3>So&apos;nggi qarorlar</h3>", "<h3>Soʻnggi qarorlar</h3>", 1),
        (": <span className=\"faint\">—</span>}", ": <span className=\"faint\">-</span>}", 1),
        ("|| '—'", "|| '-'", 3),
        (": '—'}</span>", ": '-'}</span>", 1),
        ("fmtSumShort(bt.overdue) : '—'", "fmtSumShort(bt.overdue) : '-'", 1),
    ],
    # NOTE: cases.tsx and bills.tsx were fixed in the previous run — removed here.
}

for rel, pairs in P.items():
    p = ROOT / rel
    s = p.read_text(encoding="utf-8")
    ok = True
    for old, new, cnt in pairs:
        found = s.count(old)
        if found != cnt:
            FAILED.append(f"{rel}: expected {cnt}, found {found} for: {old[:90]!r}")
            ok = False
            continue
        s = s.replace(old, new)
    if ok:
        p.write_text(s, encoding="utf-8")
        print(f"  fixed {rel} ({len(pairs)} pairs)")
    else:
        print(f"  SKIPPED (errors) {rel}")

if FAILED:
    print("\n!! FAILURES:")
    for f in FAILED:
        print("  " + f)
    sys.exit(1)
print("\nPatch applied OK.")
