export type Surface = {
  id: string;
  label: string;
  path: string;
  /** Surfaces that need an existing article id substituted into the path. */
  needsArticle?: boolean;
  needsMedia?: boolean;
  /** Public surfaces that must not require a session. */
  anonymous?: boolean;
};

export const BREAKPOINTS = [
  { id: "375", width: 375, height: 812 },
  { id: "390", width: 390, height: 844 },
  { id: "768", width: 768, height: 1024 },
  { id: "1024", width: 1024, height: 768 },
  { id: "1440", width: 1440, height: 900 },
] as const;

export const THEMES = ["light", "dark"] as const;

export const SURFACES: Surface[] = [
  { id: "login", label: "Login", path: "/login", anonymous: true },
  { id: "dashboard", label: "Dashboard", path: "/" },
  { id: "articles", label: "Articles", path: "/articles" },
  { id: "article-editor", label: "Article Editor", path: "/articles/__ARTICLE__", needsArticle: true },
  { id: "media", label: "Media Library", path: "/media" },
  { id: "media-detail", label: "Media Detail", path: "/media/__MEDIA__", needsMedia: true },
  { id: "categories", label: "Categories", path: "/categories" },
  { id: "tags", label: "Tags", path: "/tags" },
  { id: "entities", label: "Entities", path: "/entities" },
  { id: "authors", label: "Authors", path: "/authors" },
  { id: "sources", label: "Sources", path: "/sources" },
  { id: "workflow", label: "Workflow", path: "/workflow" },
  { id: "calendar", label: "Calendar", path: "/calendar" },
  { id: "users", label: "Users", path: "/users" },
  { id: "roles", label: "Roles", path: "/roles" },
  { id: "sites", label: "Sites", path: "/sites" },
  { id: "tokens", label: "Service tokens", path: "/tokens" },
  { id: "audit", label: "Audit log", path: "/audit" },
  { id: "settings", label: "Settings", path: "/settings" },
];

export const CREDENTIALS = {
  email: "owner@kalel.dev",
  password: "kalel-dev-password-1",
};
