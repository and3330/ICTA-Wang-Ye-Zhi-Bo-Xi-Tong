import React from "react";

export type RichTextNode = { type: string; text?: string; attrs?: Record<string, any>; marks?: Array<{ type: string; attrs?: Record<string, any> }>; content?: RichTextNode[] };

const safeHref = (value: unknown) => {
  if (typeof value !== "string") return undefined;
  if (/^\/(?!\/)[^\s\\]*$/.test(value) && !value.includes("..")) return value;
  try { return new URL(value).protocol === "https:" ? value : undefined; } catch { return undefined; }
};
const safeImageSrc = (value: unknown) => {
  if (typeof value !== "string") return undefined;
  if (/^\/uploads\/[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)) return value;
  try { return new URL(value).protocol === "https:" ? value : undefined; } catch { return undefined; }
};

function Inline({ node }: { node: RichTextNode }) {
  if (node.type === "text") {
    let result: React.ReactNode = node.text || "";
    for (const mark of node.marks || []) {
      if (mark.type === "bold") result = <strong>{result}</strong>;
      else if (mark.type === "italic") result = <em>{result}</em>;
      else if (mark.type === "strike") result = <s>{result}</s>;
      else if (mark.type === "link") {
        const href = safeHref(mark.attrs?.href);
        result = href ? <a href={href} target={href.startsWith("/") ? undefined : "_blank"} rel={href.startsWith("/") ? undefined : "noopener noreferrer"}>{result}</a> : result;
      }
    }
    return result;
  }
  if (node.type === "hardBreak") return <br />;
  if (node.type === "image") {
    const src = safeImageSrc(node.attrs?.src);
    return src ? <img src={src} alt={node.attrs?.alt || ""} title={node.attrs?.title} loading="lazy" /> : null;
  }
  return <>{(node.content || []).map((child, i) => <Inline key={i} node={child} />)}</>;
}

export function SafeRichText({ value, className }: { value: RichTextNode; className?: string }) {
  const render = (node: RichTextNode, key: React.Key): React.ReactNode => {
    const children = (node.content || []).map((child, i) => render(child, i));
    if (node.type === "doc") return <React.Fragment key={key}>{children}</React.Fragment>;
    if (node.type === "paragraph") return <p key={key}><>{children}</></p>;
    if (node.type === "heading") return node.attrs?.level === 3 ? <h3 key={key}><>{children}</></h3> : <h2 key={key}><>{children}</></h2>;
    if (node.type === "bulletList") return <ul key={key}>{children}</ul>;
    if (node.type === "orderedList") return <ol key={key}>{children}</ol>;
    if (node.type === "listItem") return <li key={key}>{children}</li>;
    if (node.type === "text" || node.type === "hardBreak" || node.type === "image") return <React.Fragment key={key}><Inline node={node} /></React.Fragment>;
    return null;
  };
  return <div className={className}>{render(value, "root")}</div>;
}