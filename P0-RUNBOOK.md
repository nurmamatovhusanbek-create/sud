# P0 Runbook — Security & Build-Safety Hardening

The concrete first commit from the rebuild blueprint. Two things: **(A)** steps only you can do (rotate the leaked token; optionally purge history), and **(B)** the code changes, which are ready as `p0-hardening.patch` (or reproduce by hand below).

I already made and committed these on a branch (`chore/p0-hardening`) in a clone; `p0-hardening.patch` is that commit **with the secret file deliberately excluded** so the token never travels in a diff. Verified: the patch contains no `eyJ…` token, only comments naming the file.

---

## A. Do these yourself first (I can't, and they're the urgent part)

### A1. Rotate the leaked credential — treat it as compromised
`​.z-ai-config` (a z.ai API key + JWT `token`, used for VLM captcha solving) is committed and therefore in your git history. Anyone with repo access — or anyone who ever had it — has the token.

1. Log into the z.ai account and **revoke/rotate** that API key/token now. The value in the repo is dead after this.
2. Put the **new** value in your local `.env` (not in any tracked file):
   ```
   VLM_API_KEY=<new-key>
   # VLM_BASE_URL=<if applicable>
   ```
   (`src/server/config.ts` now reads `VLM_API_KEY`; wire the captcha solver to `config.vlm.apiKey` when you migrate that code in P3.)

### A2. Untrack the secret file (keeps it on disk, out of git)
```bash
git rm --cached .z-ai-config
# .gitignore already lists .z-ai-config, so it won't be re-added.
```
> The patch does **not** do this for you on purpose (a removal diff would embed the secret). Run it by hand.

### A3. (Recommended) Purge it from history
Untracking stops *future* commits from carrying it, but it stays in old commits. To scrub it:
```bash
# with git-filter-repo (preferred; install via pip/brew):
git filter-repo --path .z-ai-config --invert-paths

# …or BFG:
# bfg --delete-files .z-ai-config && git reflog expire --expire=now --all && git gc --prune=now --aggressive
```
Then **force-push** and tell any collaborators to re-clone. This rewrites history — coordinate it. (If the repo was ever public, rotation in A1 is what actually protects you; history purge is cleanup.)

---

## B. Apply the code changes

### Option 1 — apply the patch
```bash
git checkout -b chore/p0-hardening
git apply --index /path/to/p0-hardening.patch      # or: git am < p0-hardening.patch
```
The patch covers: `next.config.ts`, `package.json`, `.env.example`, new `src/server/config.ts`, and deletion of `prisma/schema.prisma` + `src/lib/db.ts`.

Then finish the two things the patch omits (binary + secret), and refresh the lockfile:
```bash
git rm --cached .z-ai-config          # A2, if not done yet
git rm -r prisma                       # removes prisma/ incl. the binary db file
npm uninstall prisma @prisma/client    # or: bun remove prisma @prisma/client
```

### Option 2 — reproduce by hand (what each change is)

**1. `next.config.ts` — stop hiding type errors**
```diff
   typescript: {
-    ignoreBuildErrors: true,
+    ignoreBuildErrors: false,
   },
```
This is the highest-value line in the commit: build now enforces types, so upstream-shape drift surfaces instead of shipping silent bad data.

**2. `package.json` — remove Prisma, add a typecheck script**
- Delete deps `@prisma/client` and `prisma`.
- Delete scripts `db:push`, `db:generate`, `db:migrate`, `db:reset`.
- Add `"typecheck": "tsc --noEmit"`.

**3. Delete unused Prisma + dead DB singleton**
```bash
git rm -r prisma            # schema is boilerplate User/Post; imported 0×
git rm src/lib/db.ts        # the only @prisma/client consumer
```
(Confirmed nothing else imports `@/lib/db` or `@prisma/client`.)

**4. Add `src/server/config.ts`** — the typed env surface (from the patch). One place for worker URLs + secret, retry tiers, timeouts, cache backend + TTLs, VLM key, rate-limit, alert window. Read config through it, never scattered `process.env.*`.

**5. Replace `.env.example`** — documents every knob; drops `DATABASE_URL`.

---

## C. Verify (should all pass except the intended type backlog)

```bash
npm install                 # or bun install — refreshes lockfile after removing prisma
npm run dev                 # dev still boots normally
grep -rn "@prisma/client\|from '@/lib/db'" src   # → nothing
git ls-files | grep z-ai-config                   # → nothing (after A2)

npm run typecheck           # EXPECTED: prints the type backlog you just un-hid.
```
`typecheck` failing is **the point** — it's the list `ignoreBuildErrors` was concealing. It does not block `next dev`. Fix it down the ladder (start with the 9 `any`s in `src/lib/court-case.ts`); until then, a production `next build` will enforce types, so schedule the fixes before your next deploy rather than re-enabling the flag.

> Note: `reactStrictMode` stays `false` for now — re-enable it only after the data layer adds request de-duplication (blueprint P4), or strict mode's double-invoke doubles real upstream scrapes.

---

## D. Commit

```bash
git add -A
git commit -m "chore(p0): security + build-safety hardening (rebuild blueprint P0)"
```

That's P0 complete: **no secret in the tree, types enforced, dead Prisma gone, one typed config surface.** Next up the ladder is P1 — extract a pure, tested `src/core` (classification, dedup, court-remap, PoW) with zod schemas — which is where the `typecheck` backlog starts getting paid down.
