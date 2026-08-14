import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Badge } from "./Badge.js";
import { Button } from "./Button.js";
import { Input } from "./FormControls.js";
import { SegmentedControl, Tabs } from "./Tabs.js";

describe("design-system primitives", () => {
  it("renders a primary button with PEG classes", () => {
    render(<Button variant="primary">Salvar</Button>);
    const btn = screen.getByRole("button", { name: "Salvar" });
    expect(btn.className).toContain("peg-btn--primary");
  });

  it("renders a field label and error state", () => {
    render(<Input label="Título" error="Campo inválido" />);
    expect(screen.getByText("Título")).toBeInTheDocument();
    expect(screen.getByText("Campo inválido")).toBeInTheDocument();
    expect(screen.getByRole("textbox")).toHaveAttribute("aria-invalid", "true");
  });

  it("marks the active tab", () => {
    render(<Tabs tabs={[{ id: "a", label: "Todos" }, { id: "b", label: "Draft" }]} active="b" onChange={() => undefined} />);
    const draft = screen.getByRole("tab", { name: "Draft" });
    expect(draft).toHaveAttribute("aria-selected", "true");
  });

  it("marks the active segmented option", () => {
    render(
      <SegmentedControl
        options={[{ value: "grid", label: "Grade" }, { value: "lista", label: "Lista" }]}
        value="lista"
        onChange={() => undefined}
      />,
    );
    expect(screen.getByRole("button", { name: "Lista" })).toHaveAttribute("aria-pressed", "true");
  });

  it("renders badge tones", () => {
    render(<Badge tone="success" dot>Publicado</Badge>);
    expect(screen.getByText("Publicado").className).toContain("peg-badge--success");
  });
});
