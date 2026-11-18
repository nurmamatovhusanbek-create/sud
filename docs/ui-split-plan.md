# UI / logic split — plan with milestones

**Goal.** Change how the app *looks and feels* (layout, cards, pills, stats, motion) without touching how it *gets and decides things*
(scrapers, routes, registry, orders, documents), and the other way round. Nothing in this plan changes behaviour: a milestone is done
only when the app does exactly what it did and a test or a screenshot diff proves it.

**Order of work.** M0 → M3 first (the split). Only after M3 is merged does the redesign (M6) start. M4–M5 can run beside M3.

## Why now (measured on `main`, Nov 2026)

| Fact | Number |
|---|---|
| Components that call `fetch(` / `@/lib/api-client` themselves | 22 of the components (24 files import some data or domain module; 69 imports in all, `ui-boundary.baseline.json`) |
| Largest screen files | `settings-view` 1011 lines, `cases` 809, `primitives` 807, `overview` 775, `bills` 511, `orders-view` 494 |
| CSS | 1631 lines in 3 global files, class-name based (`.p-card` used 30×, `.rise-c` 33×, `.card-h` 19×) |
| Cards inside cards | `overview.tsx` has 10 `p-card` blocks, `settings-view` 8; a card is also the unit of «section», «stat group» and «list item» |
| Earlier attempt | the «Yangi» and «Yashil» looks (commits `deeee99`…`65bb54c`, reverted in `b4bed39`): a second copy of the screens, each with its own data and logic mixed in. They could not be kept in step with the original, so they were removed |

**Lesson:** a redesign must not be a second set of screens. There is ONE set of screens; the split makes each of them cheap to re-skin.

## Target shape

```
core/, lib/, server/      unchanged: pure logic, scrapers, routes, stores (no JSX)
src/features/<screen>/    NEW  one hook per screen: use<Screen>() → { data, status, actions }
                               the ONLY place a screen's data calls, registry, store and polling live; tested with bun, no DOM
src/ui/                   NEW  the design system: tokens + primitives (Card, Section, Stat, Badge, Row, KeyValue, PageHeader,
                               Toolbar, Tabs, Field, EmptyState …) — the only place that knows what a «card» looks like
src/components/           screens and shell: props/hook result → JSX built from src/ui. No fetch, no api-client, no registry.
```

Allowed imports: `components` → `ui`, `features`, `core/*` (pure formatters, classifiers), `import type` from anywhere.
Forbidden in `components`: `fetch(`, `@/lib/api-client`, registry / store / enrich / scrapers / orders / documents modules.
`features` → `lib`, `core`, `api-client`. `ui` → nothing from the app (tokens and React only).

## Milestones

### M0 — Safety net (no UI change)
Without it, «nothing changed» is a guess.
- `bun run ui:shots`: Playwright opens every screen (launcher, Kuzatuv, company tabs, Sud ishlari, Qarorlar, Hujjatlar, Sozlamalar tabs, drawer, ⌘K)
  at 1300 / 960 / 700 px × light / dark, with seeded `localStorage` and `/api/*` mocked from fixtures (live scraping does not work here, AGENTS.md §2).
- Fixtures are typed by `lib/api-types` / `core/schemas`, so a fixture that drifts from the real shape fails typecheck.
- Baseline PNGs are produced locally (not committed: size); the script diffs a run against the last accepted run and prints changed screens.
- **Done when:** two runs on the same commit differ by 0 pixels (animations frozen), and every screen above has a shot.

### M1 — Boundary rules in code (started)
- `src/lib/__tests__/ui-boundary.test.ts` + `ui-boundary.baseline.json`: a ratchet. Today's 24 files / 69 violations are listed; a NEW violation fails the
  test, and a fixed one must be deleted from the list, so it only shrinks. (Done: this is what gets committed with the plan.)
- Then an ESLint `no-restricted-imports` rule for `src/components/**` and `src/ui/**` so the editor shows it at once (same list, with the baseline files exempt).
- **Done when:** both exist and `bun run lint` is clean.

### M2 — Data seam, one screen at a time (the big one)
For each screen: move every `fetch` / api-client call, registry/store read, polling timer and derived-state calculation into `src/features/<screen>/use-<screen>.ts`; the component keeps only layout and local UI state (open/closed, selected tab). Hook tests mock `api-client` (pattern already used by `lib/__tests__/billing-search.test.ts`).
Order — smallest blast radius first, so the method is proven before the big files:
1. `orders-view` + `orders-settings` + `case-orders` (Qarorlar; recently reworked, has tests)
2. `launcher`, `watchlist` (Kuzatuv)
3. `settings-view` split into its tabs (Yangilanishlar, Workerlar, Sogʻlik) + `vlm-settings`, `security-settings`
4. `cases` (Sud ishlari), `hearings`, `bills`, `profile`
5. `overview` (Statistika)
6. documents: `documents-view`, `doc-editor`, `doc-bulk`, `custom-templates`, `pretenzia-view`, `doc-preview`
7. shell: `app-shell`, `command-palette`, `presence-beat`
Each step is one commit: hook + slimmed component + baseline entries deleted + M0 screenshot diff = 0.
- **Done when:** `ui-boundary.baseline.json` is `{}`.

### M3 — Design-system primitives (no visual change)
Extract what the CSS already defines into `src/ui/`, with the **same** look first:
`Card` (variants `raised` / `flat` / `inset`), `Section` (title + optional action, no surface), `Stat`, `Badge` (status / count / tag), `Row`, `KeyValue`,
`PageHeader`, `Toolbar`, `Tabs`, `Field`, `EmptyState`/`Loading`/`Error` (from `ui-custom/states`).
- `Card` knows if it sits inside another `Card` (React context) and, in dev and in tests, throws: the «cards inside cards» problem becomes impossible to reintroduce instead of a review comment.
- Screens switch from `className="p-card …"` strings to the primitives, one screen per commit, M0 diff = 0 (or each difference listed and accepted).
- **Done when:** no screen uses `.p-card`, `.card-h`, `.kv` or `.pill` class strings directly (a grep test, same ratchet idea as M1).

### M4 — CSS ownership
- Split `prototype.css` / `globals.css` by owner: tokens, `src/ui/*.css`, one file per feature area. Delete rules the screens no longer use (measure with Playwright CSS coverage over the M0 run, don't guess).
- Token scales instead of one-off numbers: spacing (4/8/12/16/24/32), radius (3), elevation (2), type (6 sizes), motion (`--dur-1…3`, `--ease-out`).
- **Done when:** every colour, radius and duration in `src/ui` is a token, and M0 diff = 0.

### M5 — Motion layer
- Already done: the operator switch (`lib/motion`, sidebar «Animatsiya»: auto / on / off) and the rule that reduced-motion CSS is gated on it.
- Add: motion tokens, and a short list of named motions (page enter, list stagger, drawer slide, number count-up, skeleton, status pulse) in ONE file; nothing else may declare `animation`.
  Rules kept from AGENTS.md: forever-running motion animates only `transform`/`opacity`; no blur over animated content.
- **Done when:** a test fails on an `animation:`/`@keyframes` outside that file, and the three modes are covered by a Playwright check.

### M6 — Redesign (only after M3)
Now a look change is edits in `src/ui` plus screen composition, with M0 showing exactly what moved. Proposed changes, in the order I would ship them:
1. **Two levels, not five.** Page → section (one surface) → rows. Dividers and spacing replace nested boxes; a card is only for an independent thing (a company, an order, a case).
2. **One section header.** The 36 px dark icon tile on every card header (`.card-h .ico`, 19 uses) is replaced by a quiet title + optional action; icons only where they carry meaning.
3. **One `Stat`.** Number, label, optional change. The dial and the pizza stay for the single headline metric (win rate) and are removed from lesser places. «Less info is useful info» stays the rule.
4. **Three pill kinds, not many.** Status (semantic colour: won / lost / pending / warning), count (neutral), tag (outline). No decorative colours.
5. **Buttons:** one primary per view; secondary quiet; toolbar actions icon-first with a tooltip. Heights stay 40 / 34 / 28.
6. **Lists as lists.** Sud ishlari and Qarorlar become aligned rows with fixed columns (number · court · status · date · action) rather than cards, which also removes the wrapping bugs fixed this month.
7. **Motion with a purpose:** page fade-in, drawer slide, count-up only on first load of headline numbers, skeletons while loading; no decorative looping (the status pulse stays). Always through M5's switch.
8. **States:** empty / loading / error look the same on every screen (one component).
9. **Dark mode and focus** audited against tokens: crisp focus ring (owner rule: no glow), contrast checked per token pair.
Each item is a separate commit with before/after shots from M0.

## Rules while the split is in progress
- No behaviour change inside a split commit; behaviour fixes go in their own commit.
- A new screen or component must satisfy the boundary on day one (the ratchet fails otherwise).
- Do not fork screens or keep two looks (see the earlier attempt above). If a look must be tried, it is a branch, not a setting.
- Every milestone ends with the usual gate (`typecheck`, `lint`, `bun test`, `map:check`) plus the M0 diff once it exists.

## Risks
- Hidden coupling in the large files (`cases.tsx` keeps hearing-date logic inside, `overview.tsx` mixes layout and calculation). Mitigation: move calculations into `core/` first (they get tests), then the hook.
- Screenshot flakiness (fonts, animations, time): freeze time, disable motion through the new setting, wait for `document.fonts.ready`.
- Scope creep into redesign during M2/M3: the M0 diff is the guard; a pixel change in a split commit is a bug or an explicit, listed decision.
