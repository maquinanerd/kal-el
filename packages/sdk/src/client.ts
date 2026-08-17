import { createHash } from "node:crypto";
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

function stableKey(method: string, path: string, body: unknown): string {
  const tag = `${method}\n${path}\n${JSON.stringify(body ?? {})}`;
  // deterministic and safe for the Idempotency-Key contract
  const digest = createHash("sha256").update(tag).digest("hex").slice(0, 24);
  return `sdk.${digest}`;
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
    const key = opts.idempotencyKey ?? (method === "GET" || method === "HEAD" ? undefined : stableKey(method, path, opts.body));
    const headers: Record<string, string> = {
      authorization: `Bearer ${this.token}`,
      "content-type": "application/json",
      ...(key ? { "idempotency-key": key } : {}),
      ...(opts.ifMatch ? { "if-match": opts.ifMatch } : {}),
    };

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
        const json = text ? (JSON.parse(text) as { data?: T; error?: { code?: string; message?: string } }) : undefined;

        if (res.ok && json?.data !== undefined) {
          return json.data;
        }
        if (res.status === 204) return undefined as T;

        const retryable = res.status === 408 || res.status === 429 || res.status >= 500;
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
        if (attempt < this.retries) {
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

  async uploadMedia(siteId: string, filename: string, data: Buffer, mimeType: string): Promise<Media> {
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(data)], { type: mimeType }), filename);
    const res = await this.fetchImpl(`${this.baseUrl}/v1/sites/${siteId}/media`, {
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
