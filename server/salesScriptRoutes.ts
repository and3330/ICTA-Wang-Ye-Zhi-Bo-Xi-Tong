import type { Express, RequestHandler } from "express";
import { SALES_SCRIPT_COST_POINTS, createSalesScriptJobSchema, saveSalesScriptDraftSchema } from "@shared/salesScript";
import { storage } from "./storage";
import { SalesScriptIdempotencyConflictError } from "./storage";
import { wakeSalesScriptWorker } from "./salesScriptGenerator";

function summary(job: Awaited<ReturnType<typeof storage.getSalesScriptJobs>>[number]) {
  return {
    id: job.id,
    status: job.status,
    costPoints: job.costPoints,
    completedStages: job.completedStages,
    attemptCount: job.attemptCount,
    errorMessage: job.status === "failed" || job.status === "cancelled" ? job.errorMessage : null,
    createdAt: job.createdAt.toISOString(),
    completedAt: job.completedAt?.toISOString() || null,
  };
}

async function ownerForRequest(webinarId: string) {
  const webinar = await storage.getWebinar(webinarId);
  return webinar?.userId || null;
}

export function registerSalesScriptRoutes(app: Express, requireWebinarOwner: RequestHandler) {
  // The general middleware permits active super-admin support access. This
  // premium debit surface is stricter: an administrator can only charge the
  // credit lots of their own webinar, never an owner's account.
  const requireStrictSalesScriptOwner: RequestHandler = async (req, res, next) => {
    await Promise.resolve(requireWebinarOwner(req, res, async () => {
      const webinar = await storage.getWebinar(req.params.id as string);
      if (!req.session?.userId || !webinar?.userId || webinar.userId !== req.session.userId) {
        res.status(403).json({ message: "Forbidden" });
        return;
      }
      next();
    }));
  };
  app.get("/api/webinars/:id/sales-script", requireStrictSalesScriptOwner, async (req, res) => {
    const webinarId = req.params.id as string;
    const ownerId = await ownerForRequest(webinarId);
    if (!ownerId) return res.status(404).json({ message: "Webinar not found" });
    const [credit, draft, jobs] = await Promise.all([
      // Deliberately do not special-case enterprise or administrators: this
      // feature always uses real purchased/granted credit lots.
      storage.getAiCreditSummary(ownerId),
      storage.getSalesScriptDraft(ownerId, webinarId),
      storage.getSalesScriptJobs(ownerId, webinarId),
    ]);
    res.json({
      availablePoints: credit.points,
      requiredPoints: SALES_SCRIPT_COST_POINTS,
      draft: draft ? { answers: draft.answers, updatedAt: draft.updatedAt.toISOString() } : null,
      jobs: jobs.map(summary),
    });
  });

  app.put("/api/webinars/:id/sales-script/draft", requireStrictSalesScriptOwner, async (req, res) => {
    try {
      const ownerId = await ownerForRequest(req.params.id as string);
      if (!ownerId) return res.status(404).json({ message: "Webinar not found" });
      const data = saveSalesScriptDraftSchema.parse(req.body);
      await storage.saveSalesScriptDraft({ ownerId, webinarId: req.params.id as string, answers: data.answers });
      res.status(204).end();
    } catch {
      res.status(400).json({ message: "草稿欄位格式不正確" });
    }
  });

  app.post("/api/webinars/:id/sales-script/jobs", requireStrictSalesScriptOwner, async (req, res) => {
    try {
      const webinarId = req.params.id as string;
      const ownerId = await ownerForRequest(webinarId);
      if (!ownerId) return res.status(404).json({ message: "Webinar not found" });
      // Check a reused key before validating a changed acknowledgement. The
      // fixed price is server-owned, but a retry with a different body must be
      // a conflict rather than silently returning an unrelated paid job.
      if (typeof req.body?.idempotencyKey === "string") {
        const existing = (await storage.getSalesScriptJobs(ownerId, webinarId))
          .find((job) => job.idempotencyKey === req.body.idempotencyKey);
        if (existing && req.body?.ackCost !== SALES_SCRIPT_COST_POINTS) {
          return res.status(409).json({ message: "Idempotency key 的內容與原始請求不同" });
        }
      }
      const data = createSalesScriptJobSchema.parse(req.body);
      // Saving a draft is allowed to survive a failed admission; the costly
      // reservation and durable job itself are committed in one transaction.
      await storage.saveSalesScriptDraft({ ownerId, webinarId, answers: data.answers });
      const admitted = await storage.admitSalesScriptJob({
        ownerId, webinarId, idempotencyKey: data.idempotencyKey, answers: data.answers,
        points: SALES_SCRIPT_COST_POINTS,
      });
      if (!admitted) {
        return res.status(402).json({
          message: `AI 點數不足；完整銷講生成固定需要 ${SALES_SCRIPT_COST_POINTS} 點`,
          requiredPoints: SALES_SCRIPT_COST_POINTS,
        });
      }
      if (admitted.created) wakeSalesScriptWorker();
      return res.status(202).json(summary(admitted.job));
    } catch (error) {
      if (error instanceof SalesScriptIdempotencyConflictError) {
        return res.status(409).json({ message: "Idempotency key 的內容與原始請求不同" });
      }
      const message = error instanceof Error && error.message.includes("Idempotency key")
        ? "Idempotency key 已用於另一場說明會"
        : "請確認必填欄位、3600 點確認與冪等鍵";
      return res.status(400).json({ message });
    }
  });

  app.get("/api/webinars/:id/sales-script/jobs/:jobId", requireStrictSalesScriptOwner, async (req, res) => {
    const webinarId = req.params.id as string;
    const ownerId = await ownerForRequest(webinarId);
    if (!ownerId) return res.status(404).json({ message: "Webinar not found" });
    const job = await storage.getSalesScriptJob(ownerId, webinarId, req.params.jobId as string);
    if (!job) return res.status(404).json({ message: "Job not found" });
    // Checkpoints are private even to the owner until final output and credit
    // consumption have committed together.
    res.json({
      ...summary(job),
      ...(job.status === "completed" && job.result ? { result: job.result } : {}),
    });
  });
}