# Kal El — Article Document Schema

The JSON structure of an article body: every node type, every field, every constraint, and
how v1 and v2 relate.

```
Reviewed against:
BRANCH: claude/kal-el-visual-ux-final-ade7eb
HEAD:   5de5b28b4a2a7a1d86a8f7a12b1493d3c73200f0
DATE:   2026-08-19
```

---

## 1. Top-level shape

A document is a **flat, ordered list of block nodes**. There is no tree, no root node, no
nesting of blocks inside blocks.

```json
{
  "version": 2,
  "nodes": [ ... ]
}
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `version` | the literal `1` or `2` | **yes** | the discriminator of the union |
| `nodes` | array of block nodes | **yes** | may be empty; no length cap |

`documentSchema` is `z.discriminatedUnion("version", [documentV1Schema, documentV2Schema])`.
A missing or non-`1`/`2` `version` fails validation immediately.

An article with no body is stored as:

```json
{ "version": 2, "nodes": [] }
```

---

## 2. The two versions

| | v1 (legacy) | v2 (canonical) |
|---|---|---|
| Text content | **plain strings** | **arrays of inline nodes with marks** |
| Inline formatting | not representable | bold, italic, code, underline, strike, link |
| Accepted on input | **yes** | **yes** |
| Returned by the API | **never** | **always** |
| Stored in the database | possible for legacy rows | what every write produces |

**A client should always send v2.** Sending v1 is supported and losslessly upgraded, but
you cannot express any inline formatting in it.

The only difference is the `content` field of the five text-bearing node types
(`paragraph`, `heading`, `quote`, `list`, `table`). The four atom nodes (`image`, `gallery`, `embed`, `source`) are **byte-identical across
both versions**.

### Conversion

| Function | Direction | Lossy? |
|---|---|---|
| `migrateDocumentToV2` | v1 → v2, or v2 → normalised v2 | no |
| `migrateDocumentToV1` | v2 → v1 | **yes** — every mark is flattened away |
| `normalizeDocumentV2` | v2 → canonical v2 | no |

`migrateDocumentToV2` runs on **every write and every read**, so:

- a v1 document sent to `POST`/`PATCH` is stored as v2;
- a v2 document is normalised before storage;
- `migrateDocumentToV1` is not reachable from any HTTP route, and nothing in the
  repository calls it outside the contracts test suite — it is exported for downstream
  consumers that still need v1.

### Normalisation, and why your JSON comes back different

`normalizeDocumentV2` canonicalises inline content:

1. **Marks are sorted** into a stable order by a canonical key (`link` sorts by
   `link:<href>:<title>:<internal>`, others by their type name).
2. **Adjacent text nodes carrying identical mark sets are merged** into one.
3. `marks` is materialised as `[]` where it was omitted.

So this input:

```json
[ { "type": "text", "text": "Hello ", "marks": [] },
  { "type": "text", "text": "world", "marks": [] } ]
```

comes back as:

```json
[ { "type": "text", "text": "Hello world", "marks": [] } ]
```

**Do not byte-compare a document you sent with the one you read back.** Compare
semantically, or re-derive from your source. (Kal El itself relies on this: `PATCH` files a
new revision only when the *normalised* result differs from what was stored, so a
round-tripped identical document does not create revision noise.)

---

## 3. Inline content (v2)

`content` on a text-bearing node is an **array of inline nodes**, at most **2000** entries.

### Text node

```json
{ "type": "text", "text": "some words", "marks": [] }
```

| Field | Type | Required | Constraint |
|---|---|---|---|
| `type` | `"text"` | yes | |
| `text` | string | yes | max **10000** characters |
| `marks` | array of marks | no — **defaults to `[]`** | max **8** entries |

### Hard break

```json
{ "type": "hardBreak" }
```

No other fields. Flattening to v1 turns it into a `\n`.

### Marks

Six kinds. Five are bare; only `link` carries attributes.

| Mark | JSON |
|---|---|
| Bold | `{ "type": "bold" }` |
| Italic | `{ "type": "italic" }` |
| Inline code | `{ "type": "code" }` |
| Underline | `{ "type": "underline" }` |
| Strikethrough | `{ "type": "strike" }` |
| Link | `{ "type": "link", "attrs": { "href": "...", "title": "...", "internal": true } }` |

**Link attributes**

| Field | Type | Required | Constraint |
|---|---|---|---|
| `href` | string | yes | max 2048; must match `^https?://` **or** start with `/` |
| `title` | string | no | max 500 |
| `internal` | boolean | no | a hint for the renderer; not enforced |

> **The `href` check is `^https?://` OR `startsWith("/")`.** `mailto:`, `tel:` and
> `javascript:` are rejected — but a **protocol-relative URL such as `//evil.com/x` starts
> with `/` and passes**. Do not treat "starts with `/`" as "internal"; a renderer must
> check for a leading `//` before deciding a link is same-origin.

`markSchema` is a discriminated union on `type` — an unknown mark name is a validation
error, not a silently ignored value. Marks combine freely (bold + link on one text node);
the cap is 8 per node.

There is no superscript, subscript, highlight or colour mark.

---

## 4. Block node types

Nine types, valid in both versions. `documentV2NodeSchema` is a **`z.union`** — an unknown
`type` fails with a union error listing every branch that did not match, which is verbose.
Check your `type` strings first when debugging a 400.

### paragraph

```json
{ "type": "paragraph", "attrs": {}, "content": [ { "type": "text", "text": "...", "marks": [] } ] }
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `attrs` | object | no — **defaults to `{}`** | free-form `Record<string, unknown>`; not interpreted |
| `content` | inline content (v2) / string (v1) | yes | |

### heading

```json
{ "type": "heading", "attrs": { "level": 2 }, "content": [ ... ] }
```

| Field | Type | Required | Constraint |
|---|---|---|---|
| `attrs.level` | integer | **yes** | **2, 3 or 4 only** |
| `content` | inline content | yes | |

Level 1 is the article `title`, not a document node. `level: 1` and `level: 5` are both
`400`.

### quote

```json
{ "type": "quote", "attrs": {}, "content": [ ... ] }
```

Same shape as `paragraph`. There is no attribution field — put it in the text, or use a
`source` node.

### list

```json
{ "type": "list", "attrs": { "ordered": false },
  "content": [ [ {"type":"text","text":"First","marks":[]} ],
               [ {"type":"text","text":"Second","marks":[]} ] ] }
```

| Field | Type | Required | Constraint |
|---|---|---|---|
| `attrs` | object | **yes — send at least `{}`** | unlike `paragraph`/`quote`, the object itself has no default |
| `attrs.ordered` | boolean | no — defaults to `false` | `true` = ordered/numbered |
| `content` | array of inline content — **one entry per list item** | yes | max **500** items |

Each element of `content` is itself an array (the item's inline content). Lists cannot
nest: an item's content is inline only.

### table

```json
{ "type": "table",
  "attrs": { "headers": ["Column A", "Column B"] },
  "content": [
    [ [ {"type":"text","text":"a1","marks":[]} ], [ {"type":"text","text":"b1","marks":[]} ] ],
    [ [ {"type":"text","text":"a2","marks":[]} ], [ {"type":"text","text":"b2","marks":[]} ] ]
  ] }
```

| Field | Type | Required | Constraint |
|---|---|---|---|
| `attrs` | object | **yes — send at least `{}`** | unlike `paragraph`/`quote`, the object itself has no default |
| `attrs.headers` | array of **plain strings** | no — defaults to `[]` | headers carry no marks |
| `content` | array of rows; each row an array of cells; each cell inline content | yes | max 500 rows, max 500 cells per row |

Three levels of nesting: `content[row][cell]` is inline content. Nothing enforces that
rows have equal length or that they match `headers`.

### image

```json
{ "type": "image",
  "attrs": { "mediaId": "b1c2d3e4-...", "altText": "Descriptive text",
             "caption": "Shown under the image", "credit": "Photographer" } }
```

| Field | Type | Required | Constraint |
|---|---|---|---|
| `attrs.mediaId` | uuid | **yes** | must exist **and belong to this site** |
| `attrs.altText` | string | no | max 500 |
| `attrs.caption` | string | no | max 2000 |
| `attrs.credit` | string | no | max 500 |

**Images are referenced by `mediaId` only.** There is no `url` or `src` field — upload
first ([EXTERNAL_CLIENT_API.md §13](../integrations/EXTERNAL_CLIENT_API.md#13-media)), then
put the returned id here. A `mediaId` that does not exist, or belongs to another site, is
`400 VALIDATION_ERROR` with `details.mediaId`.

`altText`/`caption`/`credit` here are **per-placement** and independent of the media
record's own `altText`/`caption`/`credit`. Neither overrides the other; the renderer
chooses.

### gallery

```json
{ "type": "gallery", "attrs": { "mediaIds": ["uuid-1", "uuid-2"] } }
```

| Field | Type | Required | Constraint |
|---|---|---|---|
| `attrs.mediaIds` | array of uuid | **yes** | **min 1**, max 50; every id validated against the site |

No captions at the gallery level — per-image text lives on the media records.

### embed

```json
{ "type": "embed", "attrs": { "url": "https://www.youtube.com/watch?v=xxxx",
                              "provider": "youtube", "id": "xxxx" } }
```

| Field | Type | Required | Constraint |
|---|---|---|---|
| `attrs.url` | string | **yes** | valid URL, max 2048, **`http(s)` only** |
| `attrs.provider` | string | **yes** (may be `""`) | max 64 |
| `attrs.id` | string | no | max 128 |

`provider` is free text — the API does not validate it against a list, resolve oEmbed, or
fetch anything. The renderer decides what to do with it. Kal El's own HTML importer emits
`"youtube"` when it recognises one.

### source

```json
{ "type": "source", "attrs": { "label": "Reuters", "url": "https://example.com/story", "kind": "news" } }
```

| Field | Type | Required | Constraint |
|---|---|---|---|
| `attrs.label` | string | **yes** (may be `""`) | max 200 |
| `attrs.url` | string | **yes** | valid URL, max 2048, `http(s)` only |
| `attrs.kind` | string | no | max 32 |

> **A `source` node is not a `sources` taxonomy row.** They share a name and nothing else.
> The node is free text embedded in the body; the taxonomy is a site-level table with its
> own CRUD endpoints and **no link to articles at all**. Creating a `sources` row does not
> make it referenceable from a document, and a `source` node does not create or reference
> a row. See [../KNOWN-ISSUES.md](../KNOWN-ISSUES.md).

---

## 5. Validation and failure

`document` is validated as part of the article body, so a bad document fails the whole
request:

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "validation failed",
  "details": { "issues": [ { "code": "invalid_union", "path": ["document","nodes",3], "message": "Invalid input" } ],
               "requestId": "..." } } }
```

`issues[].path` locates the offending node — `["document", "nodes", 3, "attrs", "level"]`
and so on. Common causes:

| Symptom | Cause |
|---|---|
| `invalid_union` on a node | unknown `type`, or a required `attrs` field missing |
| `invalid_union_discriminator` on `version` (message `Invalid discriminator value. Expected 1 \| 2`) | `version` absent, or not `1`/`2` |
| `details.mediaId` | an `image`/`gallery` id that is missing or in another site |
| `too_big` on `text` | a text node over 10000 characters — split it |
| `custom` on `href` (message `link href must be an http(s) URL or an internal path`) | a link that is not `http(s)` and does not start with `/` |
| heading rejected | `level` outside 2..4 |

### Unreadable stored documents

The `document` column is `jsonb` and nullable, so a restore, a hand-run statement or a
partial migration can leave a value that is not a valid document. The API **does not
crash** on those: every reader degrades the value to `{"version":2,"nodes":[]}` and the
article gains `"document_unreadable"` in `qualityFlags`.

**A client that sees `document_unreadable` should not write a document back through the
ordinary `PATCH`.** The API does file the unreadable raw bytes as a preserved revision
first (note `documento anterior ilegivel (preservado)`), so they are not lost — but your
payload still replaces the live column. Repair belongs on the `articles.recover`
endpoints. Repair goes through the
`articles.recover` endpoints; see
[WORKFLOW.md §8](WORKFLOW.md#8-quality-flags).

Publishing an article in this state is refused with `409 CONFLICT`.

---

## 6. Examples

### Minimal valid document

```json
{ "version": 2, "nodes": [] }
```

### Simple document

```json
{
  "version": 2,
  "nodes": [
    { "type": "paragraph", "attrs": {},
      "content": [ { "type": "text", "text": "A single opening paragraph.", "marks": [] } ] }
  ]
}
```

### Rich document exercising every node type and every mark

```json
{
  "version": 2,
  "nodes": [
    { "type": "paragraph", "attrs": {}, "content": [
        { "type": "text", "text": "Plain text, then ", "marks": [] },
        { "type": "text", "text": "bold", "marks": [ { "type": "bold" } ] },
        { "type": "text", "text": ", ", "marks": [] },
        { "type": "text", "text": "italic", "marks": [ { "type": "italic" } ] },
        { "type": "text", "text": ", ", "marks": [] },
        { "type": "text", "text": "underlined", "marks": [ { "type": "underline" } ] },
        { "type": "text", "text": ", ", "marks": [] },
        { "type": "text", "text": "struck through", "marks": [ { "type": "strike" } ] },
        { "type": "text", "text": ", ", "marks": [] },
        { "type": "text", "text": "inline code", "marks": [ { "type": "code" } ] },
        { "type": "text", "text": ", and a ", "marks": [] },
        { "type": "text", "text": "bold external link",
          "marks": [ { "type": "bold" },
                     { "type": "link", "attrs": { "href": "https://example.com/story", "title": "The source" } } ] },
        { "type": "text", "text": " plus an ", "marks": [] },
        { "type": "text", "text": "internal one",
          "marks": [ { "type": "link", "attrs": { "href": "/another-article", "internal": true } } ] },
        { "type": "text", "text": ".", "marks": [] }
      ] },

    { "type": "heading", "attrs": { "level": 2 },
      "content": [ { "type": "text", "text": "A section heading", "marks": [] } ] },

    { "type": "paragraph", "attrs": {}, "content": [
        { "type": "text", "text": "First line", "marks": [] },
        { "type": "hardBreak" },
        { "type": "text", "text": "second line after a hard break.", "marks": [] }
      ] },

    { "type": "quote", "attrs": {},
      "content": [ { "type": "text", "text": "A pulled quote from the interview.", "marks": [] } ] },

    { "type": "list", "attrs": { "ordered": false }, "content": [
        [ { "type": "text", "text": "An unordered item", "marks": [] } ],
        [ { "type": "text", "text": "An item with ", "marks": [] },
          { "type": "text", "text": "emphasis", "marks": [ { "type": "italic" } ] } ]
      ] },

    { "type": "list", "attrs": { "ordered": true }, "content": [
        [ { "type": "text", "text": "Step one", "marks": [] } ],
        [ { "type": "text", "text": "Step two", "marks": [] } ]
      ] },

    { "type": "heading", "attrs": { "level": 3 },
      "content": [ { "type": "text", "text": "A subsection", "marks": [] } ] },

    { "type": "table", "attrs": { "headers": ["Model", "Year"] }, "content": [
        [ [ { "type": "text", "text": "First", "marks": [] } ],
          [ { "type": "text", "text": "2024", "marks": [] } ] ],
        [ [ { "type": "text", "text": "Second", "marks": [] } ],
          [ { "type": "text", "text": "2025", "marks": [] } ] ]
      ] },

    { "type": "image", "attrs": {
        "mediaId": "b1c2d3e4-0000-4000-8000-000000000001",
        "altText": "What the image shows, for a screen reader",
        "caption": "Displayed beneath the image",
        "credit": "Photographer / Agency" } },

    { "type": "gallery", "attrs": { "mediaIds": [
        "b1c2d3e4-0000-4000-8000-000000000002",
        "b1c2d3e4-0000-4000-8000-000000000003" ] } },

    { "type": "embed", "attrs": {
        "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        "provider": "youtube",
        "id": "dQw4w9WgXcQ" } },

    { "type": "source", "attrs": {
        "label": "Original report",
        "url": "https://example.com/original",
        "kind": "news" } }
  ]
}
```

### The same content as v1 (for comparison only — do not send this)

```json
{
  "version": 1,
  "nodes": [
    { "type": "paragraph", "attrs": {}, "content": "Plain text, then bold, italic..." },
    { "type": "heading", "attrs": { "level": 2 }, "content": "A section heading" },
    { "type": "list", "attrs": { "ordered": false }, "content": ["An unordered item", "An item with emphasis"] },
    { "type": "table", "attrs": { "headers": ["Model", "Year"] }, "content": [["First", "2024"], ["Second", "2025"]] },
    { "type": "image", "attrs": { "mediaId": "b1c2d3e4-0000-4000-8000-000000000001", "altText": "..." } }
  ]
}
```

All formatting is lost. Sent to the API it is upgraded to v2 with every text node
carrying `marks: []`.

---

## 7. Building a document from HTML

If your source is HTML, do the conversion **in your client** — the API accepts only the
JSON above and there is no HTML-ingestion endpoint. Kal El's own importer
(`packages/importer/src/html.ts`) is a working reference for the mapping:

| HTML | Node |
|---|---|
| `<p>` | `paragraph` |
| `<h2>`, `<h3>`, `<h4>` | `heading` with the matching `level` |
| `<h1>`, `<h5>`, `<h6>` | **downgraded to `paragraph`** — level 1 is the title, 5/6 are out of range |
| `<blockquote>` | `quote` |
| `<ul>` / `<ol>` | `list` with `ordered` set accordingly |
| `<table>` | `table`; `<th>` cells of the first row are **copied** into `attrs.headers` (a first row of `<td>` leaves `headers` empty), and that row is still emitted as the first row of `content` |
| `<img>` | `image` — **you must upload it and substitute the `mediaId`** |
| `<iframe>` / video embeds | `embed` |
| `<b>`, `<strong>` | `bold` mark |
| `<i>`, `<em>` | `italic` mark |
| `<u>` | `underline` mark |
| `<s>`, `<del>` | `strike` mark |
| `<code>` | `code` mark |
| `<a href>` | `link` mark |
| `<br>` | `hardBreak` |
| anything else | text content extracted into a `paragraph`; the tag is dropped |

**Raw HTML is never stored or rendered.** Only the node types above survive; a renderer on
a public frontend must trust only known node types and known marks.

---

## 8. Rules for a client

1. **Always send `version: 2`.**
2. **Upload media before building the document.** Nodes reference `mediaId`, never a URL.
3. **Set `marks: []` explicitly** on every text node. It defaults to `[]`, but being
   explicit keeps your payload identical to what comes back.
4. **Split text over 10000 characters** into multiple text nodes or paragraphs.
5. **Headings are 2–4 only.** Map `<h1>` to the article `title`.
6. **Do not nest blocks.** The list is flat; a list item holds inline content only.
7. **Never round-trip-compare.** Normalisation reorders marks and merges text nodes.
8. **Check `qualityFlags` before writing a document over an existing one.**
8b. **Send `attrs` on every `list` and `table` node**, even if empty — only `paragraph`
   and `quote` may omit it.
9. **Links must be `http(s)` or a path starting with `/`.** `mailto:`, `tel:` and
   `javascript:` URLs are rejected. **Protocol-relative URLs (`//example.com/x`) are
   NOT rejected** — they begin with `/`, so the schema accepts them as if they were
   internal paths. A renderer must treat an `href` starting with `//` as external and
   untrusted.

---

## Implementation references

- `packages/contracts/src/editorial.ts` — `documentSchema`, `documentV1Schema`,
  `documentV2Schema`, `markSchema`, `inlineNodeSchema`, `inlineContentSchema`,
  `migrateDocumentToV2`, `migrateDocumentToV1`, `normalizeDocumentV2`, `QUALITY_FLAGS`
- `apps/api/src/services/articles.ts` — `storedDocument()`, `DEFAULT_DOCUMENT`, `qualityFlagsFor()`
- `apps/api/src/services/media.ts` — `collectDocumentMediaIds()`, `assertMediaInSite()`
- `apps/api/src/services/recovery.ts` — raw-document inspection and replacement
- `packages/editor/src/tiptap.ts`, `packages/editor/src/lexical.ts` — editor bindings
- `packages/importer/src/html.ts` — the HTML → document mapping
- `packages/db/src/schema/editorial.ts` — `articles.document`, `article_revisions.document`
