import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createObjectUploadStorage, createUploadStorage, uploadObjectKey } from "./uploadStorage";

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

test("production object storage initializes lazily and reuses a healthy client", async () => {
  let clientsCreated = 0;
  const client = {
    uploadFromBytes: async () => ({ ok: true, value: undefined }),
    downloadAsBytes: async () => ({ ok: true, value: [Buffer.from("image")] }),
    delete: async () => ({ ok: true, value: undefined }),
  };
  const storage = createObjectUploadStorage(() => {
    clientsCreated += 1;
    return client as any;
  });

  assert.equal(clientsCreated, 0);
  await storage.put("uploads/asset.png", Buffer.from("image"));
  assert.deepEqual(await storage.get("uploads/asset.png"), Buffer.from("image"));
  await storage.delete("uploads/asset.png");
  assert.equal(clientsCreated, 1);
});

test("production object storage retries initialization after a transient failure", async () => {
  let clientsCreated = 0;
  const storage = createObjectUploadStorage(() => {
    clientsCreated += 1;
    if (clientsCreated === 1) {
      return {
        uploadFromBytes: async () => { throw new Error("storage temporarily unavailable"); },
      } as any;
    }
    return {
      uploadFromBytes: async () => ({ ok: true, value: undefined }),
    } as any;
  });

  await assert.rejects(
    storage.put("uploads/asset.png", Buffer.from("image")),
    /storage temporarily unavailable/,
  );
  await storage.put("uploads/asset.png", Buffer.from("image"));
  assert.equal(clientsCreated, 2);
});