import test from "node:test";
import assert from "node:assert/strict";
import { canonicalizeRichText } from "../client/src/lib/rich-text";

test("canonicalizer strips Tiptap nullable/default attrs and unknown marks", () => {
  const value = canonicalizeRichText({ type: "doc", content: [
    { type: "paragraph", content: [{ type: "text", text: "Visit", marks: [
      { type: "link", attrs: { href: "https://example.com", target: "_blank", rel: "noopener", class: null } },
      { type: "code" },
    ] }] },
    { type: "image", attrs: { src: "/uploads/a.png", alt: null, title: null, width: 900, height: 1200 } },
  ] });
  assert.deepEqual(value, { type: "doc", content: [
    { type: "paragraph", content: [{ type: "text", text: "Visit", marks: [{ type: "link", attrs: { href: "https://example.com" } }] }] },
    { type: "image", attrs: { src: "/uploads/a.png" } },
  ] });
});

test("canonicalizer converts unsupported blocks to safe paragraphs without losing text", () => {
  const value = canonicalizeRichText({ type: "doc", content: [
    { type: "blockquote", content: [{ type: "paragraph", content: [{ type: "text", text: "ordinary words" }] }] },
    { type: "horizontalRule" },
  ] });
  assert.deepEqual(value.content?.[0], { type: "paragraph", content: [{ type: "text", text: "ordinary words" }] });
  assert.deepEqual(value.content?.[1], { type: "paragraph" });
});

test("canonicalizer removes unsafe link marks without removing their text", () => {
  for (const href of ["http://example.com", "javascript:alert(1)"]) {
    const value = canonicalizeRichText({ type: "text", text: "keep me", marks: [{ type: "link", attrs: { href } }] });
    assert.deepEqual(value, { type: "text", text: "keep me" });
  }
});