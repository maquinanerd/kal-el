"use client";

import { useRouter } from "next/navigation";
import { Button } from "@kal-el/design-system";

/**
 * 404 inside the shell.
 *
 * The default Next.js page dropped an authenticated editor onto a bare white page with no
 * navigation, no theme and no way back except the browser's own button - it did not look
 * like the product at all. Living under `(app)` means the sidebar, topbar and theme are
 * still there, so a mistyped id is a wrong turn rather than an exit.
 */
export default function NotFound() {
  const router = useRouter();
  return (
    <div className="kalel-notfound">
      <span className="kalel-notfound__code">Erro 404</span>
      <h1 className="kalel-notfound__title">Não encontrado</h1>
      <p className="kalel-notfound__body">
        A página que você tentou abrir não existe, foi removida, ou pertence a um site ao qual
        você não tem acesso.
      </p>
      <div className="peg-row">
        <Button variant="secondary" onClick={() => router.back()}>
          Voltar
        </Button>
        <Button variant="secondary" onClick={() => router.push("/")}>
          Dashboard
        </Button>
        <Button variant="primary" onClick={() => router.push("/articles")}>
          Ir para Artigos
        </Button>
      </div>
    </div>
  );
}
