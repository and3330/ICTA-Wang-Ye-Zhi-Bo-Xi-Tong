import test from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import type { IncomingMessage } from "node:http";
import {
  extractHtmlText,
  extractKnowledgeFile,
  fetchWebsiteSnapshotWith,
  isPublicIp,
  readBoundedWebsiteBody,
  validateResolvedAddresses,
  validateWebsiteUrl,
} from "./aiKnowledgeRoutes";

test("SSRF guard rejects private, reserved, and mapped addresses", () => {
  for (const address of [
    "127.0.0.1", "10.1.2.3", "169.254.169.254", "172.20.0.1",
    "192.168.1.1", "100.64.0.1", "192.0.2.1", "::1", "fc00::1",
    "fe80::1", "::ffff:127.0.0.1", "::ffff:7f00:1",
    "240.0.0.1", "255.255.255.255", "2001:10::1",
    "2001:0:ffff::1", "2002::1", "3fff::1",
  ]) {
    assert.equal(isPublicIp(address), false, address);
  }
  assert.equal(isPublicIp("8.8.8.8"), true);
  assert.equal(isPublicIp("2606:4700:4700::1111"), true);
});

const publicDns = async () => [{ address: "93.184.216.34", family: 4 as const }];
const htmlResponse = {
  status: 200,
  headers: { "content-type": "text/html" },
  body: Buffer.from("<p>ok</p>"),
};

test("website deadline rejects DNS that never returns", async () => {
  await assert.rejects(fetchWebsiteSnapshotWith("https://example.com", {
    resolveHost: () => new Promise(() => undefined),
    request: async () => htmlResponse,
  }, 15), /逾時/);
});

test("website deadline is absolute across drip-fed work and redirects", async () => {
  await assert.rejects(fetchWebsiteSnapshotWith("https://example.com", {
    resolveHost: publicDns,
    request: () => new Promise(resolve => setTimeout(() => resolve(htmlResponse), 30)),
  }, 15), /逾時/);

  let requests = 0;
  await assert.rejects(fetchWebsiteSnapshotWith("https://example.com/start", {
    resolveHost: publicDns,
    request: () => new Promise(resolve => setTimeout(() => {
      requests += 1;
      resolve({
        status: 302,
        headers: { location: `/hop-${requests}` },
        body: Buffer.alloc(0),
      });
    }, 15)),
  }, 25), /逾時/);
  assert.equal(requests, 1);
});

test("oversized and aborted response streams reject safely", async () => {
  const oversized = new PassThrough();
  const oversizedResult = readBoundedWebsiteBody(oversized as unknown as IncomingMessage);
  oversized.end(Buffer.alloc(2 * 1024 * 1024 + 1));
  await assert.rejects(oversizedResult, /2 MiB/);

  const aborted = new PassThrough();
  const abortedResult = readBoundedWebsiteBody(aborted as unknown as IncomingMessage);
  aborted.emit("aborted");
  await assert.rejects(abortedResult, /中斷/);
  await new Promise<void>(resolve => setImmediate(() => {
    assert.doesNotThrow(() => aborted.emit("error", new Error("ECONNRESET")));
    aborted.emit("close");
    resolve();
  }));
  assert.equal(aborted.listenerCount("error"), 0);
});

test("website URL guard enforces HTTPS, credentials, and port", () => {
  assert.throws(() => validateWebsiteUrl("http://example.com/page"), /HTTPS/);
  assert.throws(() => validateWebsiteUrl("https://user:pass@example.com/"), /帳號或密碼/);
  assert.throws(() => validateWebsiteUrl("https://example.com:8443/"), /443/);
  assert.throws(() => validateWebsiteUrl("https://127.0.0.1/"), /內部或保留/);
  assert.equal(validateWebsiteUrl("https://example.com/page?q=1").hostname, "example.com");
});

test("all DNS answers must be public to prevent rebinding candidates", () => {
  assert.throws(() => validateResolvedAddresses([
    { address: "93.184.216.34", family: 4 },
    { address: "127.0.0.1", family: 4 },
  ]), /內部、保留或無效/);
  assert.deepEqual(validateResolvedAddresses([
    { address: "93.184.216.34", family: 4 },
  ]), [{ address: "93.184.216.34", family: 4 }]);
});

test("redirect targets are subjected to the same URL validation", () => {
  const current = validateWebsiteUrl("https://example.com/start");
  assert.throws(
    () => validateWebsiteUrl(new URL("https://169.254.169.254/latest", current).toString()),
    /內部或保留/,
  );
  assert.throws(
    () => validateWebsiteUrl(new URL("http://example.net/", current).toString()),
    /HTTPS/,
  );
});

test("HTML extraction excludes active and navigational content", () => {
  const text = extractHtmlText(`
    <html><head><style>.bad{}</style><script>alert(1)</script></head>
    <body><nav>menu</nav><h1>A &amp; B</h1><p>Hello&nbsp;world</p></body></html>
  `);
  assert.equal(text, "A & B\nHello world");
  assert.doesNotMatch(text, /alert|menu|bad/);
});

test("file extraction supports text formats and strips subtitle timing", () => {
  const extracted = extractKnowledgeFile({
    originalname: "lesson.srt",
    buffer: Buffer.from("1\n00:00:01,000 --> 00:00:03,000\n第一句\n1984\n\n2\n00:00:04,000 --> 00:00:06,000\n第二句\n"),
  });
  assert.equal(extracted.title, "lesson");
  assert.equal(extracted.content, "第一句\n1984\n第二句");
  assert.throws(
    () => extractKnowledgeFile({ originalname: "archive.zip", buffer: Buffer.from("x") }),
    /不支援/,
  );
});

test("file extraction fails explicitly instead of truncating", () => {
  assert.throws(
    () => extractKnowledgeFile({
      originalname: "large.txt",
      buffer: Buffer.from("x".repeat(100_001)),
    }),
    /100000 字元上限/,
  );
  assert.throws(
    () => extractKnowledgeFile({ originalname: "binary.txt", buffer: Buffer.from([0xff, 0xfe]) }),
    /UTF-8/,
  );
});