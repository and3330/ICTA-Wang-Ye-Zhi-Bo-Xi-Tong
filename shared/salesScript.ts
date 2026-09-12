import { z } from "zod";
import { requiredSalesScriptAnswerIds } from "./salesScriptQuestionnaire";

export const SALES_SCRIPT_COST_POINTS = 3600;
export const salesScriptJobStates = ["queued", "running", "completed", "failed", "cancelled"] as const;
export type SalesScriptJobState = typeof salesScriptJobStates[number];

export const salesScriptAnswersSchema = z.record(z.string().max(12_000))
  .superRefine((answers, context) => {
    for (const id of requiredSalesScriptAnswerIds) {
      if (!answers[id]?.trim()) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: [id], message: "此欄位為必填" });
      }
    }
  });

export const saveSalesScriptDraftSchema = z.object({
  answers: z.record(z.string().max(12_000)),
}).strict();

export const createSalesScriptJobSchema = z.object({
  answers: salesScriptAnswersSchema,
  ackCost: z.literal(SALES_SCRIPT_COST_POINTS),
  idempotencyKey: z.string().trim().min(16).max(160).regex(/^[A-Za-z0-9._:-]+$/),
}).strict();

export const salesScriptSlideSchema = z.object({
  slideTitle: z.string().trim().min(3).max(220),
  purpose: z.string().trim().min(10).max(1_200),
  spokenVerbatim: z.string().trim().min(180).max(16_000),
  interaction: z.string().trim().min(1).max(1_200),
  durationMinutes: z.number().min(0.5).max(15),
  subdivision: z.string().trim().min(3).max(20),
}).strict();

export const salesScriptSectionSchema = z.object({
  sectionNumber: z.number().int().min(1).max(6),
  title: z.string().trim().min(2).max(120),
  durationMinutes: z.number().min(3).max(40),
  slides: z.array(salesScriptSlideSchema).min(1).max(30),
}).strict();
export type SalesScriptSection = z.infer<typeof salesScriptSectionSchema>;

export const salesScriptOutputSchema = z.object({
  language: z.literal("zh-TW"),
  totalDurationMinutes: z.number().min(90).max(120),
  sections: z.array(salesScriptSectionSchema).length(6),
}).strict().superRefine((output, context) => {
  const expectedSlideCounts = [13, 5, 6, 5, 3, 10];
  const durationRanges = [[10, 15], [8, 10], [15, 20], [20, 25], [3, 5], [25, 35]];
  const priorBodies: Array<{ grams: Map<string, number>; count: number }> = [];
  output.sections.forEach((section, index) => {
    if (section.sectionNumber !== index + 1) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["sections", index, "sectionNumber"], message: "段落順序不正確" });
    }
    if (section.slides.length < expectedSlideCounts[index]) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["sections", index, "slides"], message: "投影片內容不足" });
    }
    const [minDuration, maxDuration] = durationRanges[index];
    if (section.durationMinutes < minDuration || section.durationMinutes > maxDuration) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["sections", index, "durationMinutes"], message: "段落時長不符合框架" });
    }
    const slideMinutes = section.slides.reduce((total, slide) => total + slide.durationMinutes, 0);
    if (Math.abs(slideMinutes - section.durationMinutes) > 0.25) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["sections", index, "slides"], message: "投影片時長必須加總為段落時長" });
    }
    section.slides.forEach((slide, slideIndex) => {
      // Use an explicit range rather than Unicode-property regexes so this
      // shared contract remains compatible with the project's ES target.
      const hanChars = slide.spokenVerbatim
        .replace(/【[^】]*】/g, "")
        .match(new RegExp("[\\u3400-\\u4DBF\\u4E00-\\u9FFF\\uF900-\\uFAFF]", "g")) || [];
      const meaningfulBody = hanChars.join("");
      if (meaningfulBody.length < slide.durationMinutes * 180) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["sections", index, "slides", slideIndex, "spokenVerbatim"], message: "逐字稿內容不足以支撐建議時長" });
      }
      // Multiset trigrams tolerate inserted characters and compare across all
      // sections, without rejecting ordinary shared words or brief callbacks.
      const grams = new Map<string, number>();
      for (let offset = 0; offset < meaningfulBody.length - 2; offset += 1) {
        const gram = meaningfulBody.slice(offset, offset + 3);
        grams.set(gram, (grams.get(gram) || 0) + 1);
      }
      const count = Math.max(0, meaningfulBody.length - 2);
      for (const prior of priorBodies) {
        let overlap = 0;
        grams.forEach((amount, gram) => {
          overlap += Math.min(amount, prior.grams.get(gram) || 0);
        });
        if (Math.min(count, prior.count) > 100 && (2 * overlap) / (count + prior.count) > 0.94) {
          context.addIssue({ code: z.ZodIssueCode.custom, path: ["sections", index, "slides", slideIndex, "spokenVerbatim"], message: "逐字稿與其他投影片過於相似，請補充不同內容" });
          break;
        }
      }
      priorBodies.push({ grams, count });
    });
  });
  output.sections.forEach((section, index) => {
    const required = index === 5
      ? Array.from({ length: 10 }, (_, item) => `6-${item + 1}`)
      : Array.from({ length: expectedSlideCounts[index] }, (_, item) => `${index + 1}-${item + 1}`);
    required.forEach((subdivision, item) => {
      if (section.slides[item]?.subdivision !== subdivision) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["sections", index, "slides", item, "subdivision"], message: `缺少或排序錯誤：${subdivision}` });
      }
    }
    );
  });
});
export type SalesScriptOutput = z.infer<typeof salesScriptOutputSchema>;

export type SalesScriptJobSummary = {
  id: string;
  status: SalesScriptJobState;
  costPoints: number;
  completedStages: number;
  attemptCount: number;
  errorMessage: string | null;
  createdAt: string;
  completedAt: string | null;
};

export type SalesScriptStateResponse = {
  availablePoints: number;
  requiredPoints: typeof SALES_SCRIPT_COST_POINTS;
  draft: { answers: Record<string, string>; updatedAt: string } | null;
  jobs: SalesScriptJobSummary[];
};

export type SalesScriptJobResponse = SalesScriptJobSummary & {
  result?: SalesScriptOutput;
};

export const salesScriptApiPaths = {
  state: "/api/webinars/:id/sales-script",
  draft: "/api/webinars/:id/sales-script/draft",
  jobs: "/api/webinars/:id/sales-script/jobs",
  job: "/api/webinars/:id/sales-script/jobs/:jobId",
} as const;