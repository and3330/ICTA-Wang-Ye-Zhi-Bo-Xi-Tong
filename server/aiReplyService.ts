import { and, eq } from "drizzle-orm";
import {
  aiCreditReservations,
  aiReplyLogs,
  aiResponseArtifacts,
  chatMessages,
  type ChatMessage,
  type Webinar,
} from "@shared/schema";
import {
  aiReplySettingsSchema,
  DEFAULT_AI_FALLBACK,
  type AiReplyLogEntry,
  type AiReplySettings,
  type AiSourceReference,
} from "@shared/aiAssistant";
import { db } from "./db";
import { storage } from "./storage";
import {
  completeTrialAiCall,
  getActiveNoCardTrial,
  refundTrialAiCall,
  reserveTrialAiCall,
} from "./noCardTrial";
import {
  AI_REPLY_MODEL,
  AI_NO_ANSWER_TOKEN,
  type AiProvider,
  requestAiAnswer,
  retrieveAiContext,
} from "./aiAssistant";

export const AI_POINTS_PER_ASSISTANT_REPLY = 1;
export const DEFAULT_OUT_OF_POINTS_MESSAGE =
  "感謝您的提問！目前線上客服忙線中，主辦團隊將盡快親自回覆您 🙏";
export const GENERIC_AI_PROVIDER_ERROR = "AI 暫時無法完成回答，請稍後再試";

export type AiReplyKind = "live" | "test";
export type AiReplyRunResult = {
  answer: string | null;
  status: AiReplyLogEntry["status"];
  sources: AiSourceReference[];
  pointsCharged: number;
  unlimited: boolean;
  logId: string;
  model: string | null;
  chatMessage: ChatMessage | null;
};

export function normalizedAiReplySettings(webinar: Pick<Webinar, "aiSettings">): AiReplySettings {
  const value = webinar.aiSettings || { enabled: false, teacherName: "" };
  return aiReplySettingsSchema.parse({
    enabled: value.enabled ?? false,
    teacherName: value.teacherName ?? "",
    instructions: value.instructions ?? "",
    knowledgeOnly: value.knowledgeOnly ?? true,
    fallbackMessage: value.fallbackMessage ?? "",
    outOfPointsMessage: value.outOfPointsMessage ?? "",
  });
}

async function persistUnchargedReply(input: {
  webinarId: string;
  userId: string | null;
  sessionId: string | null;
  kind: AiReplyKind;
  teacherName: string;
  question: string;
  answer: string | null;
  status: "fallback" | "error" | "no_credits";
  sources?: AiSourceReference[];
  reservationId?: string | null;
  model?: string | null;
  durationMs: number;
  errorMessage?: string | null;
}): Promise<{ logId: string; chatMessage: ChatMessage | null }> {
  return db.transaction(async tx => {
    const [message] = input.sessionId && input.answer
      ? await tx.insert(chatMessages).values({
        webinarId: input.webinarId,
        sessionId: input.sessionId,
        senderName: input.teacherName,
        message: input.answer,
        senderType: "host",
        isPrivate: true,
      }).returning()
      : [];
    const [log] = await tx.insert(aiReplyLogs).values({
      webinarId: input.webinarId,
      userId: input.userId,
      sessionId: input.sessionId,
      reservationId: input.reservationId || null,
      chatMessageId: message?.id || null,
      kind: input.kind,
      question: input.question,
      answer: input.answer,
      status: input.status,
      sources: input.sources || [],
      model: input.model || null,
      durationMs: input.durationMs,
      pointsCharged: 0,
      errorMessage: input.errorMessage || null,
    }).returning({ id: aiReplyLogs.id });
    return { logId: log.id, chatMessage: message || null };
  });
}

async function persistAnsweredReply(input: {
  webinarId: string;
  userId: string;
  sessionId: string | null;
  reservationId: string | null;
  kind: AiReplyKind;
  teacherName: string;
  question: string;
  answer: string;
  status: "answered" | "fallback";
  sources: AiSourceReference[];
  model: string;
  durationMs: number;
  pointsCharged: number;
}): Promise<{ logId: string; chatMessage: ChatMessage | null }> {
  return db.transaction(async tx => {
    if (input.reservationId) {
      const [reservation] = await tx.select({ id: aiCreditReservations.id })
        .from(aiCreditReservations)
        .where(and(
          eq(aiCreditReservations.id, input.reservationId),
          eq(aiCreditReservations.userId, input.userId),
          eq(aiCreditReservations.status, "reserved"),
        ))
        .for("update");
      if (!reservation) throw new Error("AI credit reservation is not active");
    }

    const [message] = input.sessionId
      ? await tx.insert(chatMessages).values({
        webinarId: input.webinarId,
        sessionId: input.sessionId,
        senderName: input.teacherName,
        message: input.answer,
        senderType: "host",
        isPrivate: true,
      }).returning()
      : [];
    const [log] = await tx.insert(aiReplyLogs).values({
      webinarId: input.webinarId,
      userId: input.userId,
      sessionId: input.sessionId,
      reservationId: input.reservationId,
      chatMessageId: message?.id || null,
      kind: input.kind,
      question: input.question,
      answer: input.answer,
      status: input.status,
      sources: input.sources,
      model: input.model,
      durationMs: input.durationMs,
      pointsCharged: input.pointsCharged,
      errorMessage: null,
    }).returning({ id: aiReplyLogs.id });
    await tx.insert(aiResponseArtifacts).values({
      reservationId: input.reservationId,
      userId: input.userId,
      webinarId: input.webinarId,
      kind: input.kind === "live" ? "viewer_chat" : "test_question",
      requestText: input.question,
      responseText: input.answer,
    });
    if (input.reservationId) {
      const consumed = await tx.update(aiCreditReservations)
        .set({ status: "consumed", completedAt: new Date() })
        .where(and(
          eq(aiCreditReservations.id, input.reservationId),
          eq(aiCreditReservations.status, "reserved"),
        ))
        .returning({ id: aiCreditReservations.id });
      if (consumed.length !== 1) throw new Error("AI credit reservation could not be consumed");
    }
    return { logId: log.id, chatMessage: message || null };
  });
}

export async function runAiReply(input: {
  webinarId: string;
  question: string;
  kind: AiReplyKind;
  sessionId?: string | null;
  provider?: AiProvider;
}): Promise<AiReplyRunResult> {
  const startedAt = Date.now();
  const webinar = await storage.getWebinar(input.webinarId);
  if (!webinar) throw new Error("Webinar not found");
  const settings = normalizedAiReplySettings(webinar);
  const teacherName = settings.teacherName || "老師";
  const fallback = settings.fallbackMessage || DEFAULT_AI_FALLBACK;
  const owner = webinar.userId ? await storage.getUser(webinar.userId) : undefined;
  const unlimited = !!owner && (owner.isSuperAdmin || owner.subscriptionPlan === "enterprise");
  const documents = await storage.getWebinarDocuments(input.webinarId);
  const retrieved = retrieveAiContext(documents, input.question);

  // In strict mode, an irrelevant or empty knowledge base is resolved locally.
  // There is no model call and therefore no credit reservation or charge.
  if (settings.knowledgeOnly && !retrieved.context) {
    const persisted = await persistUnchargedReply({
      webinarId: webinar.id,
      userId: webinar.userId || null,
      sessionId: input.sessionId || null,
      kind: input.kind,
      teacherName,
      question: input.question,
      answer: fallback,
      status: "fallback",
      durationMs: Date.now() - startedAt,
    });
    return {
      answer: fallback,
      status: "fallback",
      sources: [],
      pointsCharged: 0,
      unlimited,
      model: null,
      ...persisted,
    };
  }

  let reservationId: string | null = null;
  let trialReservationId: string | null = null;
  if (!unlimited) {
    const activeTrial = webinar.userId && owner?.subscriptionPlan === "free"
      ? await getActiveNoCardTrial(webinar.userId)
      : null;
    const reservation = activeTrial
      ? await reserveTrialAiCall(webinar.userId!)
      : webinar.userId
        ? await storage.reserveAiCredits(webinar.userId, AI_POINTS_PER_ASSISTANT_REPLY)
        : null;
    if (!reservation) {
      const answer = settings.outOfPointsMessage || DEFAULT_OUT_OF_POINTS_MESSAGE;
      const persisted = await persistUnchargedReply({
        webinarId: webinar.id,
        userId: webinar.userId || null,
        sessionId: input.sessionId || null,
        kind: input.kind,
        teacherName,
        question: input.question,
        answer,
        status: "no_credits",
        durationMs: Date.now() - startedAt,
      });
      return {
        answer,
        status: "no_credits",
        sources: [],
        pointsCharged: 0,
        unlimited,
        model: null,
        ...persisted,
      };
    }
    if (activeTrial) trialReservationId = reservation.reservationId;
    else reservationId = reservation.reservationId;
  }

  let generated: { text: string; model: string };
  try {
    generated = await requestAiAnswer({
      webinarTitle: webinar.title,
      settings,
      question: input.question,
      context: retrieved.context,
      provider: input.provider,
    });
    if (!generated.text) throw new Error("Empty AI provider response");
  } catch (error) {
    if (reservationId) {
      try {
        await storage.refundAiCreditReservation(reservationId);
      } catch (refundError) {
        // Still write the provider-failure audit row. The reservation remains
        // recoverable by the existing stale-reservation reconciliation.
        console.error("AI reply credit refund failed:", refundError);
      }
    }
    if (trialReservationId) {
      try {
        await refundTrialAiCall(trialReservationId);
      } catch (refundError) {
        console.error("AI reply trial reservation refund failed:", refundError);
      }
    }
    const persisted = await persistUnchargedReply({
      webinarId: webinar.id,
      userId: webinar.userId || null,
      sessionId: input.sessionId || null,
      kind: input.kind,
      teacherName,
      question: input.question,
      answer: null,
      status: "error",
      sources: retrieved.sources,
      reservationId,
      model: AI_REPLY_MODEL,
      durationMs: Date.now() - startedAt,
      errorMessage: GENERIC_AI_PROVIDER_ERROR,
    });
    return {
      answer: null,
      status: "error",
      sources: retrieved.sources,
      pointsCharged: 0,
      unlimited,
      model: AI_REPLY_MODEL,
      ...persisted,
    };
  }

  const isFallback = generated.text.includes(AI_NO_ANSWER_TOKEN);
  const answer = isFallback ? fallback : generated.text;
  try {
    if (!owner) throw new Error("Webinar owner not found");
    const persisted = await persistAnsweredReply({
      webinarId: webinar.id,
      userId: owner.id,
      sessionId: input.sessionId || null,
      reservationId,
      kind: input.kind,
      teacherName,
      question: input.question,
      answer,
      status: isFallback ? "fallback" : "answered",
      sources: retrieved.sources,
      model: generated.model,
      durationMs: Date.now() - startedAt,
      pointsCharged: unlimited || trialReservationId ? 0 : AI_POINTS_PER_ASSISTANT_REPLY,
    });
    if (trialReservationId && !await completeTrialAiCall(trialReservationId)) {
      throw new Error("Trial AI reservation is not active");
    }
    return {
      answer,
      status: isFallback ? "fallback" : "answered",
      sources: retrieved.sources,
      pointsCharged: unlimited || trialReservationId ? 0 : AI_POINTS_PER_ASSISTANT_REPLY,
      unlimited,
      model: generated.model,
      ...persisted,
    };
  } catch (error) {
    if (reservationId) await storage.refundAiCreditReservation(reservationId);
    if (trialReservationId) await refundTrialAiCall(trialReservationId);
    throw error;
  }
}