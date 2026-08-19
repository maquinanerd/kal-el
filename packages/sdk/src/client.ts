import { randomUUID } from "node:crypto";
import type {
  Article,
  ArticleSummary,
  ArticleRevision,
  Author,
  Category,
  CreateAuthorBody,
  CreateCategoryBody,
  CreateEntityBody,
  CreateRedirectBody,
  CreateSourceBody,
  CreateTagBody,
  Entity,
  Media,
  Redirect,
  Source,
  Tag,
  CreateArticleInput,
  ArticleStatus,
} from "@kal-el/contracts";

export type KalElClientOptions = {
  baseUrl: string;
  /** scoped service token (Bearer) */
  token: string;
  /** max retries for idempotent requests (default 2) */
  retries?: number;
  fetchImpl?: typeof fetch;
  logger?: (line: string) => void;
};

export class KalElError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "KalElError";
  }
}

/**
 * A key identifies one attempt at one operation, not its content.
 *
 * This used to be a hash of (method, path, body), which made every repetition of the same
 * call collide for the length of the server's 24h window. Submit an article, have it
 * rejected, fix it and submit again: identical key, identical request hash, so the server
 * replayed the first response - no transition, no audit row, and the SDK handed the caller
 * a stale snapshot saying it had worked. It also made un-keyed creates dedupe, which is
 * the opposite of the documented contract.
 *
 * Generated once per `request()` call and reused by that call's retries, which is exactly
 * the window the header exists to cover.
 */
function attemptKey(): string {
  return `sdk.${randomUUID().replace(/-/g, "")}`;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class KalElClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly retries: number;
  private readonly fetchImpl: typeof fetch;
  private readonly logger: (line: string) => void;

  constructor(opts: KalElClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.token = opts.token;
    this.retries = opts.retries ?? 2;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.logger = opts.logger ?? (() => {});
  }

  private async request<T>(
    method: string,
    path: string,
    opts: { body?: unknown; idempotencyKey?: string; ifMatch?: string } = {},
  ): Promise<T> {
    const safe = method === "GET" || method === "HEAD";
    // PATCH and DELETE do not honour the header server-side, so a key would be theatre
    const keyed = method === "POST" || method === "PUT";
    const key = opts.idempotencyKey ?? (keyed ? attemptKey() : undefined);
    const headers: Record<string, string> = {
      authorization: `Bearer ${this.token}`,
      "content-type": "application/json",
      ...(key ? { "idempotency-key": key } : {}),
      ...(opts.ifMatch ? { "if-match": opts.ifMatch } : {}),
    };

    const replayableRequest = safe || key !== undefined;
    let attempt = 0;
    for (;;) {
      const url = `${this.baseUrl}${path}`;
      try {
        const res = await this.fetchImpl(url, {
          method,
          headers,
          body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
          signal: AbortSignal.timeout(15_000),
        });
        const text = await res.text();
        // A proxy answering 502 or 413 with HTML used to throw SyntaxError here, before
        // `res.status` was ever read - so the one thing an integrator switches on never
        // materialised, and the parse error was retried as if it were transient.
        let json: { data?: T; error?: { code?: string; message?: string } } | undefined;
        try {
          json = text ? (JSON.parse(text) as { data?: T; error?: { code?: string; message?: string } }) : undefined;
        } catch {
          json = undefined;
        }

        if (res.ok && json?.data !== undefined) {
          return json.data;
        }
        if (res.status === 204) return undefined as T;

        // PATCH and DELETE are not replayable server-side, so a retry of one that had
        // in fact been applied comes back as a 409 the caller records as a failure
        const replayable = safe || key !== undefined;
        const retryable = replayable && (res.status === 408 || res.status === 429 || res.status >= 500);
        if (retryable && attempt < this.retries) {
          attempt++;
          const delay = 200 * 2 ** (attempt - 1);
          this.logger(`[sdk] retry ${attempt}/${this.retries} ${method} ${path} (${res.status}) in ${delay}ms`);
          await sleep(delay);
          continue;
        }
        throw new KalElError(res.status, json?.error?.code ?? "UNKNOWN", json?.error?.message ?? `HTTP ${res.status}`);
      } catch (err) {
        if (err instanceof KalElError) throw err;
        if (replayableRequest && attempt < this.retries) {
          attempt++;
          const delay = 200 * 2 ** (attempt - 1);
          this.logger(`[sdk] retry ${attempt}/${this.retries} ${method} ${path} after error`);
          await sleep(delay);
          continue;
        }
        throw err;
      }
    }
  }

  getArticle(siteId: string, articleId: string): Promise<Article> {
    return this.request("GET", `/v1/sites/${siteId}/articles/${articleId}`);
  }

  listArticles(siteId: string, query: Record<string, string | number | undefined> = {}): Promise<{ items: ArticleSummary[]; nextCursor: string | null }> {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined) qs.set(k, String(v));
    }
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return this.request("GET", `/v1/sites/${siteId}/articles${suffix}`);
  }

  createArticle(siteId: string, body: CreateArticleInput, idempotencyKey?: string): Promise<Article> {
    return this.request("POST", `/v1/sites/${siteId}/articles`, { body, idempotencyKey });
  }

  updateArticle(siteId: string, articleId: string, body: Record<string, unknown>, ifMatch?: string, idempotencyKey?: string): Promise<Article> {
    return this.request("PATCH", `/v1/sites/${siteId}/articles/${articleId}`, { body, ifMatch, idempotencyKey });
  }

  publishArticle(siteId: string, articleId: string, note?: string, idempotencyKey?: string): Promise<Article> {
    return this.request("POST", `/v1/sites/${siteId}/articles/${articleId}/publish`, { body: note ? { note } : {}, idempotencyKey });
  }

  scheduleArticle(siteId: string, articleId: string, scheduledAt: string, note?: string): Promise<Article> {
    return this.request("POST", `/v1/sites/${siteId}/articles/${articleId}/schedule`, { body: { scheduledAt, ...(note ? { note } : {}) } });
  }

  listCategories(siteId: string): Promise<Category[]> {
    return this.request("GET", `/v1/sites/${siteId}/categories`);
  }

  createCategory(siteId: string, body: CreateCategoryBody, idempotencyKey?: string): Promise<Category> {
    return this.request("POST", `/v1/sites/${siteId}/categories`, { body, idempotencyKey });
  }

  listTags(siteId: string): Promise<Tag[]> {
    return this.request("GET", `/v1/sites/${siteId}/tags`);
  }

  createTag(siteId: string, body: CreateTagBody, idempotencyKey?: string): Promise<Tag> {
    return this.request("POST", `/v1/sites/${siteId}/tags`, { body, idempotencyKey });
  }

  listAuthors(siteId: string): Promise<Author[]> {
    return this.request("GET", `/v1/sites/${siteId}/authors`);
  }

  createAuthor(siteId: string, body: CreateAuthorBody, idempotencyKey?: string): Promise<Author> {
    return this.request("POST", `/v1/sites/${siteId}/authors`, { body, idempotencyKey });
  }

  createRedirect(siteId: string, body: CreateRedirectBody, idempotencyKey?: string): Promise<Redirect> {
    return this.request("POST", `/v1/sites/${siteId}/redirects`, { body, idempotencyKey });
  }

  // ---- editorial workflow ----
  submitArticle(siteId: string, articleId: string, note?: string, idempotencyKey?: string): Promise<Article> {
    return this.request("POST", `/v1/sites/${siteId}/articles/${articleId}/submit`, { body: note ? { note } : {}, idempotencyKey });
  }

  approveArticle(siteId: string, articleId: string, note?: string, idempotencyKey?: string): Promise<Article> {
    return this.request("POST", `/v1/sites/${siteId}/articles/${articleId}/approve`, { body: note ? { note } : {}, idempotencyKey });
  }

  rejectArticle(siteId: string, articleId: string, note?: string, idempotencyKey?: string): Promise<Article> {
    return this.request("POST", `/v1/sites/${siteId}/articles/${articleId}/reject`, { body: note ? { note } : {}, idempotencyKey });
  }

  unpublishArticle(siteId: string, articleId: string, note?: string, idempotencyKey?: string): Promise<Article> {
    return this.request("POST", `/v1/sites/${siteId}/articles/${articleId}/unpublish`, { body: note ? { note } : {}, idempotencyKey });
  }

  archiveArticle(siteId: string, articleId: string, note?: string, idempotencyKey?: string): Promise<Article> {
    return this.request("POST", `/v1/sites/${siteId}/articles/${articleId}/archive`, { body: note ? { note } : {}, idempotencyKey });
  }

  listRevisions(siteId: string, articleId: string): Promise<ArticleRevision[]> {
    return this.request("GET", `/v1/sites/${siteId}/articles/${articleId}/revisions`);
  }

  // ---- media ----
  listMedia(siteId: string, query: Record<string, string | number | undefined> = {}): Promise<{ items: Media[]; total: number }> {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined) qs.set(k, String(v));
    }
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return this.request("GET", `/v1/sites/${siteId}/media${suffix}`);
  }

  /**
   * @param externalKey stable id of this asset in the source system. When given, a
   * repeated upload of the same asset returns the existing media row instead of storing
   * a second copy - which is what makes a re-import non-duplicating.
   */
  async uploadMedia(
    siteId: string,
    filename: string,
    data: Buffer,
    mimeType: string,
    externalKey?: string,
  ): Promise<Media> {
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(data)], { type: mimeType }), filename);
    const query = externalKey ? `?externalKey=${encodeURIComponent(externalKey)}` : "";
    const res = await this.fetchImpl(`${this.baseUrl}/v1/sites/${siteId}/media${query}`, {
      method: "POST",
      headers: { authorization: `Bearer ${this.token}` },
      body: form,
      signal: AbortSignal.timeout(30_000),
    });
    const text = await res.text();
    const json = text ? (JSON.parse(text) as { data?: Media; error?: { code?: string; message?: string } }) : undefined;
    if (!res.ok) throw new KalElError(res.status, json?.error?.code ?? "UNKNOWN", json?.error?.message ?? `HTTP ${res.status}`);
    return json?.data as Media;
  }

  deleteMedia(siteId: string, mediaId: string): Promise<{ id: string; deleted: boolean }> {
    return this.request("DELETE", `/v1/sites/${siteId}/media/${mediaId}`);
  }

  updateMedia(siteId: string, mediaId: string, body: Record<string, unknown>): Promise<Media> {
    return this.request("PATCH", `/v1/sites/${siteId}/media/${mediaId}`, { body });
  }

  // ---- entities / sources ----
  listEntities(siteId: string, type?: string): Promise<Entity[]> {
    const suffix = type ? `?type=${encodeURIComponent(type)}` : "";
    return this.request("GET", `/v1/sites/${siteId}/entities${suffix}`);
  }

  createEntity(siteId: string, body: CreateEntityBody, idempotencyKey?: string): Promise<Entity> {
    return this.request("POST", `/v1/sites/${siteId}/entities`, { body, idempotencyKey });
  }

  listSources(siteId: string): Promise<Source[]> {
    return this.request("GET", `/v1/sites/${siteId}/sources`);
  }

  createSource(siteId: string, body: CreateSourceBody, idempotencyKey?: string): Promise<Source> {
    return this.request("POST", `/v1/sites/${siteId}/sources`, { body, idempotencyKey });
  }
}

export { ArticleStatus };
