import test from "node:test";
import assert from "node:assert/strict";
import { ctaButtonAppearance, readableTextColor } from "./cta-style";

test("main style is the default and uses the brand color", () => {
  assert.deepEqual(ctaButtonAppearance(undefined), { variant: "default" });
  assert.deepEqual(ctaButtonAppearance(null, ""), { variant: "default" });
  assert.deepEqual(ctaButtonAppearance("primary", "#0f766e"), {
    variant: "default",
    style: { backgroundColor: "#0f766e", borderColor: "#0f766e", color: "#ffffff" },
  });
  assert.equal(ctaButtonAppearance(undefined, "#fde047").style?.color, "#111111");
});

test("gray and red keep their own colors; bad brand colors are ignored", () => {
  assert.deepEqual(ctaButtonAppearance("secondary", "#0f766e"), { variant: "secondary" });
  assert.deepEqual(ctaButtonAppearance("danger", "#0f766e"), { variant: "destructive" });
  assert.deepEqual(ctaButtonAppearance("primary", "red; background: url(x)"), { variant: "default" });
});

test("text color follows background lightness", () => {
  assert.equal(readableTextColor("#000"), "#ffffff");
  assert.equal(readableTextColor("#ffffff"), "#111111");
  assert.equal(readableTextColor("#3b82f6"), "#ffffff");
});
