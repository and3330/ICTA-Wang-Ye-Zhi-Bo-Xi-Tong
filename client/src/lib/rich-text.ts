export type RichNode = { type: string; attrs?: Record<string, any>; text?: string; marks?: Array<{ type: string; attrs?: Record<string, any> }>; content?: RichNode[] };
export function isSafeRichTextLink(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (/^\/(?!\/)[^\\\s]*$/.test(value)) return !value.includes("..");
  try { return new URL(value).protocol === "https:"; } catch { return false; }
}

/** Keep editor JSON identical to the intentionally small server AST. */
export function canonicalizeRichText(value: RichNode): RichNode {
  const allowedMarks = new Set(["bold", "italic", "strike", "link"]);
  const allowedNodes = new Set(["doc", "paragraph", "text", "heading", "bulletList", "orderedList", "listItem", "hardBreak", "image"]);
  if (!allowedNodes.has(value.type)) {
    const text = collectText(value).trim();
    return text ? { type: "paragraph", content: [{ type: "text", text }] } : { type: "paragraph" };
  }
  const node: RichNode = { type: value.type };
  if (value.type === "text") {
    node.text = value.text || "";
    const marks = (value.marks || []).filter(mark => allowedMarks.has(mark.type) && (mark.type !== "link" || isSafeRichTextLink(mark.attrs?.href))).map(mark => mark.type === "link"
      ? { type: "link", attrs: { href: mark.attrs!.href } }
      : { type: mark.type });
    if (marks.length) node.marks = marks;
  } else if (value.type === "heading") {
    node.attrs = { level: value.attrs?.level === 3 ? 3 : 2 };
  } else if (value.type === "image") {
    node.attrs = { src: String(value.attrs?.src || "") };
    if (typeof value.attrs?.alt === "string" && value.attrs.alt) node.attrs.alt = value.attrs.alt;
    if (typeof value.attrs?.title === "string" && value.attrs.title) node.attrs.title = value.attrs.title;
  }
  if (value.content?.length) node.content = value.content.map(canonicalizeRichText);
  return node;
}

function collectText(value: RichNode): string {
  if (value.type === "text") return value.text || "";
  if (value.type === "hardBreak") return "\n";
  return (value.content || []).map(collectText).join("");
}