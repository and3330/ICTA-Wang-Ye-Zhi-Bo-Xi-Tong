import type { Express, RequestHandler } from "express";
import { and, asc, count, desc, eq, ilike, or, type SQL } from "drizzle-orm";
import { z } from "zod";
import { aiReplyLogs, webinars, type AiReplyLog } from "@shared/schema";
import {
  aiLogReviewSchema,
  aiReplySettingsPatchSchema,
  aiTestQuestionSchema,
  type AiReplyLogEntry,
  type AiReplyLogResponse,
  type AiReplySettingsResponse,
  type AiSourceReference,
  type AiTestReplyResponse,
} from "@shared/aiAssistant";
import { db } from "./db";
import { storage } from "./storage";
import { upsertCorrectionSource } from "./aiKnowledgeStore";
import { GENERIC_AI_PROVIDER_ERROR, normalizedAiReplySettings, runAiReply } from "./aiReplyService";

export const aiReplyLogQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(1_000_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(500).optional(),
  status: z.enum(["answered", "fallback", "error", "no_credits"]).optional(),
  kind: z.enum(["live", "test"]).optional(),
  reviewStatus: z.enum(["unreviewed", "incorrect", "corrected"]).optional(),
  sessionId: z.string().trim().min(1).max(200).optional(),
}).strict();

function sourceReferences(value: unknown): AiSourceReference[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(item => {
    if (!item || typeof item !== "object") return [];
    const reference = item as Record<string, unknown>;
    return typeof reference.id === "string" &&
      typeof reference.title === "string" &&
      typeof reference.excerpt === "string"
      ? [{ id: reference.id, title: reference.title, excerpt: reference.excerpt }]
      : [];
  });
}

export function aiReplyLogEntry(row: AiReplyLog): AiReplyLogEntry {
  return {
    id: row.id,
    webinarId: row.webinarId,
    sessionId: row.sessionId,
    kind: row.kind,
    question: row.question,
    answer: row.answer,
    status: row.status,
    sources: sourceReferences(row.sources),
    model: row.model,
    durationMs: row.durationMs,
    pointsCharged: row.pointsCharged,
    errorMessage: row.errorMessage,
    reviewStatus: row.reviewStatus,
    correctedAnswer: row.correctedAnswer,
    reviewNotes: row.reviewNotes,
    correctionDocumentId: row.correctionDocumentId,
    reviewedAt: row.reviewedAt?.toISOString() || null,
    createdAt: row.createdAt.toISOString(),
  };
}

function firstIssue(error: z.ZodError) {
  return error.issues[0]?.message || "輸入格式不正確";
}

export function registerAiManagementRoutes(app: Express, requireWebinarOwner: RequestHandler) {
  app.get("/api/webinars/:id/ai/settings", requireWebinarOwner, async (req, res) => {
    const [webinar] = await db.select().from(webinars).where(eq(webinars.id, req.params.id as string)).limit(1);
    if (!webinar) return res.status(404).json({ message: "找不到直播間" });
    const response: AiReplySettingsResponse = {
      webinarId: webinar.id,
      webinarTitle: webinar.title,
      settings: normalizedAiReplySettings(webinar),
    };
    res.json(response);
  });

  app.patch("/api/webinars/:id/ai/settings", requireWebinarOwner, async (req, res) => {
    const parsed = aiReplySettingsPatchSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: firstIssue(parsed.error) });
    const [existing] = await db.select().from(webinars).where(eq(webinars.id, req.params.id as string)).limit(1);
    if (!existing) return res.status(404).json({ message: "找不到直播間" });
    const webinar = await storage.updateWebinar(existing.id, { aiSettings: parsed.data } as any);
    if (!webinar) return res.status(404).json({ message: "找不到直播間" });
    const response: AiReplySettingsResponse = {
      webinarId: webinar.id,
      webinarTitle: webinar.title,
      settings: normalizedAiReplySettings(webinar),
    };
    res.json(response);
  });

  app.post("/api/webinars/:id/ai/test-question", requireWebinarOwner, async (req, res) => {
    const parsed = aiTestQuestionSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: firstIssue(parsed.error) });
    try {
      const result = await runAiReply({
        webinarId: req.params.id as string,
        question: parsed.data.question,
        kind: "test",
      });
      const response: AiTestReplyResponse = {
        answer: result.answer || GENERIC_AI_PROVIDER_ERROR,
        status: result.status,
        sources: result.sources,
        pointsCharged: result.pointsCharged,
        unlimited: result.unlimited,
        logId: result.logId,
      };
      res.json(response);
    } catch (error) {
      console.error("AI test question failed:", error);
      res.status(502).json({ message: GENERIC_AI_PROVIDER_ERROR });
    }
  });

  app.get("/api/webinars/:id/ai/logs", requireWebinarOwner, async (req, res) => {
    const parsed = aiReplyLogQuerySchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ message: firstIssue(parsed.error) });
    const query = parsed.data;
    const conditions: SQL[] = [eq(aiReplyLogs.webinarId, req.params.id as string)];
    if (query.status) conditions.push(eq(aiReplyLogs.status, query.status));
    if (query.kind) conditions.push(eq(aiReplyLogs.kind, query.kind));
    if (query.reviewStatus) conditions.push(eq(aiReplyLogs.reviewStatus, query.reviewStatus));
    if (query.sessionId) conditions.push(eq(aiReplyLogs.sessionId, query.sessionId));
    if (query.search) {
      const pattern = `%${query.search.replace(/[\\%_]/g, "\\$&")}%`;
      conditions.push(or(
        ilike(aiReplyLogs.question, pattern),
        ilike(aiReplyLogs.answer, pattern),
        ilike(aiReplyLogs.correctedAnswer, pattern),
      )!);
    }
    const where = and(...conditions);
    const [[totalRow], rows] = await Promise.all([
      db.select({ value: count() }).from(aiReplyLogs).where(where),
      db.select().from(aiReplyLogs)
        .where(where)
        .orderBy(desc(aiReplyLogs.createdAt), asc(aiReplyLogs.id))
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize),
    ]);
    const response: AiReplyLogResponse = {
      items: rows.map(aiReplyLogEntry),
      total: Number(totalRow?.value || 0),
      page: query.page,
      pageSize: query.pageSize,
    };
    res.json(response);
  });

  app.patch("/api/webinars/:id/ai/logs/:logId/review", requireWebinarOwner, async (req, res) => {
    const parsed = aiLogReviewSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: firstIssue(parsed.error) });
    try {
      const updated = await db.transaction(async tx => {
        const [existing] = await tx.select().from(aiReplyLogs).where(and(
          eq(aiReplyLogs.id, req.params.logId as string),
          eq(aiReplyLogs.webinarId, req.params.id as string),
        )).for("update");
        if (!existing) return undefined;

        let correctionDocumentId = existing.correctionDocumentId;
        if (parsed.data.reviewStatus === "corrected" &&
          parsed.data.correctedAnswer &&
          (parsed.data.addToKnowledge || correctionDocumentId)) {
          const document = await upsertCorrectionSource(tx, {
            webinarId: existing.webinarId,
            documentId: correctionDocumentId,
            title: `修正回答：${existing.question.replace(/\s+/g, " ").slice(0, 160)}`,
            content: `問題：${existing.question}\n正確答案：${parsed.data.correctedAnswer}`,
          });
          correctionDocumentId = document.id;
        }

        const [row] = await tx.update(aiReplyLogs).set({
          reviewStatus: parsed.data.reviewStatus,
          correctedAnswer: parsed.data.correctedAnswer || null,
          reviewNotes: parsed.data.notes || null,
          correctionDocumentId,
          reviewedAt: new Date(),
        }).where(and(
          eq(aiReplyLogs.id, existing.id),
          eq(aiReplyLogs.webinarId, existing.webinarId),
        )).returning();
        return row;
      });
      if (!updated) return res.status(404).json({ message: "找不到 AI 回覆記錄" });
      res.json(aiReplyLogEntry(updated));
    } catch (error) {
      const status = typeof (error as { status?: unknown })?.status === "number"
        ? (error as { status: number }).status
        : 400;
      res.status(status).json({ message: error instanceof Error ? error.message : "無法更新審核結果" });
    }
  });
}