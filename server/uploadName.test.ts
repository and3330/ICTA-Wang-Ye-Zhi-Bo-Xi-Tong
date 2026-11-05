import test from "node:test";
import assert from "node:assert/strict";
import { repairUtf8Name } from "../shared/uploadName";

const asLatin1 = (text: string) => Buffer.from(text, "utf8").toString("latin1");

test("restores Chinese file names read as Latin-1", () => {
  assert.equal(repairUtf8Name(asLatin1("ChatGPT Image 2026年6月29日.webp")), "ChatGPT Image 2026年6月29日.webp");
  assert.equal(repairUtf8Name(asLatin1("活動主圖.png")), "活動主圖.png");
});

test("leaves names that are already right alone", () => {
  assert.equal(repairUtf8Name("banner.png"), "banner.png");
  assert.equal(repairUtf8Name("活動主圖.png"), "活動主圖.png");
  assert.equal(repairUtf8Name("café.png"), "café.png");
  assert.equal(repairUtf8Name(""), "");
});
