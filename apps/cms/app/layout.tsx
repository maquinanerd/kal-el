import type { Metadata } from "next";
import type { ReactNode } from "react";
import localFont from "next/font/local";
import "@kal-el/design-system/tokens.css";
import "@kal-el/design-system/styles.css";
import "./globals.css";

import { AuthProvider } from "../lib/auth";
import { ChromeProvider } from "../lib/chrome";

// Tipografia da marca. Os .woff2 vivem em ./fonts (subset latin, baixados do Google
// Fonts e versionados): o build não depende de rede e o runtime não faz request externo.
// Os nomes das variáveis são os que tokens.css consome.
const poppins = localFont({
  src: [
    { path: "./fonts/Poppins-Regular.woff2", weight: "400", style: "normal" },
    { path: "./fonts/Poppins-Medium.woff2", weight: "500", style: "normal" },
    { path: "./fonts/Poppins-SemiBold.woff2", weight: "600", style: "normal" },
    { path: "./fonts/Poppins-Bold.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-poppins",
  display: "swap",
  fallback: ["system-ui", "Segoe UI", "Roboto", "Arial", "sans-serif"],
});

// Montserrat é fonte variável: um arquivo cobre todo o eixo de peso.
const montserrat = localFont({
  src: [{ path: "./fonts/Montserrat-Variable.woff2", weight: "100 900", style: "normal" }],
  variable: "--font-montserrat",
  display: "swap",
  fallback: ["system-ui", "Segoe UI", "Roboto", "Arial", "sans-serif"],
});

const montserratAlternates = localFont({
  src: [{ path: "./fonts/MontserratAlternates-Bold.woff2", weight: "700", style: "normal" }],
  variable: "--font-montserrat-alt",
  display: "swap",
  fallback: ["system-ui", "Segoe UI", "Roboto", "Arial", "sans-serif"],
});

export const metadata: Metadata = {
  title: "cms Kal-el",
  description: "CMS editorial Kal-el",
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
    <html
      lang="pt-BR"
      data-theme="light"
      className={`${poppins.variable} ${montserrat.variable} ${montserratAlternates.variable}`}
      suppressHydrationWarning
    >
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
      </head>
      <body className="peg-body">
        <AuthProvider>
          <ChromeProvider>{children}</ChromeProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
