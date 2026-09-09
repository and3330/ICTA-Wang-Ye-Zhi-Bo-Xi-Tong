import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createUploadStorage, uploadObjectKey } from "./uploadStorage";

test("local upload adapter stores objects without requiring App Storage", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "sellcase-uploads-"));
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = "test";
  try {
    const storage = createUploadStorage(directory);
    const key = uploadObjectKey("asset.png");
    await storage.put(key, Buffer.from("image"));
    assert.deepEqual(await storage.get(key), Buffer.from("image"));
    assert.deepEqual(await readFile(path.join(directory, "asset.png")), Buffer.from("image"));
    await storage.delete(key);
    assert.equal(await storage.get(key), null);
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
    await rm(directory, { recursive: true, force: true });
  }
});

test("upload object keys remain within the private uploads namespace", () => {
  assert.equal(uploadObjectKey("abc.webp"), "uploads/abc.webp");
});