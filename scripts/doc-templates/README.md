# Document-engine templates

The `.docx` templates in `src/lib/documents/templates/` power the **Hujjatlar**
feature (see `src/lib/documents/registry.ts`). Each was derived from a real
company form by collapsing every variable value into a single `{{placeholder}}`
run, so the server fill (`src/lib/documents/fill.server.ts`) is a trivial
`{{key}}` string replace that preserves the letterhead, tables and layout
byte-for-byte.

## Regenerating

The **source** documents contain real personal data (passport numbers, names)
and are **intentionally not committed**. To rebuild the templates you need the
five originals; point `SRC` at the folder holding them:

```bash
# build-templates.mjs reads SRC (edit the const at the top) and writes templates
node scripts/doc-templates/build-templates.mjs ./out
# round-trip check: fill each template with the original values and diff the text
node scripts/doc-templates/verify-templates.mjs   # run from ./out's parent
cp ./out/*.docx src/lib/documents/templates/
```

`verify-templates.mjs` asserts: round-trip text identical to the source (visa1
differs only by the intended position-field unification), zero unfilled
placeholders, and **zero residual PII** in the shipped template.

## Placeholder keys

Keys must match the `FIELDS` catalog in `src/lib/documents/registry.ts`. A key
present in a value but absent from a given template is simply ignored; an unknown
`{{…}}` left in a template collapses to empty string at fill time.
