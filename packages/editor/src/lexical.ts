import type { ArticleDocument, DocumentNode } from "@kal-el/contracts";
import { createHeadlessEditor } from "@lexical/headless";
import { $createHeadingNode, $createQuoteNode, HeadingNode, QuoteNode } from "@lexical/rich-text";
import { $createListItemNode, $createListNode, ListItemNode, ListNode } from "@lexical/list";
import { $createParagraphNode, $createTextNode, $getRoot, ParagraphNode, RootNode, TextNode } from "lexical";

export type LexicalEditor = ReturnType<typeof createHeadlessEditor>;

/**
 * Lexical headless prototype. Lexical's extension model uses node classes:
 * custom Kal El nodes (image, gallery, embed, source) would each require a
 * Node subclass registered here — this prototype registers the core rich-text
 * block set and documents that extension cost for the ADR comparison.
 */
export function buildLexicalEditor(): LexicalEditor {
  return createHeadlessEditor({
    nodes: [RootNode, TextNode, ParagraphNode, HeadingNode, QuoteNode, ListNode, ListItemNode],
  });
}

const HEADING_TAG: Record<2 | 3 | 4, "h2" | "h3" | "h4"> = { 2: "h2", 3: "h3", 4: "h4" };
const TAG_LEVEL: Record<string, number> = { h2: 2, h3: 3, h4: 4 };

export async function documentToLexical(editor: LexicalEditor, document: ArticleDocument): Promise<void> {
  await editor.update(() => {
    const root = $getRoot();
    root.clear();
    for (const node of document.nodes) {
      switch (node.type) {
        case "paragraph":
          root.append($createParagraphNode().append($createTextNode(node.content)));
          break;
        case "heading":
          root.append($createHeadingNode(HEADING_TAG[node.attrs.level as 2 | 3 | 4]).append($createTextNode(node.content)));
          break;
        case "quote":
          root.append($createQuoteNode().append($createTextNode(node.content)));
          break;
        case "list": {
          const list = $createListNode(node.attrs.ordered ? "number" : "bullet");
          for (const item of node.content) {
            list.append($createListItemNode().append($createTextNode(item)));
          }
          root.append(list);
          break;
        }
        default:
          // image/gallery/embed/source: require custom Node subclasses (documented)
          break;
      }
    }
  });
}

type SerializedNode = {
  type: string;
  text?: string;
  tag?: string;
  listType?: string;
  children?: SerializedNode[];
};

function textOf(node: SerializedNode): string {
  if (node.text != null) return node.text;
  if (Array.isArray(node.children)) return node.children.map(textOf).join("");
  return "";
}

export function lexicalToDocument(editor: LexicalEditor): ArticleDocument {
  const state = editor.getEditorState().toJSON() as { root: { children?: SerializedNode[] } };
  const children = state.root.children ?? [];
  const nodes: DocumentNode[] = [];
  for (const child of children) {
    switch (child.type) {
      case "paragraph":
        nodes.push({ type: "paragraph", attrs: {}, content: textOf(child) });
        break;
      case "heading":
        nodes.push({ type: "heading", attrs: { level: (TAG_LEVEL[child.tag ?? ""] ?? 2) as 2 | 3 | 4 }, content: textOf(child) });
        break;
      case "quote":
        nodes.push({ type: "quote", attrs: {}, content: textOf(child) });
        break;
      case "list": {
        const items = (child.children ?? []).map(textOf);
        nodes.push({ type: "list", attrs: { ordered: child.listType === "number" }, content: items });
        break;
      }
      default:
        break;
    }
  }
  return { version: 1, nodes };
}

export function serializeDeterministic(editor: LexicalEditor): string {
  return JSON.stringify(editor.getEditorState().toJSON());
}
