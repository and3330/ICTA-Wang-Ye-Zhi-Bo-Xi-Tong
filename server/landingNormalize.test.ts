import test from "node:test";
import assert from "node:assert/strict";
import { applyUploadedImageToBlock, normalizeLandingBlocks } from "../client/src/lib/landing-normalize";

test("landing normalization omits blank optional image fields", () => {
  const blocks = normalizeLandingBlocks([
    { id: "hero", type: "hero", enabled: true, headline: "H", ctaLabel: "Go", imageUrl: " " },
    { id: "teacher", type: "instructor", enabled: true, headline: "T", name: "N", bio: "B", imageUrl: "" },
  ], { id: "fallback", type: "hero", enabled: true });
  assert.equal("imageUrl" in blocks[0], false);
  assert.equal("imageUrl" in blocks[1], false);
});

test("delayed image application preserves concurrent edits/order/additions and never resurrects deletes", () => {
  const latest = [
    { id: "added", type: "cta", headline: "new" },
    { id: "hero", type: "hero", headline: "concurrently edited" },
    { id: "intro", type: "intro", content: "unchanged" },
  ];
  const result = applyUploadedImageToBlock(latest, "hero", "/uploads/safe.png");
  assert.equal(result.applied, true);
  assert.deepEqual(result.blocks.map(block => block.id), ["added", "hero", "intro"]);
  assert.deepEqual(result.blocks[1], { id: "hero", type: "hero", headline: "concurrently edited", imageUrl: "/uploads/safe.png" });
  assert.strictEqual(result.blocks[0], latest[0]);
  assert.strictEqual(result.blocks[2], latest[2]);

  const deleted = latest.filter(block => block.id !== "hero");
  const discarded = applyUploadedImageToBlock(deleted, "hero", "/uploads/safe.png");
  assert.equal(discarded.applied, false);
  assert.strictEqual(discarded.blocks, deleted);
});