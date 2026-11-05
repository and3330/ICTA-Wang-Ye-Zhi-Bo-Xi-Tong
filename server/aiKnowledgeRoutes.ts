import { splitText, subtitleToTimedText } from "./timedTranscript";
import type { Express, RequestHandler } from "express";
import multer from "multer";
import dns from "node:dns/promises";
import https from "node:https";
import type { IncomingHttpHeaders } from "node:http";
import type { IncomingMessage } from "node:http";
import net from "node:net";
import path from "node:path";
import { pinnedLookup } from "./webhookDelivery";
import {
  AI_KNOWLEDGE_MAX_CHARS,
  AI_SOURCE_MAX_CHARS,
  aiKnowledgeInputSchema,
  aiKnowledgeUpdateSchema,
  aiWebsiteInputSchema,
} from "@shared/aiAssistant";
import {
  AiKnowledgeQuotaError,
  createKnowledgeSource,
  deleteKnowledgeSource,
  getKnowledgeSource,
  listKnowledgeSources,
  updateKnowledgeSource,
} from "./aiKnowledgeStore";

const FILE_MAX_BYTES = 5 * 1024 * 1024;
const WEBSITE_MAX_BYTES = 2 * 1024 * 1024;
const WEBSITE_TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 3;
export const AI_KNOWLEDGE_FILE_FORMATS = ["txt", "md", "srt", "vtt"] as const;

const blockedIpv4 = new net.BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10],
  ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24],
  ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24],
  ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) blockedIpv4.addSubnet(address, prefix, "ipv4");
const blockedIpv6 = new net.BlockList();
for (const [address, prefix] of [
  ["::ffff:0:0", 96], // Never accept an IPv4-mapped spelling as IPv6.
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["3ffe::", 16],
  ["3fff::", 20],
] as const) blockedIpv6.addSubnet(address, prefix, "ipv6");
const globalIpv6 = new net.BlockList();
globalIpv6.addSubnet("2000::", 3, "ipv6");

/** True only for globally routable addresses. Exported for focused SSRF tests. */
export function isPublicIp(address: string): boolean {
  const version = net.isIP(address);
  if (version === 4) return !blockedIpv4.check(address, "ipv4");
  if (version !== 6) return false;
  return globalIpv6.check(address, "ipv6") && !blockedIpv6.check(address, "ipv6");
}

export function validateWebsiteUrl(rawUrl: string): URL {
  const url = new URL(rawUrl);
  if (url.protocol !== "https:") throw new Error("網站來源僅支援 HTTPS");
  if (url.username || url.password) throw new Error("網站網址不得包含帳號或密碼");
  if (url.port && url.port !== "443") throw new Error("網站來源僅允許 HTTPS 443 連接埠");
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (!hostname || hostname.endsWith(".")) throw new Error("網站主機名稱無效");
  if (net.isIP(hostname) && !isPublicIp(hostname)) throw new Error("網站網址不可指向內部或保留網路");
  return url;
}

type ResolvedAddress = { address: string; family: 4 | 6 };
type WebsiteResponse = { status: number; headers: IncomingHttpHeaders; body: Buffer };
export type WebsiteFetchDependencies = {
  resolveHost: (hostname: string, signal: AbortSignal) => Promise<ResolvedAddress[]>;
  request: (url: URL, pinned: ResolvedAddress, timeoutMs: number, signal: AbortSignal) => Promise<WebsiteResponse>;
};

export async function resolvePublicHost(hostname: string, signal?: AbortSignal): Promise<ResolvedAddress[]> {
  if (signal?.aborted) throw new Error("網站讀取逾時");
  const records = await dns.lookup(hostname, { all: true, verbatim: true });
  if (signal?.aborted) throw new Error("網站讀取逾時");
  return validateResolvedAddresses(records.map(record => ({
    address: record.address,
    family: record.family as 4 | 6,
  })));
}

export function validateResolvedAddresses(records: ResolvedAddress[]): ResolvedAddress[] {
  if (!records.length || records.some(record => !isPublicIp(record.address))) {
    throw new Error("網站主機解析到內部、保留或無效網路");
  }
  return records;
}

export function readBoundedWebsiteBody(response: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let length = 0;
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      response.removeListener("data", onData);
      response.removeListener("end", onEnd);
      response.removeListener("aborted", onAborted);
      if (error) reject(error);
      else resolve(Buffer.concat(chunks));
    };
    const onError = (error: Error) => finish(error);
    const onAborted = () => finish(new Error("網站回應在完成前中斷"));
    const onEnd = () => finish();
    // Node can emit ECONNRESET on the tick after "aborted". Keep the error
    // listener through stream close even after this promise has settled.
    const onClose = () => {
      response.removeListener("error", onError);
      response.removeListener("close", onClose);
    };
    const onData = (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      length += buffer.length;
      if (length > WEBSITE_MAX_BYTES) {
        // Error/aborted listeners are installed before destroying the stream.
        const error = new Error("網站回應超過 2 MiB 上限");
        finish(error);
        response.once("error", () => undefined);
        response.destroy(error);
        return;
      }
      chunks.push(buffer);
    };
    response.on("error", onError);
    response.on("aborted", onAborted);
    response.on("close", onClose);
    response.on("data", onData);
    response.on("end", onEnd);
  });
}

export function requestPinned(url: URL, pinned: ResolvedAddress, timeoutMs: number, signal: AbortSignal): Promise<WebsiteResponse> {
  return new Promise((resolve, reject) => {
    const agent = new https.Agent({
      keepAlive: false,
      // Node's automatic family selection requests lookup({ all: true }).
      // Return the appropriate shape while keeping the already-validated IP.
      lookup: pinnedLookup(pinned.address, pinned.family),
    });
    let response: IncomingMessage | undefined;
    let settled = false;
    const request = https.request(url, {
      agent,
      method: "GET",
      servername: net.isIP(url.hostname.replace(/^\[|\]$/g, "")) ? undefined : url.hostname,
      headers: {
        Accept: "text/html,text/plain;q=0.9",
        "Accept-Encoding": "identity",
        "User-Agent": "SellCase-Knowledge-Ingestion/1.0",
      },
    }, incoming => {
      response = incoming;
      void readBoundedWebsiteBody(incoming).then(body => finish(undefined, {
        status: incoming.statusCode ?? 0,
        headers: incoming.headers,
        body,
      }), finish);
    });
    const timer = setTimeout(() => finish(new Error("網站讀取逾時")), Math.max(1, timeoutMs));
    const onAbort = () => finish(new Error("網站讀取逾時"));
    const finish = (error?: Error, result?: WebsiteResponse) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      request.removeAllListeners();
      if (error) {
        response?.destroy();
        request.destroy();
        reject(error);
      } else {
        resolve(result!);
      }
      agent.destroy();
    };
    signal.addEventListener("abort", onAbort, { once: true });
    request.on("error", finish);
    request.end();
  });
}

function remaining(deadline: number) {
  const value = deadline - Date.now();
  if (value <= 0) throw new Error("網站讀取逾時");
  return value;
}

function beforeDeadline<T>(operation: Promise<T>, deadline: number): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error("網站讀取逾時"));
      }
    }, Math.max(1, remaining(deadline)));
    operation.then(value => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    }, error => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
  });
}

function decodeEntities(input: string) {
  const named: Record<string, string> = {
    amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " ",
    copy: "©", reg: "®", ndash: "–", mdash: "—", hellip: "…",
  };
  return input.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (whole, entity: string) => {
    if (entity[0] === "#") {
      const hex = entity[1]?.toLowerCase() === "x";
      const value = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isSafeInteger(value) && value > 0 && value <= 0x10ffff
        ? String.fromCodePoint(value) : whole;
    }
    return named[entity.toLowerCase()] ?? whole;
  });
}

export function extractHtmlText(html: string): string {
  const cleaned = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|nav|noscript|svg|canvas|iframe|form|footer|header)\b[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr)\s*>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  return decodeEntities(cleaned).replace(/\r/g, "").replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

export async function fetchWebsiteSnapshotWith(
  rawUrl: string,
  dependencies: WebsiteFetchDependencies,
  timeoutMs = WEBSITE_TIMEOUT_MS,
): Promise<{ url: string; content: string; pageTitle?: string }> {
  const deadline = Date.now() + timeoutMs;
  const controller = new AbortController();
  const deadlineTimer = setTimeout(() => controller.abort(), Math.max(1, timeoutMs));
  let url = validateWebsiteUrl(rawUrl);
  try {
    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
      // Every hop gets a fresh complete DNS validation. The socket lookup is then
      // pinned to that validated address, preventing a second/rebinding lookup.
      const addresses = validateResolvedAddresses(await beforeDeadline(
        dependencies.resolveHost(url.hostname.replace(/^\[|\]$/g, ""), controller.signal),
        deadline,
      ));
      const response = await beforeDeadline(
        dependencies.request(url, addresses[0], remaining(deadline), controller.signal),
        deadline,
      );
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        if (redirects === MAX_REDIRECTS) throw new Error("網站重新導向次數超過上限");
        const location = response.headers.location;
        if (!location) throw new Error("網站重新導向缺少目標網址");
        url = validateWebsiteUrl(new URL(location, url).toString());
        continue;
      }
      if (response.status < 200 || response.status >= 300) throw new Error(`網站回應 HTTP ${response.status}`);
      if (response.headers["content-encoding"] && response.headers["content-encoding"] !== "identity") {
        throw new Error("網站回應使用不支援的壓縮格式");
      }
      const contentType = String(response.headers["content-type"] ?? "").toLowerCase();
      if (!contentType.startsWith("text/html") && !contentType.startsWith("text/plain")) {
        throw new Error("網站來源僅支援 HTML 或純文字頁面");
      }
      const raw = new TextDecoder("utf-8", { fatal: true }).decode(response.body);
      const content = contentType.startsWith("text/html") ? extractHtmlText(raw) : raw.trim();
      if (!content) throw new Error("網站頁面沒有可擷取的文字內容");
      if (content.length > AI_SOURCE_MAX_CHARS) throw new Error(`網站文字超過 ${AI_SOURCE_MAX_CHARS} 字元上限`);
      const titleMatch = contentType.startsWith("text/html") ? raw.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i) : undefined;
      return {
        url: url.toString(),
        content,
        pageTitle: titleMatch ? decodeEntities(titleMatch[1].replace(/<[^>]+>/g, " ")).trim().slice(0, 200) : undefined,
      };
    }
    throw new Error("無法讀取網站");
  } finally {
    clearTimeout(deadlineTimer);
    controller.abort();
  }
}

export function fetchWebsiteSnapshot(rawUrl: string): Promise<{ url: string; content: string; pageTitle?: string }> {
  return fetchWebsiteSnapshotWith(rawUrl, {
    resolveHost: resolvePublicHost,
    request: requestPinned,
  });
}

export function extractKnowledgeFile(file: { originalname: string; buffer: Buffer }): { title: string; content: string; parts: string[] } {
  const extension = path.extname(file.originalname).toLowerCase().slice(1);
  if (!AI_KNOWLEDGE_FILE_FORMATS.includes(extension as typeof AI_KNOWLEDGE_FILE_FORMATS[number])) {
    throw new Error(`不支援的檔案格式；請使用 ${AI_KNOWLEDGE_FILE_FORMATS.join(", ").toUpperCase()}`);
  }
  let content: string;
  try {
    content = new TextDecoder("utf-8", { fatal: true }).decode(file.buffer).replace(/^\uFEFF/, "");
  } catch {
    throw new Error("檔案不是有效的 UTF-8 文字");
  }
  if (extension === "srt" || extension === "vtt") {
    // Keep each cue's start time ("[12:34] words") so interaction generation
    // can place items where the speaker actually says them.
    content = subtitleToTimedText(content);
  }
  content = content.replace(/\r/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!content) throw new Error("檔案沒有可擷取的文字內容");
  if (content.length > AI_KNOWLEDGE_MAX_CHARS) {
    throw new Error(`檔案文字超過知識庫總上限 ${AI_KNOWLEDGE_MAX_CHARS} 字元`);
  }
  // A long transcript is stored as several numbered entries instead of being refused.
  const parts = splitText(content, AI_SOURCE_MAX_CHARS);
  const base = path.basename(file.originalname, path.extname(file.originalname)).trim();
  return { title: (base || "上傳檔案").slice(0, 200), content, parts };
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: FILE_MAX_BYTES, files: 1, fields: 1 },
});
const receiveFile: RequestHandler = (req, res, next) => {
  upload.single("file")(req, res, error => {
    if (error) res.status(400).json({ message: message(error) });
    else next();
  });
};

function message(error: unknown): string {
  if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") return "檔案不得超過 5 MiB";
  if (error instanceof Error) return error.message;
  return "知識來源處理失敗";
}

function status(error: unknown) {
  return error instanceof AiKnowledgeQuotaError ? error.status : 400;
}

export function registerAiKnowledgeRoutes(app: Express, requireWebinarOwner: RequestHandler) {
  app.get("/api/webinars/:id/documents", requireWebinarOwner, async (req, res) => {
    res.json(await listKnowledgeSources(req.params.id as string));
  });

  app.post("/api/webinars/:id/documents", requireWebinarOwner, async (req, res) => {
    try {
      const input = aiKnowledgeInputSchema.parse(req.body);
      res.status(201).json(await createKnowledgeSource({ webinarId: req.params.id as string, ...input, sourceUrl: null }));
    } catch (error) {
      res.status(status(error)).json({ message: message(error) });
    }
  });

  app.patch("/api/webinars/:id/documents/:docId", requireWebinarOwner, async (req, res) => {
    try {
      const patch = aiKnowledgeUpdateSchema.parse(req.body);
      const document = await updateKnowledgeSource(req.params.id as string, req.params.docId as string, patch);
      if (!document) return res.status(404).json({ message: "找不到知識來源" });
      res.json(document);
    } catch (error) {
      res.status(status(error)).json({ message: message(error) });
    }
  });

  app.delete("/api/webinars/:id/documents/:docId", requireWebinarOwner, async (req, res) => {
    if (!await deleteKnowledgeSource(req.params.id as string, req.params.docId as string)) {
      return res.status(404).json({ message: "找不到知識來源" });
    }
    res.status(204).end();
  });

  app.post("/api/webinars/:id/ai/sources/website", requireWebinarOwner, async (req, res) => {
    try {
      const input = aiWebsiteInputSchema.parse(req.body);
      const snapshot = await fetchWebsiteSnapshot(input.url);
      res.status(201).json(await createKnowledgeSource({
        webinarId: req.params.id as string,
        title: (input.title ?? snapshot.pageTitle ?? new URL(snapshot.url).hostname).slice(0, 200),
        content: snapshot.content,
        sourceType: "website",
        sourceUrl: snapshot.url,
      }));
    } catch (error) {
      res.status(status(error)).json({ message: message(error) });
    }
  });

  app.post("/api/webinars/:id/ai/sources/file", requireWebinarOwner, receiveFile, async (req, res) => {
    try {
      if (!req.file) throw new Error("請上傳 file 欄位");
      const extracted = extractKnowledgeFile(req.file);
      const suppliedTitle = typeof req.body.title === "string" ? req.body.title.trim() : "";
      if (suppliedTitle.length > 190) throw new Error("標題不得超過 190 字元");
      const baseTitle = suppliedTitle || extracted.title.slice(0, 190);
      const webinarId = req.params.id as string;
      const created = [];
      try {
        for (let index = 0; index < extracted.parts.length; index += 1) {
          const content = extracted.parts[index];
          created.push(await createKnowledgeSource({
            webinarId,
            title: extracted.parts.length > 1 ? `${baseTitle}（${index + 1}/${extracted.parts.length}）` : baseTitle,
            content,
            sourceType: "file",
            sourceUrl: null,
          }));
        }
      } catch (error) {
        // All parts or none: a half-stored transcript would mislead the assistant.
        for (const source of created) await deleteKnowledgeSource(webinarId, source.id).catch(() => {});
        throw error;
      }
      res.status(201).json({ ...created[0], splitInto: created.length });
    } catch (error) {
      res.status(status(error)).json({ message: message(error) });
    }
  });

  app.post("/api/webinars/:id/ai/sources/:docId/refresh", requireWebinarOwner, async (req, res) => {
    try {
      const webinarId = req.params.id as string;
      const document = await getKnowledgeSource(webinarId, req.params.docId as string);
      if (!document || document.sourceType !== "website" || !document.sourceUrl) {
        return res.status(404).json({ message: "找不到可重新擷取的網站來源" });
      }
      const snapshot = await fetchWebsiteSnapshot(document.sourceUrl);
      const updated = await updateKnowledgeSource(webinarId, document.id, { content: snapshot.content });
      if (!updated) return res.status(404).json({ message: "網站來源已不存在" });
      res.json(updated);
    } catch (error) {
      // Fetch completes before the update, so failures preserve the old snapshot.
      res.status(status(error)).json({ message: message(error) });
    }
  });
}