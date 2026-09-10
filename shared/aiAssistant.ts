import { z } from "zod";

export const AI_SOURCE_MAX_CHARS = 100_000;
export const AI_KNOWLEDGE_MAX_CHARS = 2_000_000;
export const AI_KNOWLEDGE_MAX_SOURCES = 100;
export const DEFAULT_AI_FALLBACK = "目前提供的資訊不足以確認答案，請聯繫主辦團隊，我們會協助你。";

export const aiReplySettingsSchema = z.object({
  enabled: z.boolean().default(false),
  teacherName: z.string().trim().max(100).default(""),
  instructions: z.string().trim().max(12_000).default(""),
  knowledgeOnly: z.boolean().default(true),
  fallbackMessage: z.string().trim().max(2_000).default(""),
  outOfPointsMessage: z.string().trim().max(2_000).default(""),
}).strict();
export const aiReplySettingsPatchSchema = aiReplySettingsSchema.partial()
  .refine(value => Object.keys(value).length > 0, "請提供要更新的設定");
export type AiReplySettings = z.infer<typeof aiReplySettingsSchema>;
export type AiReplySettingsResponse = {
  webinarId: string;
  webinarTitle: string;
  settings: AiReplySettings;
};

export const aiKnowledgeInputSchema = z.object({
  title: z.string().trim().min(1).max(200),
  content: z.string().trim().min(1).max(AI_SOURCE_MAX_CHARS),
  sourceType: z.enum(["text", "qa"]).default("text"),
}).strict();
export const aiKnowledgeUpdateSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  content: z.string().trim().min(1).max(AI_SOURCE_MAX_CHARS).optional(),
}).strict().refine(value => value.title !== undefined || value.content !== undefined, "請提供標題或內容");
export type AiSourceType = "text" | "qa" | "file" | "website" | "correction";
export type AiKnowledgeSource = {
  id: string;
  webinarId: string;
  title: string;
  content: string;
  sourceType: AiSourceType;
  sourceUrl: string | null;
  createdAt: string;
  updatedAt: string;
};

export const aiWebsiteInputSchema = z.object({
  url: z.string().trim().url().max(2_048),
  title: z.string().trim().min(1).max(200).optional(),
}).strict();
export const aiTestQuestionSchema = z.object({
  question: z.string().trim().min(1).max(2_000),
}).strict();
export const aiLogReviewSchema = z.object({
  reviewStatus: z.enum(["incorrect", "corrected"]),
  correctedAnswer: z.string().trim().min(1).max(8_000).optional(),
  notes: z.string().trim().max(2_000).optional(),
  addToKnowledge: z.boolean().default(false),
}).strict().superRefine((value, context) => {
  if (value.reviewStatus === "corrected" && !value.correctedAnswer) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["correctedAnswer"], message: "請填寫正確答案" });
  }
  if (value.addToKnowledge && (value.reviewStatus !== "corrected" || !value.correctedAnswer)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["addToKnowledge"], message: "確認正確答案後才能加入知識庫" });
  }
});
export type AiSourceReference = { id: string; title: string; excerpt: string };
export type AiReplyLogEntry = {
  id: string;
  webinarId: string;
  sessionId: string | null;
  kind: "live" | "test";
  question: string;
  answer: string | null;
  status: "answered" | "fallback" | "error" | "no_credits";
  sources: AiSourceReference[];
  model: string | null;
  durationMs: number;
  pointsCharged: number;
  errorMessage: string | null;
  reviewStatus: "unreviewed" | "incorrect" | "corrected";
  correctedAnswer: string | null;
  reviewNotes: string | null;
  correctionDocumentId: string | null;
  reviewedAt: string | null;
  createdAt: string;
};
export type AiReplyLogResponse = {
  items: AiReplyLogEntry[];
  total: number;
  page: number;
  pageSize: number;
};
export type AiTestReplyResponse = {
  answer: string;
  status: AiReplyLogEntry["status"];
  sources: AiSourceReference[];
  pointsCharged: number;
  unlimited: boolean;
  logId: string;
};