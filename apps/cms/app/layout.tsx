import type { Metadata } from "next";
import type { ReactNode } from "react";
import localFont from "next/font/local";
import "@kal-el/design-system/tokens.css";
import "@kal-el/design-system/styles.css";
import "./globals.css";

import { AuthProvider } from "../lib/auth";

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

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="pt-BR"
      data-theme="light"
      className={`${poppins.variable} ${montserrat.variable} ${montserratAlternates.variable}`}
    >
      <body className="peg-body">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
