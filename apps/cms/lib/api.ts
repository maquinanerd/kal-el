const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function csrfToken(): string {
  if (typeof document === "undefined") return "";
  const m = document.cookie.match(/(?:^|;\s*)ke_csrf=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : "";
}

async function request<T>(method: string, path: string, body?: unknown, extraHeaders?: Record<string, string>): Promise<T> {
  const headers: Record<string, string> = { ...extraHeaders };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (method !== "GET" && method !== "HEAD") {
    const csrf = csrfToken();
    if (csrf) headers["x-kal-el-csrf"] = csrf;
  }
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    credentials: "include",
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const json = text ? (JSON.parse(text) as { data?: T; error?: { code?: string; message?: string } }) : undefined;
  if (!res.ok) {
    throw new ApiError(res.status, json?.error?.code ?? "UNKNOWN", json?.error?.message ?? `HTTP ${res.status}`);
  }
  return json?.data as T;
}

export type MeUser = { id: string; email: string; name: string; status: string };
export type MeResponse = { kind: "user"; user: MeUser; sessionId: string };
export type SiteInfo = { id: string; slug: string; name: string; status: string };
export type ArticleStatus = "draft" | "in_review" | "scheduled" | "published" | "blocked" | "archived";
export type ArticleSummary = {
  id: string;
  title: string;
  slug: string | null;
  status: ArticleStatus;
  version: number;
  updatedAt: string;
  publishedAt: string | null;
  // the API has always returned this; the local type omitted it, which is why the
  // calendar column had no choice but to read publishedAt and render an em dash
  scheduledAt: string | null;
};
export type ArticlePage = { items: ArticleSummary[]; nextCursor: string | null };

export function login(email: string, password: string): Promise<MeResponse> {
  return request<MeResponse>("POST", "/v1/auth/login", { email, password });
}

export function logout(): Promise<unknown> {
  return request("POST", "/v1/auth/logout");
}

export function me(): Promise<MeResponse> {
  return request<MeResponse>("GET", "/v1/auth/me");
}

export function listMySites(): Promise<SiteInfo[]> {
  return request<SiteInfo[]>("GET", "/v1/me/sites");
}

export function listArticles(
  siteId: string,
  // `nextCursor` was in the response type from the start and read by nobody: every list
  // surface silently stopped at the API default of 25 rows
  opts: { q?: string; status?: ArticleStatus; limit?: number; cursor?: string } = {},
): Promise<ArticlePage> {
  const params = new URLSearchParams();
  if (opts.q) params.set("q", opts.q);
  if (opts.status) params.set("status", opts.status);
  if (opts.limit) params.set("limit", String(opts.limit));
  if (opts.cursor) params.set("cursor", opts.cursor);
  const suffix = params.toString() ? `?${params.toString()}` : "";
  return request<ArticlePage>("GET", `/v1/sites/${siteId}/articles${suffix}`);
}

export type ArticleDetail = {
  id: string;
  title: string;
  dek: string | null;
  slug: string | null;
  status: ArticleStatus;
  version: number;
  excerpt: string | null;
  featuredMediaId: string | null;
  authors: string[];
  categories: string[];
  tags: string[];
  entities: string[];
  document: { version: number; nodes: unknown[] };
  seo: {
    seoTitle: string | null;
    metaDescription: string | null;
    canonicalUrl: string | null;
    robotsIndex: string;
    robotsFollow: string;
    socialTitle?: string | null;
    socialDescription?: string | null;
    socialImageMediaId?: string | null;
    primaryCategoryId?: string | null;
  };
  updatedAt: string;
  publishedAt: string | null;
};

export type ArticleRevision = { id: string; revisionNumber: number; document: { version: number; nodes: unknown[] }; note: string | null; createdAt: string };

export function createArticle(siteId: string, body: { title: string; slug?: string }): Promise<ArticleSummary & { id: string }> {
  return request("POST", `/v1/sites/${siteId}/articles`, body);
}

export function getArticle(siteId: string, articleId: string): Promise<ArticleDetail> {
  return request("GET", `/v1/sites/${siteId}/articles/${articleId}`);
}

export function updateArticle(
  siteId: string,
  articleId: string,
  body: Record<string, unknown>,
  ifMatch: number,
): Promise<ArticleDetail> {
  return request("PATCH", `/v1/sites/${siteId}/articles/${articleId}`, body, { "if-match": String(ifMatch) });
}

export function listRevisions(siteId: string, articleId: string): Promise<ArticleRevision[]> {
  return request("GET", `/v1/sites/${siteId}/articles/${articleId}/revisions`);
}

/**
 * @param idempotencyKey stable per user intent, so a double click or a lost response
 * replays instead of re-deriving. `approve` and `unpublish` both target `draft`, so the
 * server cannot tell a retry from a call that was never legal - the key is what makes
 * those two safe, and without it a double click surfaced a raw INVALID_TRANSITION.
 */
export function articleAction(
  siteId: string,
  articleId: string,
  action: string,
  idempotencyKey?: string,
): Promise<ArticleDetail> {
  return request(
    "POST",
    `/v1/sites/${siteId}/articles/${articleId}/${action}`,
    {},
    idempotencyKey ? { "idempotency-key": idempotencyKey } : undefined,
  );
}

/** `scheduledAt` is required and must be in the future; the endpoint is `.strict()`. */
export function scheduleArticle(
  siteId: string,
  articleId: string,
  scheduledAt: string,
  idempotencyKey?: string,
): Promise<ArticleDetail> {
  return request(
    "POST",
    `/v1/sites/${siteId}/articles/${articleId}/schedule`,
    { scheduledAt },
    idempotencyKey ? { "idempotency-key": idempotencyKey } : undefined,
  );
}

export function getPreviewUrl(siteId: string, articleId: string): Promise<{ url: string }> {
  return request("POST", `/v1/sites/${siteId}/articles/${articleId}/preview`, {});
}

// ---- media ----
export type MediaItem = {
  id: string;
  siteId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  altText: string | null;
  caption: string | null;
  credit: string | null;
  focalX: number | null;
  focalY: number | null;
  provider: string;
  url: string;
  createdAt: string;
  updatedAt: string;
};
export type MediaPage = { items: MediaItem[]; total: number };

export function listMedia(siteId: string, opts: { q?: string; limit?: number; offset?: number } = {}): Promise<MediaPage> {
  const params = new URLSearchParams();
  if (opts.q) params.set("q", opts.q);
  if (opts.limit) params.set("limit", String(opts.limit));
  if (opts.offset) params.set("offset", String(opts.offset));
  const suffix = params.toString() ? `?${params.toString()}` : "";
  return request<MediaPage>("GET", `/v1/sites/${siteId}/media${suffix}`);
}

export async function uploadMedia(siteId: string, file: File): Promise<MediaItem> {
  const form = new FormData();
  form.append("file", file);
  const headers: Record<string, string> = {};
  const csrf = csrfToken();
  if (csrf) headers["x-kal-el-csrf"] = csrf;
  const res = await fetch(`${API_BASE}/v1/sites/${siteId}/media`, { method: "POST", credentials: "include", headers, body: form });
  const text = await res.text();
  const json = text ? (JSON.parse(text) as { data?: MediaItem; error?: { code?: string; message?: string } }) : undefined;
  if (!res.ok) throw new ApiError(res.status, json?.error?.code ?? "UNKNOWN", json?.error?.message ?? `HTTP ${res.status}`);
  return json?.data as MediaItem;
}

export function deleteMedia(siteId: string, mediaId: string): Promise<{ id: string; deleted: boolean }> {
  return request("DELETE", `/v1/sites/${siteId}/media/${mediaId}`);
}

export function updateMedia(siteId: string, mediaId: string, body: Record<string, unknown>): Promise<MediaItem> {
  return request("PATCH", `/v1/sites/${siteId}/media/${mediaId}`, body);
}

// ---- stats ----
export type SiteStats = { articles: { total: number; byStatus: Record<string, number> }; media: number; categories: number; tags: number; authors: number };
export function stats(siteId: string): Promise<SiteStats> {
  return request<SiteStats>("GET", `/v1/sites/${siteId}/stats`);
}

// ---- taxonomy ----
export type Category = { id: string; name: string; slug: string; parentId: string | null; description: string | null };
export type Tag = { id: string; name: string; slug: string };
export type Entity = { id: string; name: string; type: string; description: string | null };
export type Author = { id: string; name: string; slug: string; bio: string | null; email: string | null };
export type Source = { id: string; name: string; url: string | null; kind: string };

export const listCategories = (siteId: string) => request<Category[]>("GET", `/v1/sites/${siteId}/categories`);
export const createCategory = (siteId: string, body: Record<string, unknown>) => request<Category>("POST", `/v1/sites/${siteId}/categories`, body);
export const updateCategory = (siteId: string, id: string, body: Record<string, unknown>) => request<Category>("PATCH", `/v1/sites/${siteId}/categories/${id}`, body);
export const deleteCategory = (siteId: string, id: string) => request<{ deleted: boolean }>("DELETE", `/v1/sites/${siteId}/categories/${id}`);

export const listTags = (siteId: string) => request<Tag[]>("GET", `/v1/sites/${siteId}/tags`);
export const createTag = (siteId: string, body: Record<string, unknown>) => request<Tag>("POST", `/v1/sites/${siteId}/tags`, body);
export const updateTag = (siteId: string, id: string, body: Record<string, unknown>) => request<Tag>("PATCH", `/v1/sites/${siteId}/tags/${id}`, body);
export const deleteTag = (siteId: string, id: string) => request<{ deleted: boolean }>("DELETE", `/v1/sites/${siteId}/tags/${id}`);

export const listEntities = (siteId: string) => request<Entity[]>("GET", `/v1/sites/${siteId}/entities`);
export const createEntity = (siteId: string, body: Record<string, unknown>) => request<Entity>("POST", `/v1/sites/${siteId}/entities`, body);
export const updateEntity = (siteId: string, id: string, body: Record<string, unknown>) => request<Entity>("PATCH", `/v1/sites/${siteId}/entities/${id}`, body);
export const deleteEntity = (siteId: string, id: string) => request<{ deleted: boolean }>("DELETE", `/v1/sites/${siteId}/entities/${id}`);

export const listAuthors = (siteId: string) => request<Author[]>("GET", `/v1/sites/${siteId}/authors`);
export const createAuthor = (siteId: string, body: Record<string, unknown>) => request<Author>("POST", `/v1/sites/${siteId}/authors`, body);
export const updateAuthor = (siteId: string, id: string, body: Record<string, unknown>) => request<Author>("PATCH", `/v1/sites/${siteId}/authors/${id}`, body);
export const deleteAuthor = (siteId: string, id: string) => request<{ deleted: boolean }>("DELETE", `/v1/sites/${siteId}/authors/${id}`);

export const listSources = (siteId: string) => request<Source[]>("GET", `/v1/sites/${siteId}/sources`);
export const createSource = (siteId: string, body: Record<string, unknown>) => request<Source>("POST", `/v1/sites/${siteId}/sources`, body);
export const updateSource = (siteId: string, id: string, body: Record<string, unknown>) => request<Source>("PATCH", `/v1/sites/${siteId}/sources/${id}`, body);
export const deleteSource = (siteId: string, id: string) => request<{ deleted: boolean }>("DELETE", `/v1/sites/${siteId}/sources/${id}`);

// ---- users / roles / tokens ----
export type User = { id: string; email: string; name: string; status: string };
export type Role = { id: string; key: string; name: string; description?: string };
export type ServiceToken = { id: string; name: string; scopes: string[]; expiresAt: string | null; revokedAt: string | null; createdAt: string };

export const listUsers = () => request<User[]>("GET", "/v1/admin/users");
export const createUser = (body: { email: string; name: string; password: string }) => request<User>("POST", "/v1/admin/users", body);
export const listRoles = () => request<Role[]>("GET", "/v1/admin/roles");
export const createRole = (body: { key: string; name: string; permissions: string[] }) => request<Role>("POST", "/v1/admin/roles", body);
export const assignRole = (userId: string, body: { roleId: string; siteId: string }) => request<{ assigned: boolean }>("POST", `/v1/admin/users/${userId}/roles`, body);
export const listServiceTokens = (siteId: string) => request<ServiceToken[]>("GET", `/v1/admin/sites/${siteId}/service-tokens`);
export const createServiceToken = (siteId: string, body: { name: string; scopes: string[] }) => request<ServiceToken & { token: string }>("POST", `/v1/admin/sites/${siteId}/service-tokens`, body);
export const revokeServiceToken = (siteId: string, tokenId: string) => request<{ id: string }>("POST", `/v1/admin/sites/${siteId}/service-tokens/${tokenId}/revoke`);

// ---- admin sites ----
export const listSites = () => request<SiteInfo[]>("GET", "/v1/admin/sites");
export const createSite = (body: { slug: string; name: string }) => request<SiteInfo>("POST", "/v1/admin/sites", body);
export const updateSite = (siteId: string, body: { name?: string; status?: string }) => request<SiteInfo>("PATCH", `/v1/admin/sites/${siteId}`, body);

// ---- audit ----
export type AuditEntry = { id: string; action: string; objectType: string; objectId: string; actorType: string; actorId: string | null; details: unknown; createdAt: string };
export const listAudit = (siteId: string) => request<AuditEntry[]>("GET", `/v1/sites/${siteId}/audit-log`);

// ---- redirects ----
export type Redirect = { id: string; sourcePath: string; targetPath: string; kind: string };
export const listRedirects = (siteId: string) => request<Redirect[]>("GET", `/v1/sites/${siteId}/redirects`);
export const createRedirect = (siteId: string, body: { sourcePath: string; targetPath: string; kind: string }) => request<Redirect>("POST", `/v1/sites/${siteId}/redirects`, body);
export const deleteRedirect = (siteId: string, id: string) => request<{ deleted: boolean }>("DELETE", `/v1/sites/${siteId}/redirects/${id}`);
