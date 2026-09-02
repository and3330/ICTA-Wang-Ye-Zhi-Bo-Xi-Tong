import crypto from "node:crypto";
import type { Request } from "express";
import { and, eq, gt, sql } from "drizzle-orm";
import { db } from "./db";
import { errorEvents } from "@shared/schema";
import { safeErrorText } from "./security";
import { sendTransactionalMail } from "./mail";

export async function persistProductionError(error: unknown, req: Request, statusCode: number): Promise<void> {
  const message = safeErrorText(error);
  const stack = error instanceof Error ? safeErrorText(error.stack, 4000) : null;
  const fingerprint = crypto.createHash("sha256")
    .update(`${req.method}:${req.path}:${message}`)
    .digest("hex");
  const shouldAlert = await db.transaction(async (tx) => {
    // Serialize identical fingerprints so alert throttling also works across instances.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${fingerprint}))`);
    const recent = await tx.select({ id: errorEvents.id }).from(errorEvents).where(and(
      eq(errorEvents.fingerprint, fingerprint),
      gt(errorEvents.createdAt, new Date(Date.now() - 15 * 60 * 1000)),
    )).limit(1);
    await tx.insert(errorEvents).values({
      fingerprint,
      method: req.method,
      path: req.path.slice(0, 500),
      statusCode,
      message,
      stack,
      userId: req.session?.userId ?? null,
    });
    return !recent[0];
  });
  const alertTo = process.env.ERROR_ALERT_EMAIL;
  if (alertTo && shouldAlert && process.env.RESEND_API_KEY && process.env.EMAIL_FROM_ADDRESS) {
    await sendTransactionalMail({
      to: alertTo,
      subject: `Production error: ${req.method} ${req.path.slice(0, 120)}`,
      html: `<p>Status: ${statusCode}</p><p>${escapeHtml(message)}</p><p>Fingerprint: ${fingerprint}</p>`,
    });
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]!);
}