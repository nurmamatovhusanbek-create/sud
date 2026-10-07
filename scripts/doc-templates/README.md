# Document-engine templates

The `.docx` templates in `src/lib/documents/templates/` power the **Hujjatlar**
feature (see `src/lib/documents/registry.ts`). Each was derived from a real
company form by collapsing every variable value into a single `{{placeholder}}`
run, so the server fill (`src/lib/documents/fill.server.ts`) is a trivial
`{{key}}` string replace that preserves the letterhead, tables and layout
byte-for-byte.

## Regenerating

The **source** documents contain real personal data (names, passport numbers, phone numbers) and are
**intentionally not committed**. Point `SRC` at the folder holding the originals (the specs name each one by the 8-hex id its file name starts with, e.g. `94f688b9-…docx`; the names carry people's names, so they are not written down):

```bash
# visa letters + court petitions: values are located by PLACE in specs.mjs (table cell / label / marker)
SRC=<folder> node scripts/doc-templates/build-templates.mjs ./out
SRC=<folder> node scripts/doc-templates/verify-templates.mjs ./out

# the two IIO templates (iio1_kafolat, iio2_royxat): same idea, specs in iio-specs.mjs
SRC=<folder> node scripts/doc-templates/build-iio.mjs ./out
SRC=<folder> node scripts/doc-templates/verify-iio.mjs ./out

cp ./out/*.docx src/lib/documents/templates/
node scripts/doc-templates/scrub-templates.mjs src/lib/documents/templates   # idempotent safety net
node scripts/doc-templates/banner.mjs src/lib/documents/templates            # idempotent: banner as a full-width inline picture (see below)
```

Every builder finds a value by its PLACE (`readAt` / `applyOps` in `xml-edit.mjs`; the specs in `specs.mjs` and
`iio-specs.mjs`), reads it out of the original at run time, and replaces it. **No name, passport number, phone number
or case number is written down anywhere in the repository**; the verifiers read the same places to get the values back.
For a new template add a spec: the table row/cell or the label and marker around each value.

## The letterhead banner

Every template with a banner (`word/media/image1.png`) has the same construction, made by `banner.mjs` (the builders run
it; `src/lib/documents/__tests__/banner.test.ts` enforces it): a **first-page header** (`word/header1.xml`, `w:titlePg`)
with one **inline** picture as wide as the page, the paragraph indented by minus the page margins and the header
distance set to 0, so the picture touches the left, right and top page edges and the body starts below it. The
originals' anchors (page/margin/paragraph relative, wrap polygons, a floating table at a hand-tuned offset) are removed:
their box ratio rarely matched the picture, so a swapped-in letterhead was stretched and missed an edge.

At fill time `src/lib/documents/banner.ts` (shared by the downloads and the live preview) replaces the PNG and sets the
picture's height from the new PNG's own proportions at the page width. No letterhead + «blank» keeps the template's
box (the space stays, the branding goes).

## What a template must NOT carry

Besides the body text, a Word package holds a **preview image of the first page** (`docProps/thumbnail.emf`: the
original's names and passport numbers, readable) and the author names (`docProps/core.xml`). Every builder runs
`scrubPackage`, and `lib/documents/__tests__/templates.test.ts` fails for any shipped template with a preview image,
an author, a passport-like number or a phone number, and for any template whose placeholders differ from its registry
entry. (Found 2026-10: five of the eleven shipped templates carried such a preview.)

`verify-templates.mjs` / `verify-iio.mjs` (shared checks in `verify-lib.mjs`) assert: round-trip text identical to the original (whitespace collapsed), zero unfilled placeholders,
none of the personal values anywhere in the package (UTF-8 and UTF-16, so an image's text records are caught),
no preview image, no author.

## Placeholder keys

Keys must match the `FIELDS` catalog in `src/lib/documents/registry.ts`. A key
present in a value but absent from a given template is simply ignored; an unknown
`{{…}}` left in a template collapses to empty string at fill time.
