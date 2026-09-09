import { fileTypeFromBuffer } from "file-type";
import crypto from "node:crypto";

const allowed = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/gif", "gif"],
  ["image/webp", "webp"],
  ["image/avif", "avif"],
]);

export async function verifyImageUpload(buffer: Buffer) {
  const detected = await fileTypeFromBuffer(buffer);
  const extension = detected && allowed.get(detected.mime);
  if (!extension) throw new Error("只允許有效的 JPEG、PNG、GIF、WebP 或 AVIF 圖片");
  return {
    mime: detected.mime,
    extension,
    filename: `${crypto.randomBytes(24).toString("hex")}.${extension}`,
  };
}

export function safeUploadContentType(filename: string) {
  const ext = filename.slice(filename.lastIndexOf(".") + 1).toLowerCase();
  const types: Record<string, string> = { jpg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp", avif: "image/avif" };
  return types[ext] || "application/octet-stream";
}