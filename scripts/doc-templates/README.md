# Document-engine templates

The `.docx` templates in `src/lib/documents/templates/` power the **Hujjatlar**
feature (see `src/lib/documents/registry.ts`). Each was derived from a real
company form by collapsing every variable value into a single `{{placeholder}}`
run, so the server fill (`src/lib/documents/fill.server.ts`) is a trivial
`{{key}}` string replace that preserves the letterhead, tables and layout
byte-for-byte.

## Regenerating

The **source** documents contain real personal data (names, passport numbers, phone numbers) and are
**intentionally not committed**. Point `SRC` at the folder holding the originals:

```bash
# most templates: values are found by their TEXT (build-templates.mjs holds those literals)
SRC=<folder> node scripts/doc-templates/build-templates.mjs ./out
SRC=<folder> node scripts/doc-templates/verify-templates.mjs        # run from ./out's parent

# the two IIO templates (iio1_kafolat, iio2_royxat): values are found by PLACE (table cell / label / marker, see
# iio-specs.mjs), so neither the builder nor the verifier contains a single personal value
SRC=<folder> node scripts/doc-templates/build-iio.mjs ./out
SRC=<folder> node scripts/doc-templates/verify-iio.mjs ./out

cp ./out/*.docx src/lib/documents/templates/
node scripts/doc-templates/scrub-templates.mjs src/lib/documents/templates   # idempotent safety net
```

Prefer the by-PLACE way (`xml-edit.mjs` `setAt` / `readAt`, specs in `iio-specs.mjs`) for any new template: it keeps
personal data out of the repo, and the verifier reads the values back from the original at run time.

## What a template must NOT carry

Besides the body text, a Word package holds a **preview image of the first page** (`docProps/thumbnail.emf`: the
original's names and passport numbers, readable) and the author names (`docProps/core.xml`). Every builder runs
`scrubPackage`, and `lib/documents/__tests__/templates.test.ts` fails for any shipped template with a preview image,
an author, a passport-like number or a phone number, and for any template whose placeholders differ from its registry
entry. (Found 2026-10: five of the eleven shipped templates carried such a preview.)

`verify-iio.mjs` asserts: round-trip text identical to the original (whitespace collapsed), zero unfilled placeholders,
none of the personal values anywhere in the package (UTF-8 and UTF-16, so an image's text records are caught),
no preview image, no author.

## Placeholder keys

Keys must match the `FIELDS` catalog in `src/lib/documents/registry.ts`. A key
present in a value but absent from a given template is simply ignored; an unknown
`{{…}}` left in a template collapses to empty string at fill time.
