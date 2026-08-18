import type { Metadata } from "next";
import type { ReactNode } from "react";
import "@kal-el/design-system/tokens.css";
import "@kal-el/design-system/styles.css";
import "./globals.css";

import { AuthProvider } from "../lib/auth";

export const metadata: Metadata = {
  title: "Kal El CMS",
  description: "CMS editorial Kal El",
};

/**
 * Applies the stored theme (or the OS preference) before first paint, so the page never
 * flashes light before switching to dark. Kept in sync with `components/ThemeToggle.tsx`.
 */
const THEME_BOOTSTRAP = `(function(){try{
var s=localStorage.getItem('kal-el-theme');
var t=(s==='light'||s==='dark')?s:(window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');
document.documentElement.setAttribute('data-theme',t);
}catch(e){document.documentElement.setAttribute('data-theme','light');}})();`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // suppressHydrationWarning: the bootstrap script rewrites data-theme before React
    // hydrates, so server and client markup legitimately differ on this one attribute.
    <html lang="pt-BR" data-theme="light" suppressHydrationWarning>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
      </head>
      <body className="peg-body">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
