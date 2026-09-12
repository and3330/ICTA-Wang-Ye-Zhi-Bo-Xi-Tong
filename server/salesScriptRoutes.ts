import type { Express, RequestHandler } from "express";
import {
  SALES_SCRIPT_COST_POINTS,
  createSalesScriptJobSchema,
  createSalesScriptPurchaseSchema,
  saveSalesScriptDraftSchema,
} from "@shared/salesScript";
import {
  BASIC_SALES_SCRIPT_QUESTION_IDS,
  hasOnlyBasicSalesScriptAnswers,
  pickBasicSalesScriptAnswers,
} from "@shared/salesScriptQuestionnaire";
import { storage } from "./storage";
import { SalesScriptIdempotencyConflictError } from "./storage";
import { wakeSalesScriptWorker } from "./salesScriptGenerator";
import {
  SALES_SCRIPT_QUESTIONNAIRE_GROUPS,
  missingSalesScriptQuestionIds,
} from "./salesScriptQuestionnairePrivate";

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

function purchaseSummary(purchase: Awaited<ReturnType<typeof storage.getSalesScriptPurchaseState>>["purchase"], jobId: string | null) {
  return purchase ? {
    id: purchase.id,
    status: purchase.status,
    ...(jobId ? { jobId } : {}),
  } : null;
}

function hasAllBasicAnswers(answers: Record<string, string>) {
  return BASIC_SALES_SCRIPT_QUESTION_IDS.every((id) => Boolean(answers[id]?.trim()));
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
    res.setHeader("Cache-Control", "private, no-store");
    res.vary("Cookie");
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
    const [credit, draft, jobs, purchaseState] = await Promise.all([
      // Deliberately do not special-case enterprise or administrators: this
      // feature always uses real purchased/granted credit lots.
      storage.getAiCreditSummary(ownerId),
      storage.getSalesScriptDraft(ownerId, webinarId),
      storage.getSalesScriptJobs(ownerId, webinarId),
      storage.getSalesScriptPurchaseState(ownerId, webinarId),
    ]);
    res.json({
      availablePoints: credit.points,
      requiredPoints: SALES_SCRIPT_COST_POINTS,
      // A legacy row can contain confidential answers saved before the paid
      // gate. Preserve it in storage but never disclose it before access.
      draft: draft ? {
        answers: purchaseState.hasPurchasedAccess
          ? draft.answers
          : pickBasicSalesScriptAnswers(draft.answers),
        updatedAt: draft.updatedAt.toISOString(),
      } : null,
      jobs: jobs.map(summary),
      purchase: purchaseSummary(purchaseState.purchase, purchaseState.jobId),
      hasPurchasedAccess: purchaseState.hasPurchasedAccess,
      canGenerate: purchaseState.canGenerate,
    });
  });

  app.put("/api/webinars/:id/sales-script/draft", requireStrictSalesScriptOwner, async (req, res) => {
    try {
      const webinarId = req.params.id as string;
      const ownerId = await ownerForRequest(webinarId);
      if (!ownerId) return res.status(404).json({ message: "Webinar not found" });
      const data = saveSalesScriptDraftSchema.parse(req.body);
      const access = await storage.getSalesScriptPurchaseState(ownerId, webinarId);
      if (!access.hasPurchasedAccess && !hasOnlyBasicSalesScriptAnswers(data.answers)) {
        return res.status(402).json({ message: "請先完成 3600 點購買以填寫保密問卷" });
      }
      // Always merge so an unpaid five-field save cannot erase confidential
      // legacy values which must become visible again after a valid purchase.
      const existing = await storage.getSalesScriptDraft(ownerId, webinarId);
      await storage.saveSalesScriptDraft({
        ownerId, webinarId, answers: { ...(existing?.answers || {}), ...data.answers },
      });
      res.status(204).end();
    } catch {
      res.status(400).json({ message: "草稿欄位格式不正確" });
    }
  });

  app.post("/api/webinars/:id/sales-script/purchase", requireStrictSalesScriptOwner, async (req, res) => {
    try {
      const webinarId = req.params.id as string;
      const ownerId = await ownerForRequest(webinarId);
      if (!ownerId) return res.status(404).json({ message: "Webinar not found" });
      const data = createSalesScriptPurchaseSchema.parse(req.body);
      if (!hasOnlyBasicSalesScriptAnswers(data.answers) || !hasAllBasicAnswers(data.answers)) {
        return res.status(400).json({ message: "請填完五項基本資料後確認 3600 點購買" });
      }
      const basicAnswers = pickBasicSalesScriptAnswers(data.answers);
      const admitted = await storage.purchaseSalesScript({
        ownerId, webinarId, idempotencyKey: data.idempotencyKey, basicAnswers, points: SALES_SCRIPT_COST_POINTS,
      });
      if (!admitted) {
        return res.status(402).json({
          message: `AI 點數不足；完整銷講固定需要 ${SALES_SCRIPT_COST_POINTS} 點`,
          requiredPoints: SALES_SCRIPT_COST_POINTS,
        });
      }
      // Saving purchase-step data is safe and does not create a job or call AI.
      const existing = await storage.getSalesScriptDraft(ownerId, webinarId);
      await storage.saveSalesScriptDraft({ ownerId, webinarId, answers: { ...(existing?.answers || {}), ...basicAnswers } });
      const state = await storage.getSalesScriptPurchaseState(ownerId, webinarId);
      return res.status(202).json({
        purchase: purchaseSummary(state.purchase, state.jobId),
        hasPurchasedAccess: state.hasPurchasedAccess,
        canGenerate: state.canGenerate,
      });
    } catch (error) {
      if (error instanceof SalesScriptIdempotencyConflictError) {
        return res.status(409).json({ message: "Idempotency key 的內容與原始請求不同" });
      }
      return res.status(400).json({ message: "請確認五項基本欄位、3600 點確認與冪等鍵" });
    }
  });

  app.get("/api/webinars/:id/sales-script/questionnaire", requireStrictSalesScriptOwner, async (req, res) => {
    const webinarId = req.params.id as string;
    const ownerId = await ownerForRequest(webinarId);
    if (!ownerId) return res.status(404).json({ message: "Webinar not found" });
    const access = await storage.getSalesScriptPurchaseState(ownerId, webinarId);
    if (!access.hasPurchasedAccess) {
      return res.status(402).json({ message: "請先完成 3600 點購買以讀取保密問卷" });
    }
    res.json({ groups: SALES_SCRIPT_QUESTIONNAIRE_GROUPS });
  });

  app.post("/api/webinars/:id/sales-script/jobs", requireStrictSalesScriptOwner, async (req, res) => {
    try {
      const webinarId = req.params.id as string;
      const ownerId = await ownerForRequest(webinarId);
      if (!ownerId) return res.status(404).json({ message: "Webinar not found" });
      const data = createSalesScriptJobSchema.parse(req.body);
      if (missingSalesScriptQuestionIds(data.answers).length) {
        return res.status(400).json({ message: "請確認所有必填問卷欄位" });
      }
      const admitted = await storage.attachSalesScriptPurchaseToJob({
        ownerId, webinarId, purchaseId: data.purchaseId, idempotencyKey: data.idempotencyKey, answers: data.answers,
      });
      if (!admitted) {
        return res.status(402).json({
          message: "需要有效的已購買資格才能產生；請先完成 3600 點購買",
        });
      }
      const existing = await storage.getSalesScriptDraft(ownerId, webinarId);
      await storage.saveSalesScriptDraft({ ownerId, webinarId, answers: { ...(existing?.answers || {}), ...data.answers } });
      if (admitted.created) wakeSalesScriptWorker();
      return res.status(202).json(summary(admitted.job));
    } catch (error) {
      if (error instanceof SalesScriptIdempotencyConflictError) {
        return res.status(409).json({ message: "Idempotency key 的內容與原始請求不同" });
      }
      const message = error instanceof Error && error.message.includes("Idempotency key")
        ? "Idempotency key 已用於另一場說明會"
        : "請確認必填欄位、購買資格與冪等鍵";
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