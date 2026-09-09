import assert from "node:assert/strict";
import test from "node:test";
import { sendTransactionalMail } from "./mail";
import { sendEmail } from "./gmail";

test("transactional mail requires configuration without exposing values", async () => {
  const oldKey = process.env.RESEND_API_KEY;
  const oldFrom = process.env.EMAIL_FROM_ADDRESS;
  delete process.env.RESEND_API_KEY;
  delete process.env.EMAIL_FROM_ADDRESS;
  try {
    await assert.rejects(
      sendTransactionalMail({ to: "person@example.test", subject: "Hello", html: "<p>Hello</p>" }),
      /not configured/,
    );
  } finally {
    if (oldKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = oldKey;
    if (oldFrom === undefined) delete process.env.EMAIL_FROM_ADDRESS;
    else process.env.EMAIL_FROM_ADDRESS = oldFrom;
  }
});

test("webinar email uses the shared Resend transport", async () => {
  const oldKey = process.env.RESEND_API_KEY;
  const oldFrom = process.env.EMAIL_FROM_ADDRESS;
  const oldFetch = globalThis.fetch;
  process.env.RESEND_API_KEY = "test-resend-key";
  process.env.EMAIL_FROM_ADDRESS = "SellCase <mail@example.test>";
  let request: { url: string; init?: RequestInit } | undefined;
  globalThis.fetch = async (input, init) => {
    request = { url: String(input), init };
    return new Response(null, { status: 200 });
  };
  try {
    assert.equal(await sendEmail({
      to: "lead@example.test",
      subject: "Webinar reminder",
      htmlBody: "<p>Reminder</p>",
    }), true);
    assert.equal(request?.url, "https://api.resend.com/emails");
    assert.deepEqual(JSON.parse(String(request?.init?.body)), {
      from: "SellCase <mail@example.test>",
      to: ["lead@example.test"],
      subject: "Webinar reminder",
      html: "<p>Reminder</p>",
    });
  } finally {
    globalThis.fetch = oldFetch;
    if (oldKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = oldKey;
    if (oldFrom === undefined) delete process.env.EMAIL_FROM_ADDRESS;
    else process.env.EMAIL_FROM_ADDRESS = oldFrom;
  }
});