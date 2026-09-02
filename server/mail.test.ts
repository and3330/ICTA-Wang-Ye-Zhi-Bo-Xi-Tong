import assert from "node:assert/strict";
import test from "node:test";
import { sendTransactionalMail } from "./mail";

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