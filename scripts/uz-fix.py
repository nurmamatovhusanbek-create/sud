#!/usr/bin/env python3
"""Uzbek typography pass per the guide.

PART A: safe letter-bound apostrophe regex (§4) on files whose every string was
        audited. Data-matching needles are masked first, unmasked after.
PART B: explicit (file, old, new, count) pairs for em dashes (§3), curly U+2018,
        &apos; entities, §5 phrasing, and hand fixes inside protected files.
Every pair must match exactly `count` times or the script aborts that file.
"""
import pathlib
import re
import sys

ROOT = pathlib.Path("/home/z/my-project")
FAILED = []

U_BB = "\u02bb"  # ʻ modifier letter turned comma
U_BC = "\u02bc"  # ʼ modifier letter apostrophe

# ---------------------------------------------------------------- PART A ----
AUTO_FILES = [
    "src/app/layout.tsx",
    "src/app/page.tsx",
    "src/app/api/bills/route.ts",
    "src/app/api/bills/export/route.ts",
    "src/app/api/company-info/route.ts",
    "src/app/api/court-cases/route.ts",
    "src/app/api/stats/route.ts",
    "src/app/api/stats/export/route.ts",
    "src/app/api/upcoming-hearings/route.ts",
    "src/core/schemas/index.ts",
    "src/server/middleware.ts",
    "src/components/company/context-bar.tsx",
    "src/components/shell/command-palette.tsx",
    "src/components/shell/app-shell.tsx",
    "src/components/views/launcher.tsx",
    "src/components/views/watchlist.tsx",
    "src/components/views/settings-view.tsx",
    "src/components/sections/bills.tsx",
    "src/components/sections/cases.tsx",
    "src/components/sections/hearings.tsx",
    "src/components/sections/overview.tsx",
    "src/components/sections/profile.tsx",
    "src/components/sections/bills-helpers.ts",
    "src/components/shared/formatters.ts",
    "src/components/ui-custom/case-ref-row.tsx",
    "src/components/ui-custom/data-strip.tsx",
    "src/components/ui-custom/receipt-view.tsx",
    "src/components/ui-custom/states.tsx",
    "src/lib/bills-cache.ts",
]

NEEDLE = "to'xtatilgan"
MASK = "UZNEEDLE_TT_X9Z"
NEEDLE2 = "bo'lib"
MASK2 = "UZNEEDLE_BL_X9Z"
MASKED = {
    "src/components/views/launcher.tsx": [NEEDLE],
    "src/components/views/watchlist.tsx": [NEEDLE],
    "src/components/company/context-bar.tsx": [NEEDLE],
    "src/components/shell/command-palette.tsx": [NEEDLE],
    "src/components/sections/cases.tsx": [NEEDLE2],
}

print("== PART A: letter-bound apostrophe regex ==")
for rel in AUTO_FILES:
    p = ROOT / rel
    s = p.read_text(encoding="utf-8")
    masks = MASKED.get(rel, [])
    for i, n in enumerate(masks):
        s = s.replace(n, f"__UZMASK{i}__")
    before = s
    s = re.sub(r"([oOgG])'(?=[A-Za-z\u02bc])", lambda m: m.group(1) + U_BB, s)
    s = re.sub(r"([A-Za-z])'(?=[A-Za-z])", lambda m: m.group(1) + U_BC, s)
    for i, n in enumerate(masks):
        s = s.replace(f"__UZMASK{i}__", n)
    if s != before:
        p.write_text(s, encoding="utf-8")
        print(f"  fixed {rel}")
    else:
        print(f"  (no change) {rel}")

# ---------------------------------------------------------------- PART B ----
# (rel, old, new, count). Applied after PART A, so `old` is post-regex form.
P = [
    # --- core/search-mode.ts (protected file, hand edits) ---
    ("src/core/search-mode.ts", "hint: 'STIR — korxonalar bo‘yicha qidirilmoqda'", "hint: 'STIR · korxonalar boʻyicha qidirilmoqda'", 1),
    ("src/core/search-mode.ts", "hint: 'PINFL — jismoniy shaxs bo‘yicha qidirilmoqda'", "hint: 'PINFL · jismoniy shaxs boʻyicha qidirilmoqda'", 1),
    ("src/core/search-mode.ts", "hint: 'Kvitansiya raqami bo‘yicha qidirilmoqda'", "hint: 'Kvitansiya raqami boʻyicha qidirilmoqda'", 1),
    ("src/core/search-mode.ts", "hint: 'Ish raqami bo‘yicha qidirilmoqda'", "hint: 'Ish raqami boʻyicha qidirilmoqda'", 1),
    ("src/core/search-mode.ts", "hint: 'STIR (raqamlar) bo‘yicha qidirilmoqda'", "hint: 'STIR (raqamlar) boʻyicha qidirilmoqda'", 1),
    ("src/core/search-mode.ts", "hint: 'Nom bo‘yicha qidirilmoqda'", "hint: 'Nom boʻyicha qidirilmoqda'", 1),
    # --- core/billing-format.ts (display labels) ---
    ("src/core/billing-format.ts", 'CRIMINAL: { uz: \'Jinoyat ishlari boyicha sud\'', "CRIMINAL: { uz: 'Jinoyat ishlari boʻyicha sud'", 1),
    ("src/core/billing-format.ts", 'CITIZEN: { uz: \'Fuqarolik ishlari boyicha sud\'', "CITIZEN: { uz: 'Fuqarolik ishlari boʻyicha sud'", 1),
    ("src/core/billing-format.ts", 'ADMINISTRATIVE: { uz: "Ma\'muriy sud"', 'ADMINISTRATIVE: { uz: "Maʼmuriy sud"', 1),
    ("src/core/billing-format.ts", "if (!type) return '—'", "if (!type) return '-'", 1),
    ("src/core/billing-format.ts", '{ uz: "To\'lanmagan", ru: \'Ne oplacheno\'', '{ uz: "Toʻlanmagan", ru: \'Ne oplacheno\'', 1),
    # --- lib/court-case-types.ts (values only; keys are API-matching data) ---
    ("src/lib/court-case-types.ts", "'Кўриб чиқилмоқда': { en: \"Ko'rib chiqilmoqda\"", "'Кўриб чиқилмоқда': { en: \"Koʻrib chiqilmoqda\"", 1),
    ("src/lib/court-case-types.ts", "'Тўхтатилган': { en: \"To'xtatilgan\"", "'Тўхтатилган': { en: \"Toʻxtatilgan\"", 1),
    ("src/lib/court-case-types.ts", "'Ўтказилган': { en: \"O'tkazilgan\"", "'Ўтказилган': { en: \"Oʻtkazilgan\"", 1),
    ("src/lib/court-case-types.ts", 'uz: "Ma\'muriy ishlar"', 'uz: "Maʼmuriy ishlar"', 1),
    # --- lib/billing.ts (phase strings shown in the stream loader) ---
    ("src/lib/billing.ts", "uchun to'lovlar qidirilmoqda…", "uchun toʻlovlar qidirilmoqda…", 1),
    ("src/lib/billing.ts", "`Manba vaqtincha ishlamayapti — qayta urinilmoqda (", "`Manba vaqtincha ishlamayapti. Qayta urinilmoqda (", 1),
    ("src/lib/billing.ts", "ta to'lov qayta urinilmoqda (", "ta toʻlov qayta urinilmoqda (", 1),
    # --- lib/stats.ts (visible partial error + counterparty placeholder) ---
    ("src/lib/stats.ts", 'error: "Ba\'zi manbalarga ulanib bo\'lmadi — natija to\'liq bo\'lmasligi mumkin (qayta urinib ko\'ring)"', 'error: "Baʼzi manbalarga ulanib boʻlmadi. Natija toʻliq boʻlmasligi mumkin (qayta urinib koʻring)"', 1),
    ("src/lib/stats.ts", "counterparty: counterparty || '—'", "counterparty: counterparty || '-'", 1),
    # --- lib/mib.ts (display placeholders) ---
    ("src/lib/mib.ts", "?.trim() ?? '—'", "?.trim() ?? '-'", 8),
    # --- lib/chamber.ts ---
    ("src/lib/chamber.ts", "type: data.type || '—'", "type: data.type || '-'", 1),
    ("src/lib/chamber.ts", "'BBB': \"O'rta\"", "'BBB': \"Oʻrta\"", 1),
    ("src/lib/chamber.ts", "'BB': \"O'rta\"", "'BB': \"Oʻrta\"", 1),
    ("src/lib/chamber.ts", "'B': \"O'rta\"", "'B': \"Oʻrta\"", 1),
    # --- server/middleware.ts (em dashes in API errors, post-regex form) ---
    ("src/server/middleware.ts", "Ruxsat yoʻq — APP_API_TOKEN sozlanmagan. Klient token yuborishi kerak.", "Ruxsat yoʻq: APP_API_TOKEN sozlanmagan. Klient token yuborishi kerak.", 1),
    ("src/server/middleware.ts", "Juda koʻp soʻrovlar — birozdan soʻng qayta urinib koʻring.", "Juda koʻp soʻrovlar. Birozdan soʻng qayta urinib koʻring.", 1),
    # --- app/api/bills/export (xlsx placeholders) ---
    ("src/app/api/bills/export/route.ts", "|| '—'", "|| '-'", 9),
    # --- shared/formatters.ts placeholders ---
    ("src/components/shared/formatters.ts", "return '—'", "return '-'", 2),
    # --- app-shell ---
    ("src/components/shell/app-shell.tsx", "} — majlis {d} {MONTHS[m - 1]}", "} · majlis {d} {MONTHS[m - 1]}", 1),
    ("src/components/shell/app-shell.tsx", "Tor oʻchiq — toʻlovlar soʻrovlari cheklangan boʻlishi mumkin", "Tor oʻchiq. Toʻlovlar soʻrovlari cheklangan boʻlishi mumkin", 1),
    ("src/components/shell/app-shell.tsx", "Bildirishnoma yo&apos;q", "Bildirishnoma yoʻq", 1),
    ("src/components/shell/app-shell.tsx", "toast.error('Tor holatini olib bo‘lmadi')", "toast.error('Tor holatini olib boʻlmadi')", 1),
    ("src/components/shell/app-shell.tsx", "kvitansiya bo&apos;yicha qidiring…", "kvitansiya boʻyicha qidiring…", 1),
    # --- command-palette ---
    ("src/components/shell/command-palette.tsx", "toast.success('Kuzatuvga qo‘shildi'", "toast.success('Kuzatuvga qoʻshildi'", 1),
    ("src/components/shell/command-palette.tsx", "bo&apos;yicha kompaniya yo&apos;q", "boʻyicha kompaniya yoʻq", 1),
    ("src/components/shell/command-palette.tsx", "1–5</span> bo&apos;lim", "1–5</span> boʻlim", 1),
    # --- context-bar ---
    ("src/components/company/context-bar.tsx", "toast.error('Nusxalab bo‘lmadi')", "toast.error('Nusxalab boʻlmadi')", 1),
    ("src/components/company/context-bar.tsx", "'Kuzatuvga qo‘shildi' : 'Kuzatuvdan olindi'", "'Kuzatuvga qoʻshildi' : 'Kuzatuvdan olindi'", 1),
    # --- launcher ---
    ("src/components/views/launcher.tsx", "Majlis yo&apos;q", "Majlis yoʻq", 1),
    ("src/components/views/launcher.tsx", "Jismoniy shaxslar bo‘yicha sud ishlari bo‘limida qidiriladi.", "Jismoniy shaxslar boʻyicha sud ishlari boʻlimida qidiriladi.", 1),
    ("src/components/views/launcher.tsx", "O&apos;zbekiston · Sud razvedka tizimi", "Oʻzbekiston · Sud razvedka tizimi", 1),
    ("src/components/views/launcher.tsx", "bir joyda</span> ko&apos;ring.", "bir joyda</span> koʻring.", 1),
    ("src/components/views/launcher.tsx", "STIR (9 raqam), kvitansiya (12 raqam) yoki ish raqamini kiriting — to&apos;lovlar, sud ishlari, majlislar va\n          reyting bitta ish maydoniga yig&apos;iladi.", "STIR (9 xonali), kvitansiya (12 xonali) yoki ish raqamini kiriting. Toʻlovlar, sud ishlari, majlislar va\n          reyting bitta ish maydoniga jamlanadi.", 1),
    ("src/components/views/launcher.tsx", "So&apos;nggi:", "Soʻnggi:", 1),
    ("src/components/views/launcher.tsx", "— hali qidiruv yo&apos;q", "· hali qidiruv yoʻq", 1),
    ("src/components/views/launcher.tsx", "mln so&apos;m", "mln soʻm", 1),
    ("src/components/views/launcher.tsx", "Eng yaqini — ${", "Eng yaqini · ${", 1),
    ("src/components/views/launcher.tsx", "bo&apos;yicha qidiring — natijalar shu yerda yig&apos;iladi.", "boʻyicha qidiring. Natijalar shu yerda jamlanadi.", 1),
    ("src/components/views/launcher.tsx", "{meta?.cases ?? '—'}", "{meta?.cases ?? '-'}", 1),
    # --- watchlist ---
    ("src/components/views/watchlist.tsx", "Majlis yo&apos;q", "Majlis yoʻq", 1),
    ("src/components/views/watchlist.tsx", "Ko&apos;p kompaniyali monitoring", "Koʻp kompaniyali monitoring", 1),
    ("src/components/views/watchlist.tsx", "Kuzatuv <span className=\"g2\">ro&apos;yxati</span>", "Kuzatuv <span className=\"g2\">roʻyxati</span>", 1),
    ("src/components/views/watchlist.tsx", "majlislar, yutuq va reyting — bir qarashda.", "majlislar, yutuq va reyting · bir qarashda.", 1),
    ("src/components/views/watchlist.tsx", "Kompaniya qo&apos;shish", "Kompaniya qoʻshish", 1),
    ("src/components/views/watchlist.tsx", "<h3>Kuzatuv ro&apos;yxati bo&apos;sh</h3>", "<h3>Kuzatuv roʻyxati boʻsh</h3>", 1),
    ("src/components/views/watchlist.tsx", "tugmasi orqali qo&apos;shiladi.", "tugmasi orqali qoʻshiladi.", 1),
    ("src/components/views/watchlist.tsx", "} — ${p.d} ${p.m}", "} · ${p.d} ${p.m}", 1),
    ("src/components/views/watchlist.tsx", "{meta?.cases ?? '—'}", "{meta?.cases ?? '-'}", 1),
    ("src/components/views/watchlist.tsx", "|| '—'", "|| '-'", 1),
    # --- settings-view ---
    ("src/components/views/settings-view.tsx", "<h3>GitHub&apos;dagi so&apos;nggi</h3>", "<h3>GitHubʼdagi soʻnggi</h3>", 1),
    ("src/components/views/settings-view.tsx", "'GitHub‘da yangi commit bor — yangilash tugmasi orqali oling.'", "'GitHubʼda yangi commit bor. Yangilash tugmasi orqali oling.'", 1),
    ("src/components/views/settings-view.tsx", "Lokal kod GitHub&apos;dagi", "Lokal kod GitHubʼdagi", 1),
    ("src/components/views/settings-view.tsx", "toast('Yangilanish o‘rnatilmoqda…')", "toast('Yangilanish oʻrnatilmoqda…')", 1),
    ("src/components/views/settings-view.tsx", "<b>Test o&apos;tdi</b>", "<b>Test oʻtdi</b>", 1),
    ("src/components/views/settings-view.tsx", "toast.error('Testni o‘tkazib bo‘lmadi')", "toast.error('Testni oʻtkazib boʻlmadi')", 1),
    ("src/components/views/settings-view.tsx", "toast.success('Worker qo‘shildi (workers.json)')", "toast.success('Worker qoʻshildi (workers.json)')", 1),
    ("src/components/views/settings-view.tsx", "toast.error('Qo‘shib bo‘lmadi')", "toast.error('Qoʻshib boʻlmadi')", 1),
    ("src/components/views/settings-view.tsx", "writeText('// proxy.js — cloudflare-worker/proxy.js faylini ko‘ring')", "writeText('// proxy.js · cloudflare-worker/proxy.js faylini koʻring')", 1),
    ("src/components/views/settings-view.tsx", "worker&apos;ni qo&apos;shing", "workerʼni qoʻshing", 1),
    ("src/components/views/settings-view.tsx", "<h3>Yangi worker qo&apos;shish</h3>", "<h3>Yangi worker qoʻshish</h3>", 1),
    ("src/components/views/settings-view.tsx", ">Qo&apos;shish<", ">Qoʻshish<", 1),
    ("src/components/views/settings-view.tsx", "<Check />Eng so&apos;nggi</span>", "<Check />Eng soʻnggi</span>", 1),
    ("src/components/views/settings-view.tsx", "Ustunga sichqonchani olib boring", "Ustun ustiga bosing", 1),
    ("src/components/views/settings-view.tsx", "Jami so&apos;rov", "Jami soʻrov", 1),
    ("src/components/views/settings-view.tsx", "O&apos;rtacha javob", "Oʻrtacha javob", 1),
    ("src/components/views/settings-view.tsx", "<h3>So&apos;rov hajmi</h3>", "<h3>Soʻrov hajmi</h3>", 1),
    ("src/components/views/settings-view.tsx", "workerlar bo&apos;yicha", "workerlar boʻyicha", 1),
    ("src/components/views/settings-view.tsx", "<h2>Workerlar bo&apos;yicha</h2>", "<h2>Workerlar boʻyicha</h2>", 1),
    ("src/components/views/settings-view.tsx", "kartani bosing — so&apos;rovlar tarixi", "kartani bosing · soʻrovlar tarixi", 1),
    ("src/components/views/settings-view.tsx", "<h3>Worker yo&apos;q</h3>", "<h3>Worker yoʻq</h3>", 2),
    ("src/components/views/settings-view.tsx", "Workerlar bo&apos;limidan qo&apos;shing — holat shu yerda ko&apos;rinadi.", "Workerlar boʻlimidan qoʻshing. Holat shu yerda koʻrinadi.", 1),
    ("src/components/views/settings-view.tsx", "So&apos;rovlar</span>", "Soʻrovlar</span>", 1),
    ("src/components/views/settings-view.tsx", "So&apos;nggi so&apos;rovlar", "Soʻnggi soʻrovlar", 1),
    ("src/components/views/settings-view.tsx", "Tarix bo&apos;sh", "Tarix boʻsh", 1),
    ("src/components/views/settings-view.tsx", "{w.totalRequests} so&apos;rov", "{w.totalRequests} soʻrov", 1),
    ("src/components/views/settings-view.tsx", "document.title = 'Sozlamalar — Sud Signal'", "document.title = 'Sozlamalar · Sud Signal'", 1),
    ("src/components/views/settings-view.tsx", "Soʻnggi test: xato — ${", "Soʻnggi test: xato · ${", 1),
    ("src/components/views/settings-view.tsx", "ga saqlanadi — qayta ishga tushirish shart emas.", "ga saqlanadi. Qayta ishga tushirish shart emas.", 1),
    ("src/components/views/settings-view.tsx", "?? '—'}ms", "?? '-'}ms", 2),
    ("src/components/views/settings-view.tsx", "labels: ['—']", "labels: ['-']", 1),
    ("src/components/views/settings-view.tsx", "|| '—'", "|| '-'", 7),
    # --- cases ---
    ("src/components/sections/cases.tsx", "Ko‘rib chiqilgan", "Koʻrib chiqilgan", 3),
    ("src/components/sections/cases.tsx", "Umumiy ma&apos;lumot", "Umumiy maʼlumot", 1),
    ("src/components/sections/cases.tsx", "Da&apos;vo summasi", "Daʼvo summasi", 1),
    ("src/components/sections/cases.tsx", ">Da&apos;vogar<", ">Daʼvogar<", 1),
    ("src/components/sections/cases.tsx", "Ma&apos;lumot yo&apos;q</span>", "Maʼlumot yoʻq</span>", 1),
    ("src/components/sections/cases.tsx", "'Boshqa so‘z bilan qidirib ko‘ring.'", "'Boshqa soʻz bilan qidirib koʻring.'", 1),
    ("src/components/sections/cases.tsx", "name === '—') return <span className=\"faint\">—</span>", "name === '—') return <span className=\"faint\">-</span>", 1),
    ("src/components/sections/cases.tsx", "|| '—'", "|| '-'", 9),
    # --- overview ---
    ("src/components/sections/overview.tsx", ">Ma&apos;lumot yo&apos;q</div>", ">Maʼlumot yoʻq</div>", 1),
    ("src/components/sections/overview.tsx", "<b>Solishtirib bo‘lmadi</b>", "<b>Solishtirib boʻlmadi</b>", 1),
    ("src/components/sections/overview.tsx", "<h3>Ro&apos;yxat bo&apos;sh</h3>", "<h3>Roʻyxat boʻsh</h3>", 1),
    ("src/components/sections/overview.tsx", "Avval boshqa kompaniyalarni oching — so&apos;ng ularni solishtirish mumkin.", "Avval boshqa kompaniyalarni oching. Soʻng ularni solishtirish mumkin.", 1),
    ("src/components/sections/overview.tsx", "foot=\"3 sud turi bo&apos;yicha\"", "foot=\"3 sud turi boʻyicha\"", 1),
    ("src/components/sections/overview.tsx", 'label="Yutuq darajasi"', 'label="Gʻalaba darajasi"', 1),
    ("src/components/sections/overview.tsx", "${l} — ${v} ish", "${l} · ${v} ish", 1),
    ("src/components/sections/overview.tsx", "Ustunni bosing — o&apos;sha oydagi ishlar", "Ustunni bosing · oʻsha oydagi ishlar", 1),
    ("src/components/sections/overview.tsx", "<h3>Sud turi bo&apos;yicha yutuq</h3>", "<h3>Sud turi boʻyicha yutuq</h3>", 1),
    ("src/components/sections/overview.tsx", "'O‘tkazib yuborilgan'", "'Oʻtkazib yuborilgan'", 1),
    ("src/components/sections/overview.tsx", "` — sudya ${nextHearing.judge as string}`", "` · sudya ${nextHearing.judge as string}`", 1),
    ("src/components/sections/overview.tsx", "— to&apos;lovlar va qarorlar", "· toʻlovlar va qarorlar", 1),
    ("src/components/sections/overview.tsx", "<h3>So&apos;nggi to&apos;lovlar</h3>", "<h3>Soʻnggi toʻlovlar</h3>", 1),
    ("src/components/sections/overview.tsx", "To&apos;lovlar hali yuklanmagan — To&apos;lovlar bo&apos;limini oching.", "Toʻlovlar hali yuklanmagan. Toʻlovlar boʻlimini oching.", 1),
    ("src/components/sections/overview.tsx", "'To‘lov'", "'Toʻlov'", 1),
    ("src/components/sections/overview.tsx", "<h3>So&apos;nggi qarorlar</h3>", "<h3>Soʻnggi qarorlar</h3>", 1),
    ("src/components/sections/overview.tsx", "Ma&apos;lumot yo&apos;q</div>", "Maʼlumot yoʻq</div>", 1),
    ("src/components/sections/overview.tsx", ": <span className=\"faint\">—</span>}", ": <span className=\"faint\">-</span>}", 1),
    ("src/components/sections/overview.tsx", "|| '—'", "|| '-'", 5),
    # --- bills ---
    ("src/components/sections/bills.tsx", "'Har bir to‘lov boyitilmoqda'", "'Har bir toʻlov tafsiloti olinmoqda'", 1),
    ("src/components/sections/bills.tsx", "['To‘lovchi',", "['Toʻlovchi',", 1),
    ("src/components/sections/bills.tsx", "['Muddati o‘tgan',", "['Muddati oʻtgan',", 1),
    ("src/components/sections/bills.tsx", "['To‘langan',", "['Toʻlangan',", 1),
    ("src/components/sections/bills.tsx", "rows.push(['Foyda tomonida',", "rows.push(['Foydasiga',", 1),
    ("src/components/sections/bills.tsx", "To&apos;lovlar import qilinmoqda…", "Toʻlovlar yuklab olinmoqda…", 1),
    ("src/components/sections/bills.tsx", "toast.error('Kvitansiyani tekshirib bo‘lmadi')", "toast.error('Kvitansiyani tekshirib boʻlmadi')", 1),
    ("src/components/sections/bills.tsx", "label: 'STIR — barcha to‘lovlar'", "label: 'STIR · barcha toʻlovlar'", 1),
    ("src/components/sections/bills.tsx", "label: 'Kvitansiya bo‘yicha'", "label: 'Kvitansiya boʻyicha'", 1),
    ("src/components/sections/bills.tsx", "To&apos;liq</>", "Toʻliq</>", 1),
    ("src/components/sections/bills.tsx", "E&apos;tibor talab", "Eʼtibor talab", 1),
    ("src/components/sections/bills.tsx", "<span>Oqimni ko&apos;rsatish</span>", "<span>Oqimni koʻrsatish</span>", 1),
    ("src/components/sections/bills.tsx", "so&apos;m</span>", "soʻm</span>", 4),
    ("src/components/sections/bills.tsx", "'To‘lov'", "'Toʻlov'", 1),
    ("src/components/sections/bills.tsx", "|| '—'", "|| '-'", 8),
    # --- profile ---
    ("src/components/sections/profile.tsx", "Ro&apos;yxatdan o&apos;tgan", "Roʻyxatdan oʻtgan", 1),
    ("src/components/sections/profile.tsx", "Kategoriya yo&apos;q", "Kategoriya yoʻq", 1),
    ("src/components/sections/profile.tsx", "Ta&apos;sischilar", "Taʼsischilar", 1),
    ("src/components/sections/profile.tsx", "${rating.okedCode} — ", "${rating.okedCode} · ", 1),
    ("src/components/sections/profile.tsx", "|| '—'", "|| '-'", 11),
    # --- ui-custom ---
    ("src/components/ui-custom/data-strip.tsx", "? '—'", "? '-'", 1),
    ("src/components/ui-custom/receipt-view.tsx", ": '—'", ": '-'", 1),
    ("src/components/ui-custom/states.tsx", "{e.source}</span> — {e.error}", "{e.source}</span> · {e.error}", 1),
    ("src/components/ui-custom/states.tsx", "Qisman ma&apos;lumot", "Qisman maʼlumot", 1),
]

print("\n== PART B: explicit pairs ==")
byfile = {}
for rel, old, new, cnt in P:
    byfile.setdefault(rel, []).append((old, new, cnt))

for rel, pairs in byfile.items():
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
print("\nAll replacements applied OK.")
