# Kal El — Python Client Example

A minimal, generic Python client for the Kal El API, using only real endpoints.

```
Reviewed against:
BRANCH: claude/kal-el-visual-ux-final-ade7eb
HEAD:   5de5b28b4a2a7a1d86a8f7a12b1493d3c73200f0
DATE:   2026-08-19
```

> **This is documentation, not a package.** Nothing here is installed in the Kal El
> repository, and no Python dependency is added to the project. Copy it, adapt it, put it
> in your own repository.
>
> It uses `requests` for readability. `httpx`, `urllib3` or the standard library work
> identically — nothing in the API depends on the HTTP library.

---

## 1. Configuration

```bash
export KALEL_BASE_URL="https://api.example.com"        # no trailing slash, no /v1
export KALEL_SITE_ID="6f1b0f6e-6a1c-4d1e-9b0a-2c3d4e5f6071"
export KALEL_SERVICE_TOKEN="ke_st.<secret>"            # never commit this
```

| Variable | Required | Purpose |
|---|---|---|
| `KALEL_BASE_URL` | yes | API origin; the client appends `/v1/...` |
| `KALEL_SITE_ID` | yes | the UUID in every path |
| `KALEL_SERVICE_TOKEN` | yes | `Authorization: Bearer` value |
| `KALEL_TIMEOUT` | no | per-request timeout, default 15 s |
| `KALEL_MAX_RETRIES` | no | default 5 |

Get a token from `POST /v1/admin/sites/{siteId}/service-tokens` — see
[EXTERNAL_CLIENT_API.md §4](EXTERNAL_CLIENT_API.md#4-service-tokens). The plaintext is
shown once.

---

## 2. The client

```python
"""
Minimal Kal El API client.

Covers: auth, self-check, taxonomy resolution, media upload, article create/update,
workflow transitions, idempotency, retries, and error handling.
"""

from __future__ import annotations

import os
import random
import time
import uuid
from typing import Any, Iterator

import requests

RETRYABLE_STATUS = {408, 429, 500, 502, 503, 504}
NON_RETRYABLE_CODES = {
    "VALIDATION_ERROR",
    "UNAUTHENTICATED",
    "FORBIDDEN",
    "SITE_SCOPE_MISMATCH",
    "NOT_FOUND",
    "CONFLICT",
    "VERSION_CONFLICT",
    "IDEMPOTENCY_REPLAY",
    "INVALID_TRANSITION",
    "PAYLOAD_TOO_LARGE",
}


class KalElError(Exception):
    """A refusal from the API, carrying the machine-readable code."""

    def __init__(self, status: int, code: str, message: str, details: dict[str, Any]):
        super().__init__(f"{status} {code}: {message}")
        self.status = status
        self.code = code
        self.message = message
        self.details = details or {}

    @property
    def request_id(self) -> str | None:
        # The correlation id lives in details, not at error.requestId.
        return self.details.get("requestId")

    @property
    def retryable(self) -> bool:
        return self.code not in NON_RETRYABLE_CODES and self.status in RETRYABLE_STATUS


class KalElClient:
    def __init__(
        self,
        base_url: str | None = None,
        site_id: str | None = None,
        token: str | None = None,
        timeout: float | None = None,
        max_retries: int | None = None,
    ):
        self.base_url = (base_url or os.environ["KALEL_BASE_URL"]).rstrip("/")
        self.site_id = site_id or os.environ["KALEL_SITE_ID"]
        self.timeout = timeout or float(os.environ.get("KALEL_TIMEOUT", "15"))
        self.max_retries = max_retries or int(os.environ.get("KALEL_MAX_RETRIES", "5"))
        self.session = requests.Session()
        self.session.headers.update(
            {
                "Authorization": f"Bearer {token or os.environ['KALEL_SERVICE_TOKEN']}",
                "Accept": "application/json",
            }
        )

    # ---------------------------------------------------------------- plumbing

    def _site(self, path: str) -> str:
        return f"{self.base_url}/v1/sites/{self.site_id}{path}"

    @staticmethod
    def new_idempotency_key(prefix: str = "py") -> str:
        # 8..128 chars of [A-Za-z0-9._-]. Hyphens are inside the class, so both
        # uuid4().hex and a hyphenated str(uuid4()) validate; hex is used for predictability.
        return f"{prefix}.{uuid.uuid4().hex}"

    @staticmethod
    def _raise_for_error(response: requests.Response) -> None:
        if response.ok:
            return
        try:
            raw = (response.json() or {}).get("error")
        except ValueError:
            # A proxy answering 502/413 with HTML never reaches the API's serialiser.
            raw = None
        # Fastify's built-in 404 (no matching route) sends {"error": "Not Found"} - a
        # STRING, not an object, and it never passes through the API's error handler.
        # Reading err["code"] without this check turns a URL typo into an AttributeError.
        if not isinstance(raw, dict):
            raw = {"code": "UNKNOWN", "message": str(raw or response.text[:500])}
        raise KalElError(
            response.status_code,
            raw.get("code", "UNKNOWN"),
            raw.get("message", ""),
            raw.get("details") or {},
        )

    def _backoff(self, attempt: int, retry_after: str | None) -> None:
        if retry_after:
            try:
                time.sleep(min(60.0, float(retry_after)))
                return
            except ValueError:
                pass
        # full jitter, 250ms base, 30s cap
        time.sleep(random.uniform(0, min(30.0, 0.25 * (2 ** (attempt - 1)))))

    def request(
        self,
        method: str,
        url: str,
        *,
        json: Any = None,
        params: dict[str, Any] | None = None,
        files: Any = None,
        idempotency_key: str | None = None,
        if_match: int | None = None,
    ) -> requests.Response:
        """One logical attempt, retried at the transport level with a stable key."""
        headers: dict[str, str] = {}
        if idempotency_key:
            headers["Idempotency-Key"] = idempotency_key
        if if_match is not None:
            # A bare integer. A quoted ETag is a 400.
            headers["If-Match"] = str(if_match)

        safe = method in ("GET", "HEAD")
        replayable = safe or idempotency_key is not None

        last_exc: Exception | None = None
        for attempt in range(1, self.max_retries + 1):
            try:
                response = self.session.request(
                    method,
                    url,
                    json=json,
                    params=params,
                    files=files,
                    headers=headers,
                    timeout=self.timeout,
                )
            except requests.RequestException as exc:
                # No response at all: the write may or may not have landed. Only a stable
                # idempotency key makes a resend safe.
                last_exc = exc
                if not replayable or attempt == self.max_retries:
                    raise
                self._backoff(attempt, None)
                continue

            if (
                response.status_code in RETRYABLE_STATUS
                and replayable
                and attempt < self.max_retries
            ):
                self._backoff(attempt, response.headers.get("retry-after"))
                continue

            self._raise_for_error(response)
            return response

        if last_exc:
            raise last_exc
        raise RuntimeError("unreachable")

    def _data(self, response: requests.Response) -> Any:
        # Every successful JSON response is { "data": ... }
        return response.json()["data"]

    # ------------------------------------------------------------- self-check

    def whoami(self) -> dict[str, Any]:
        return self._data(self.request("GET", f"{self.base_url}/v1/auth/me"))

    def assert_configured(self, required_scopes: set[str]) -> None:
        """Fail loudly at startup instead of with a 403 mid-run."""
        me = self.whoami()
        if me.get("kind") != "service":
            raise RuntimeError("KALEL_SERVICE_TOKEN is not a service token")
        if me.get("siteId") != self.site_id:
            raise RuntimeError(
                f"token is bound to site {me.get('siteId')}, not {self.site_id}"
            )
        missing = required_scopes - set(me.get("scopes") or [])
        if missing:
            raise RuntimeError(f"token is missing scopes: {sorted(missing)}")

    # --------------------------------------------------------------- taxonomy

    def list_taxonomy(self, kind: str) -> list[dict[str, Any]]:
        """kind: categories | tags | authors | entities | sources.

        Returns a plain array — these endpoints are NOT paginated.
        Reading requires the *.manage scope; there is no read-only taxonomy scope.
        """
        return self._data(self.request("GET", self._site(f"/{kind}")))

    def create_taxonomy(self, kind: str, body: dict[str, Any]) -> dict[str, Any]:
        return self._data(
            self.request(
                "POST",
                self._site(f"/{kind}"),
                json=body,
                idempotency_key=self.new_idempotency_key(),
            )
        )

    def resolve_categories(self, wanted: dict[str, str]) -> dict[str, str]:
        """wanted: {slug: display name}. Returns {slug: id}, creating what is missing."""
        by_slug = {c["slug"]: c["id"] for c in self.list_taxonomy("categories")}
        for slug, name in wanted.items():
            if slug not in by_slug:
                created = self.create_taxonomy("categories", {"name": name, "slug": slug})
                by_slug[slug] = created["id"]
        return by_slug

    # ------------------------------------------------------------------ media

    def upload_media(
        self,
        path: str,
        mime_type: str,
        external_key: str | None = None,
        filename: str | None = None,
    ) -> dict[str, Any]:
        """multipart/form-data, one file part named `file`.

        The declared mime type must match the actual bytes — the API detects the type
        from magic bytes and rejects a mismatch with 400.
        Accepted: image/jpeg, image/png, image/webp, image/gif, image/avif. No SVG.

        With external_key, a repeat upload returns the existing row instead of storing
        the bytes again (the status is still 201).
        """
        name = filename or os.path.basename(path)
        with open(path, "rb") as handle:
            return self._data(
                self.request(
                    "POST",
                    self._site("/media"),
                    files={"file": (name, handle, mime_type)},
                    params={"externalKey": external_key} if external_key else None,
                    idempotency_key=self.new_idempotency_key(),
                )
            )

    # --------------------------------------------------------------- articles

    def find_by_external_key(self, external_key: str) -> dict[str, Any] | None:
        page = self._data(
            self.request(
                "GET",
                self._site("/articles"),
                params={"externalKey": external_key, "limit": 1},
            )
        )
        items = page.get("items") or []
        return items[0] if items else None

    def iter_articles(self, **filters: Any) -> Iterator[dict[str, Any]]:
        """Walk the cursor pagination. Never construct a cursor yourself."""
        cursor = None
        while True:
            params = {k: v for k, v in filters.items() if v is not None}
            params["limit"] = params.get("limit", 100)
            if cursor:
                params["cursor"] = cursor
            page = self._data(self.request("GET", self._site("/articles"), params=params))
            yield from page.get("items") or []
            cursor = page.get("nextCursor")
            if not cursor:
                return

    def get_article(self, article_id: str) -> dict[str, Any]:
        return self._data(self.request("GET", self._site(f"/articles/{article_id}")))

    def create_article(self, body: dict[str, Any]) -> tuple[dict[str, Any], bool]:
        """Returns (article, created).

        201 = inserted now.  200 = an article with this externalKey already existed and
        is returned unchanged. Nothing in the BODY distinguishes them.
        """
        response = self.request(
            "POST",
            self._site("/articles"),
            json=body,
            idempotency_key=self.new_idempotency_key(),
        )
        return self._data(response), response.status_code == 201

    def update_article(
        self, article_id: str, body: dict[str, Any], if_match: int | None = None
    ) -> dict[str, Any]:
        """PATCH ignores Idempotency-Key; If-Match is the safety mechanism.

        Not accepted here: status, publishedAt, scheduledAt, externalKey.
        """
        return self._data(
            self.request(
                "PATCH",
                self._site(f"/articles/{article_id}"),
                json=body,
                if_match=if_match,
            )
        )

    # --------------------------------------------------------------- workflow

    def _transition(
        self, article_id: str, action: str, body: dict[str, Any] | None = None
    ) -> dict[str, Any]:
        return self._data(
            self.request(
                "POST",
                self._site(f"/articles/{article_id}/{action}"),
                json=body or {},
                # submit / reject / publish / archive are absorbed as a no-op 200 when the
                # article is already in the target state. approve and unpublish are NOT:
                # both target `draft`, and replaying either on an article already in
                # `draft` answers 409 INVALID_TRANSITION. The key is what makes those two
                # retryable. Sending one on the others costs nothing.
                idempotency_key=self.new_idempotency_key(),
            )
        )

    def submit(self, article_id, note=None):
        return self._transition(article_id, "submit", {"note": note} if note else {})

    def approve(self, article_id, note=None):
        return self._transition(article_id, "approve", {"note": note} if note else {})

    def reject(self, article_id, note=None):
        return self._transition(article_id, "reject", {"note": note} if note else {})

    def publish(self, article_id, note=None):
        return self._transition(article_id, "publish", {"note": note} if note else {})

    def unpublish(self, article_id, note=None):
        return self._transition(article_id, "unpublish", {"note": note} if note else {})

    def archive(self, article_id, note=None):
        return self._transition(article_id, "archive", {"note": note} if note else {})

    def schedule(self, article_id: str, scheduled_at: str, note: str | None = None):
        """scheduled_at: RFC 3339 with offset, e.g. '2026-09-01T09:00:00Z'.
        Must be in the future, or 409 CONFLICT."""
        body: dict[str, Any] = {"scheduledAt": scheduled_at}
        if note:
            body["note"] = note
        return self._transition(article_id, "schedule", body)

    # ---------------------------------------------------------------- preview

    def preview_urls(self, article_id: str) -> dict[str, str]:
        """`url` is the human renderer, `dataUrl` the JSON endpoint. TTL 15 minutes."""
        return self._data(
            self.request("POST", self._site(f"/articles/{article_id}/preview"))
        )
```

---

## 3. Reconciling a version conflict

`409 VERSION_CONFLICT` is never a transient failure. Re-read, re-apply, retry.

```python
def update_with_reconcile(client, article_id, mutate, attempts=3):
    """mutate(current_article) -> dict of fields to PATCH, or {} to stop."""
    for _ in range(attempts):
        current = client.get_article(article_id)
        body = mutate(current)
        if not body:
            return current
        try:
            return client.update_article(article_id, body, if_match=current["version"])
        except KalElError as exc:
            if exc.code != "VERSION_CONFLICT":
                raise
            continue      # somebody wrote first — read the new state and re-apply
    raise RuntimeError(f"could not converge on {article_id}; escalating")
```

---

## 4. End-to-end flow

Resolve taxonomy → upload media → create or update → submit → publish.

```python
import datetime as dt

REQUIRED_SCOPES = {
    "articles.create", "articles.read", "articles.update",
    "articles.submit", "articles.publish",
    "media.manage", "media.read",
    "taxonomy.categories.manage",
}

EXTERNAL_PREFIX = "my-pipeline"


def build_document(media_id: str) -> dict:
    """A valid v2 article document. Images are referenced by mediaId, never by URL."""
    return {
        "version": 2,
        "nodes": [
            {
                "type": "paragraph",
                "attrs": {},
                "content": [
                    {"type": "text", "text": "Opening paragraph with ", "marks": []},
                    {"type": "text", "text": "emphasis", "marks": [{"type": "bold"}]},
                    {"type": "text", "text": " and a ", "marks": []},
                    {
                        "type": "text",
                        "text": "link",
                        "marks": [
                            {"type": "link", "attrs": {"href": "https://example.com"}}
                        ],
                    },
                    {"type": "text", "text": ".", "marks": []},
                ],
            },
            {
                "type": "heading",
                "attrs": {"level": 2},
                "content": [{"type": "text", "text": "A section", "marks": []}],
            },
            {
                "type": "image",
                "attrs": {
                    "mediaId": media_id,
                    "altText": "What the image shows",
                    "caption": "Shown beneath the image",
                    "credit": "Photographer / Agency",
                },
            },
            {
                "type": "source",
                "attrs": {
                    "label": "Original report",
                    "url": "https://example.com/original",
                    "kind": "news",
                },
            },
        ],
    }


def ingest_one(client: KalElClient, item: dict) -> dict:
    # 1. taxonomy — resolved once per run in real code, not per item
    categories = client.resolve_categories({item["category_slug"]: item["category_name"]})

    # 2. media — externalKey makes a re-run reuse the stored bytes
    media = client.upload_media(
        item["image_path"],
        item["image_mime"],
        external_key=f"{EXTERNAL_PREFIX}:media:{item['id']}",
    )

    external_key = f"{EXTERNAL_PREFIX}:article:{item['id']}"
    payload = {
        "title": item["title"],
        "dek": item.get("dek"),
        "excerpt": item.get("excerpt"),
        "document": build_document(media["id"]),
        "categories": [categories[item["category_slug"]]],
        "featuredMediaId": media["id"],
        "seo": {
            "seoTitle": item.get("seo_title"),
            "metaDescription": item.get("meta_description"),
            "robotsIndex": "index",
            "robotsFollow": "follow",
        },
        "provenance": {
            "system": EXTERNAL_PREFIX,
            "sources": [
                {
                    "provider": item["source_provider"],
                    "externalId": str(item["id"]),
                    "externalUrl": item.get("source_url"),
                }
            ],
        },
    }

    # 3. create or update, decided by external identity
    existing = client.find_by_external_key(external_key)
    if existing is None:
        article, created = client.create_article({**payload, "externalKey": external_key})
        if not created:
            # A concurrent run inserted it between the lookup and the create.
            article = client.update_article(
                article["id"], payload, if_match=article["version"]
            )
    else:
        # externalKey, status, publishedAt and scheduledAt are NOT accepted by PATCH.
        article = update_with_reconcile(
            client, existing["id"], lambda _current: payload
        )

    # 4. workflow — only as far as the token's scopes allow
    if article["status"] == "draft":
        article = client.submit(article["id"], note="automated ingestion")

    return article


def main() -> None:
    client = KalElClient()
    client.assert_configured(REQUIRED_SCOPES)      # fail at startup, not mid-run

    item = {
        "id": 12345,
        "title": "A headline from the source system",
        "dek": "One line of standfirst.",
        "excerpt": "Short summary used in listings.",
        "category_slug": "cinema",
        "category_name": "Cinema",
        "image_path": "cover.jpg",
        "image_mime": "image/jpeg",
        "source_provider": "my-source",
        "source_url": "https://example.com/original",
        "seo_title": "A headline from the source system",
        "meta_description": "Short summary used in listings.",
    }

    article = ingest_one(client, item)
    print(f"{article['id']} -> {article['status']} (version {article['version']})")

    # 5. publish now, or schedule — both require the matching scope
    published = client.publish(article["id"], note="published by pipeline")
    print(f"published at {published['publishedAt']}")

    # or:
    # when = (dt.datetime.now(dt.timezone.utc) + dt.timedelta(hours=2))
    # client.schedule(article["id"], when.isoformat().replace("+00:00", "Z"))


if __name__ == "__main__":
    main()
```

---

## 5. Abbreviated request/response trace

```http
GET /v1/auth/me
Authorization: Bearer ke_st.REDACTED
```
```json
{ "data": { "kind": "service", "id": "…", "name": "Pipeline",
            "siteId": "6f1b0f6e-…", "scopes": ["articles.create", "…"] } }
```

```http
GET /v1/sites/6f1b0f6e-…/categories
```
```json
{ "data": [ { "id": "3f2504e0-…", "siteId": "6f1b0f6e-…", "parentId": null,
              "name": "Cinema", "slug": "cinema", "description": null,
              "createdAt": "…", "updatedAt": "…" } ] }
```

```http
POST /v1/sites/6f1b0f6e-…/media?externalKey=my-pipeline%3Amedia%3A12345
Content-Type: multipart/form-data; boundary=…
Idempotency-Key: py.4c2f9d3a1b7e4c8a9f012d3e4f5a6b7c

(one part named "file")
```
```json
HTTP/1.1 201 Created
{ "data": { "id": "b1c2d3e4-…", "filename": "cover.jpg", "mimeType": "image/jpeg",
            "sizeBytes": 91234, "width": 1600, "height": 900,
            "url": "https://api.example.com/v1/sites/…/media/b1c2d3e4-…/file",
            "externalKey": "my-pipeline:media:12345", "…": "…" } }
```

```http
GET /v1/sites/6f1b0f6e-…/articles?externalKey=my-pipeline%3Aarticle%3A12345&limit=1
```
```json
{ "data": { "items": [], "nextCursor": null } }
```

```http
POST /v1/sites/6f1b0f6e-…/articles
Content-Type: application/json
Idempotency-Key: py.9f3a1c9e5b2d4088a1c6b7d8e9f0a1b2
```
```json
HTTP/1.1 201 Created
{ "data": { "id": "7f0e…", "status": "draft", "version": 0,
            "slug": "a-headline-from-the-source-system",
            "externalKey": "my-pipeline:article:12345", "qualityFlags": [], "…": "…" } }
```

```http
POST /v1/sites/6f1b0f6e-…/articles/7f0e…/submit
Idempotency-Key: py.aa11bb22cc33dd44ee55ff6677889900
```
```json
HTTP/1.1 200 OK
{ "data": { "id": "7f0e…", "status": "in_review", "version": 1, "…": "…" } }
```

```http
POST /v1/sites/6f1b0f6e-…/articles/7f0e…/publish
Idempotency-Key: py.bb22cc33dd44ee55ff667788990011aa
```
```json
HTTP/1.1 200 OK
{ "data": { "id": "7f0e…", "status": "published", "version": 2,
            "publishedAt": "2026-08-19T18:00:00.000Z", "…": "…" } }
```

If the token lacks `articles.publish`, that last call is:

```json
HTTP/1.1 403 Forbidden
{ "error": { "code": "FORBIDDEN", "message": "missing permission: articles.publish",
             "details": { "requestId": "…" } } }
```

**Permissions determine how far a client can carry an article.** A client with
`articles.create` + `articles.submit` legitimately stops at `in_review` and hands over to a
human. Check the scopes at startup and plan the run around them.

---

## 6. Checklist for a production client

- [ ] `assert_configured()` at startup — verify `siteId` and every scope you will use
- [ ] One `Idempotency-Key` per logical attempt, generated **before** the first send and
      reused across that attempt's transport retries
- [ ] `externalKey` on every article and every media upload, stable across runs, namespaced
      and type-qualified (`prefix:article:123`, `prefix:media:123`)
- [ ] `If-Match` on every `PATCH`, taken from the response you just read
- [ ] Handle `409 VERSION_CONFLICT` by re-reading, never by retrying the same body
- [ ] Bounded retries with jitter; honour `retry-after` on 429
- [ ] Never assume the body is JSON, and never assume `error` is an object — a request
      to an unmatched route returns Fastify's 404, whose `error` is a plain string
- [ ] Branch on `error.code`, never on `error.message`
- [ ] Log `error.details.requestId` on every failure
- [ ] Resolve taxonomy once per run and cache it
- [ ] Upload media before referencing it — documents carry `mediaId`, never a URL
- [ ] Send `version: 2` documents with explicit `marks: []`, and an `attrs` object on
      every `list` and `table` node
- [ ] Never write a document back to an article whose `qualityFlags` contains
      `document_unreadable`
- [ ] Keep the token out of logs, URLs and source control
- [ ] Pace bulk work — the global limit is 600 requests/minute per token

---

## 7. What this example deliberately leaves out

| Not shown | Where to look |
|---|---|
| Webhook consumption | [WEBHOOKS.md](WEBHOOKS.md) — includes a Flask verifier |
| Minting a service token | [EXTERNAL_CLIENT_API.md §4](EXTERNAL_CLIENT_API.md#4-service-tokens) — an admin route |
| Session/cookie login | browser-only; a client has no reason to use it |
| Redirect management | `POST /v1/sites/{siteId}/redirects`, scope `seo.manage` |
| Document recovery | `articles.recover` routes — an operator action |
| Entities and sources | **different field shapes** — entities need `name` + `type`, sources need `name`; neither takes `slug`. See [EXTERNAL_CLIENT_API.md §11](EXTERNAL_CLIENT_API.md#11-taxonomies) |
| Concurrency control | request pooling, backpressure, and job scheduling are your client's design |

---

## Implementation references

The endpoints used above:

- `apps/api/src/routes/auth.ts` — `GET /v1/auth/me`
- `apps/api/src/routes/site.ts` — articles, taxonomy, media, transitions, preview
- `apps/api/src/services/articles.ts` — create/update/list semantics, `externalKey` lookup
- `apps/api/src/services/media.ts` — upload validation and dedup
- `apps/api/src/plugins/idempotency.ts` — `Idempotency-Key` handling
- `apps/api/src/plugins/errors.ts` — the error envelope
- `packages/contracts/src/editorial.ts` — the request schemas this payload must satisfy
- `packages/sdk/src/client.ts` — the TypeScript equivalent
