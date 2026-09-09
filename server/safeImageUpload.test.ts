import test from "node:test";
import assert from "node:assert/strict";
import { safeUploadContentType, verifyImageUpload } from "./safeImageUpload";

test("upload verification rejects HTML regardless of claimed client MIME", async () => {
  await assert.rejects(() => verifyImageUpload(Buffer.from("<html><script>alert(1)</script></html>")), /只允許有效/);
});

test("upload verification accepts magic-byte PNG and JPEG and creates opaque safe names", async () => {
  const png = await verifyImageUpload(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"));
  const jpeg = await verifyImageUpload(Buffer.from("/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9oADAMBAAIAAwAAABD/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/EH//xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/EH//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/EH//2Q==", "base64"));
  assert.match(png.filename, /^[a-f0-9]{48}\.png$/);
  assert.match(jpeg.filename, /^[a-f0-9]{48}\.jpg$/);
  assert.equal(safeUploadContentType(png.filename), "image/png");
  assert.equal(safeUploadContentType("evil.svg"), "application/octet-stream");
});