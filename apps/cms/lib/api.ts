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

export function listArticles(siteId: string, q?: string): Promise<ArticlePage> {
  const suffix = q ? `?q=${encodeURIComponent(q)}` : "";
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
  document: { version: number; nodes: unknown[] };
  seo: { seoTitle: string | null; metaDescription: string | null; canonicalUrl: string | null; robotsIndex: string; robotsFollow: string };
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
