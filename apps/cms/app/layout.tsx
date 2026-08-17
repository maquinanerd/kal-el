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

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR" data-theme="light">
      <body className="peg-body">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
