import type { ReactNode } from "react";

export function EditorSurface({
  title,
  dek,
  body,
  defaultBody,
}: {
  title?: string;
  dek?: string;
  body?: string;
  defaultBody?: string;
}) {
  return (
    <div className="peg-editor">
      <input className="peg-editor__title" placeholder="Título da matéria" defaultValue={title} aria-label="Título" />
      <input className="peg-editor__dek" placeholder="Subtítulo / linha de apoio (dek)" defaultValue={dek} aria-label="Subtítulo" />
      <div className="peg-editor__body" contentEditable={false}>
        {body ? (
          <>
            <p>{body}</p>
          </>
        ) : (
          <>
            <p>
              O editor de artigos é o coração do Kal El: uma experiência de escrita
              contínua, sem cards ao redor de cada bloco.
            </p>
            <p>
              A hierarquia é documental — o título é o H1 natural, e o corpo usa
              H2–H4 conforme a estrutura da matéria.
            </p>
            <h2>Seção de exemplo</h2>
            <p>
              A referência visual é o padrão "editor + inspector" do corpus PEG,
              e não uma grade de blocos exposta.
            </p>
            <blockquote>As citações são destacadas com hierarquia de borda, não de cor.</blockquote>
            {defaultBody && <p>{defaultBody}</p>}
          </>
        )}
      </div>
    </div>
  );
}

export function InlineToolbar({ open = false, anchor }: { open?: boolean; anchor?: "left" | "center" }) {
  return (
    <div style={{ position: "relative", display: "inline-block", marginTop: 8 }}>
      <span className="peg-editor__body" style={{ display: "block", padding: 0, color: "var(--peg-text-primary)" }}>
        texto selecionado
      </span>
      {open && (
        <div className="peg-inline-toolbar" style={{ position: "absolute", top: 30, left: anchor === "center" ? -80 : 0 }}>
          <ToolbarBtn label="Negrito" active>
            <b>B</b>
          </ToolbarBtn>
          <ToolbarBtn label="Itálico">
            <i>I</i>
          </ToolbarBtn>
          <ToolbarBtn label="Tachado">
            <s>S</s>
          </ToolbarBtn>
          <span className="peg-inline-toolbar__sep" />
          <ToolbarBtn label="Link">🔗</ToolbarBtn>
          <ToolbarBtn label="Citação">❝</ToolbarBtn>
        </div>
      )}
    </div>
  );
}

function ToolbarBtn({ label, active, children }: { label: string; active?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      className={`peg-inline-toolbar__btn ${active ? "peg-inline-toolbar__btn--active" : ""}`}
    >
      {children}
    </button>
  );
}
