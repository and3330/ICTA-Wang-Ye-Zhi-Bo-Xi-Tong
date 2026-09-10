import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, integer, boolean, jsonb, real, numeric, uniqueIndex, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import type { WebinarLandingBlock as WebinarLandingBlockType } from "./webinarLanding";
export {
  canonicalLandingVideoSchema,
  canonicalizeLandingVideoUrl,
  landingVideoProviderSchema,
  parseLandingVideoUrl,
} from "./webinarLanding";
export type {
  CanonicalLandingVideo,
  LandingVideoProvider,
  WebinarLandingBlock,
  WebinarLandingRichNode,
} from "./webinarLanding";

// Webinars (直播間) - 擴展版
export const webinars = pgTable("webinars", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id"),
  title: text("title").notNull(),
  description: text("description"),
  vimeoUrl: text("vimeo_url").notNull(),
  coverImage: text("cover_image"),
  startTime: timestamp("start_time").notNull(),
  status: text("status").notNull().default("scheduled"), // scheduled, live, ended
  publishStatus: text("publish_status").notNull().default("draft"), // draft, published
  videoDuration: integer("video_duration").default(0), // in seconds
  
  // 排程模式設定
  scheduleMode: jsonb("schedule_mode").$type<{
    recurring: boolean;      // 循環排程
    onDemand: boolean;       // 隨選觀看
    justInTime: boolean;     // 即時開始（幾分鐘內開始）
    justInTimeMinutes: number; // 即時開始的分鐘數
  }>().default({ recurring: false, onDemand: false, justInTime: false, justInTimeMinutes: 15 }),
  
  // 循環排程設定
  recurringSchedule: jsonb("recurring_schedule").$type<{
    enabled: boolean;
    days: number[];           // 0-6 (週日-週六)
    times: string[];          // ["09:00", "14:00", "19:00"]
    excludeDates: string[];   // 排除的日期
  }>(),
  
  // 時區設定
  timezone: text("timezone").default("Asia/Taipei"),
  
  // 品牌設定
  brandSettings: jsonb("brand_settings").$type<{
    logo: string;
    watermark: string;
    primaryColor: string;
    secondaryColor: string;
    backgroundColor: string;
  }>(),
  
  // AI 助教設定
  aiSettings: jsonb("ai_settings").$type<{
    enabled: boolean;        // 是否啟用 AI 自動回覆
    teacherName: string;     // 回覆時顯示的老師名稱
    fallbackMessage?: string; // 答不出來時的自訂回覆（空 = 用預設行為）
    outOfPointsMessage?: string; // AI 點數用完時顯示給觀眾的訊息（空 = 用預設）
  }>().default({ enabled: false, teacherName: "" }),

  // 報名表單自訂欄位
  customFields: jsonb("custom_fields").$type<Array<{
    id: string;
    label: string;
    type: "text" | "textarea" | "select" | "checkbox";
    required: boolean;
    options?: string[]; // for select
  }>>().default([]),

  // 稀缺感 / 倒數設定
  scarcitySettings: jsonb("scarcity_settings").$type<{
    countdownEnabled: boolean; // 報名頁顯示距開始倒數
    seatsEnabled: boolean;     // 顯示名額有限
    totalSeats: number;        // 總名額
    urgencyText: string;       // 自訂催促文字
  }>().default({ countdownEnabled: false, seatsEnabled: false, totalSeats: 100, urgencyText: "" }),

  // 感謝頁（報名完成）自訂
  thankYouSettings: jsonb("thank_you_settings").$type<{
    enabled: boolean;
    headline: string;
    message: string;
    ctaText: string;
    ctaUrl: string;
  }>().default({ enabled: false, headline: "", message: "", ctaText: "", ctaUrl: "" }),

  // 重播 / 結束頁自訂
  replaySettings: jsonb("replay_settings").$type<{
    headline: string;
    message: string;
    ctaText: string;
    ctaUrl: string;
  }>().default({ headline: "", message: "", ctaText: "", ctaUrl: "" }),

  // 通知設定（有人發問時通知主持人）
  notifySettings: jsonb("notify_settings").$type<{
    questionEmailEnabled: boolean;
    notifyEmail: string; // 留空則寄給帳號 Email
  }>().default({ questionEmailEnabled: false, notifyEmail: "" }),

  // 重播設定
  replayEnabled: boolean("replay_enabled").default(true),
  replayAvailableHours: integer("replay_available_hours").default(48), // 重播可用時數
  
  // Email 設定
  emailSettings: jsonb("email_settings").$type<{
    confirmationEnabled: boolean;
    reminder24hEnabled: boolean;
    reminder1hEnabled: boolean;
    followUpEnabled: boolean;
    customSubject: string;
    customTemplate: string;
  }>().default({
    confirmationEnabled: true,
    reminder24hEnabled: true,
    reminder1hEnabled: true,
    followUpEnabled: true,
    customSubject: "",
    customTemplate: ""
  }),

  // Safe identifiers only; executable tracking snippets are never stored.
  metaPixelId: varchar("meta_pixel_id", { length: 32 }),
  gtmContainerId: varchar("gtm_container_id", { length: 24 }),
  
  createdAt: timestamp("created_at").defaultNow(),
  deletedAt: timestamp("deleted_at"),
});

const emptyTrackingIdToNull = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? null : typeof value === "string" ? value.trim() : value;

export const metaPixelIdSchema = z.preprocess(
  emptyTrackingIdToNull,
  z.union([z.null(), z.string().min(5).max(32).regex(/^\d+$/, "Meta Pixel ID must contain digits only")]),
);
export const gtmContainerIdSchema = z.preprocess(
  emptyTrackingIdToNull,
  z.union([z.null(), z.string().min(8).max(24).regex(/^GTM-[A-Z0-9]+$/, "GTM Container ID must be GTM- followed by uppercase letters or digits")]),
);
export const webinarTrackingSettingsSchema = z.object({
  metaPixelId: metaPixelIdSchema.optional(),
  gtmContainerId: gtmContainerIdSchema.optional(),
}).strict();

export const insertWebinarSchema = createInsertSchema(webinars).omit({ id: true, createdAt: true, deletedAt: true }).extend({
  startTime: z.coerce.date(),
  metaPixelId: metaPixelIdSchema.optional(),
  gtmContainerId: gtmContainerIdSchema.optional(),
});
export type InsertWebinar = z.infer<typeof insertWebinarSchema>;
export type Webinar = typeof webinars.$inferSelect;

// Registrations (報名) - 擴展版
export const registrations = pgTable("registrations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  webinarId: varchar("webinar_id").notNull().references(() => webinars.id),
  name: text("name").notNull(),
  phone: text("phone").default(""),
  email: text("email").notNull(),
  nickname: text("nickname"),
  registeredAt: timestamp("registered_at").defaultNow(),
  
  // 出席追蹤
  attended: boolean("attended").default(false),
  attendedAt: timestamp("attended_at"),
  leftAt: timestamp("left_at"),
  watchDuration: integer("watch_duration").default(0), // 觀看秒數
  
  // 觀眾時區
  viewerTimezone: text("viewer_timezone"),
  
  // 來源追蹤
  source: text("source"),
  utmSource: text("utm_source"),
  utmMedium: text("utm_medium"),
  utmCampaign: text("utm_campaign"),
  utmTerm: text("utm_term"),
  utmContent: text("utm_content"),
  landingUrl: text("landing_url"),
  
  // 選擇的場次（用於循環排程）
  selectedSession: timestamp("selected_session"),

  // 報名表單自訂欄位回答
  customFieldData: jsonb("custom_field_data").$type<Record<string, string>>().default({}),

  // 報名者標籤 / 分群
  tags: text("tags").array().default(sql`'{}'::text[]`),
});

export const registrationIdentityKeys = pgTable("registration_identity_keys", {
  webinarId: varchar("webinar_id").notNull().references(() => webinars.id),
  normalizedEmail: text("normalized_email").notNull(),
  registrationId: varchar("registration_id").references(() => registrations.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  identityUnique: uniqueIndex("registration_identity_keys_uniq").on(table.webinarId, table.normalizedEmail),
}));

export const insertRegistrationSchema = createInsertSchema(registrations).omit({ 
  id: true, registeredAt: true, attended: true, attendedAt: true, leftAt: true, watchDuration: true 
}).extend({
  viewerTimezone: z.string().trim().min(1).max(100).refine((value) => {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
      return true;
    } catch {
      return false;
    }
  }, "viewerTimezone must be a valid IANA timezone").optional().nullable(),
});
export type InsertRegistration = z.infer<typeof insertRegistrationSchema>;
export type Registration = typeof registrations.$inferSelect;
// Opaque analytics correlation token. It is never persisted raw.
export const analyticsVisitorTokenSchema = z.string().min(16).max(256).regex(/^[A-Za-z0-9_-]+$/);

// Fake Users / Bots (假人)
export const fakeUsers = pgTable("fake_users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  webinarId: varchar("webinar_id").notNull().references(() => webinars.id),
  name: text("name").notNull(),
  avatar: text("avatar"),
});

export const insertFakeUserSchema = createInsertSchema(fakeUsers).omit({ id: true });
export type InsertFakeUser = z.infer<typeof insertFakeUserSchema>;
export type FakeUser = typeof fakeUsers.$inferSelect;

// Scheduled Messages (預排訊息)
export const scheduledMessages = pgTable("scheduled_messages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  webinarId: varchar("webinar_id").notNull().references(() => webinars.id),
  fakeUserId: varchar("fake_user_id").references(() => fakeUsers.id),
  message: text("message").notNull(),
  triggerTime: integer("trigger_time").notNull(), // seconds from video start
  messageType: text("message_type").notNull().default("chat"), // chat, like, reaction
});

export const insertScheduledMessageSchema = createInsertSchema(scheduledMessages).omit({ id: true });
export type InsertScheduledMessage = z.infer<typeof insertScheduledMessageSchema>;
export type ScheduledMessage = typeof scheduledMessages.$inferSelect;

export const webinarOffers = pgTable("webinar_offers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id, { onDelete: "restrict" }),
  webinarId: varchar("webinar_id").references(() => webinars.id, { onDelete: "set null" }),
  paymentProvider: text("payment_provider").notNull().default("stripe"),
  stripeProductId: text("stripe_product_id"),
  stripePriceId: text("stripe_price_id"),
  ecpayItemName: text("ecpay_item_name"),
  ecpayAmountTwd: integer("ecpay_amount_twd"),
  checkoutMode: text("checkout_mode").notNull().default("payment"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  userIndex: index("webinar_offers_user_idx").on(table.userId),
  webinarIndex: index("webinar_offers_webinar_idx").on(table.webinarId),
}));

export const offerSalesPages = pgTable("offer_sales_pages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id, { onDelete: "restrict" }),
  webinarId: varchar("webinar_id").references(() => webinars.id, { onDelete: "set null" }),
  offerId: varchar("offer_id").notNull().references(() => webinarOffers.id, { onDelete: "restrict" }),
  slug: varchar("slug", { length: 80 }).notNull().unique(),
  title: varchar("title", { length: 200 }).notNull(),
  status: text("status").$type<"draft" | "published">().notNull().default("draft"),
  orderedBlocks: jsonb("ordered_blocks").$type<unknown[]>().notNull().default([]),
  publishedOrderedBlocks: jsonb("published_ordered_blocks").$type<unknown[]>(),
  publishedCheckoutSettings: jsonb("published_checkout_settings").$type<{
    transitionTitle: string; transitionMessage: string; successTitle: string; successMessage: string;
    successButtonLabel: string; successButtonUrl?: string; cancelTitle: string; cancelMessage: string;
  }>(),
  checkoutSettings: jsonb("checkout_settings").$type<{
    transitionTitle: string; transitionMessage: string; successTitle: string; successMessage: string;
    successButtonLabel: string; successButtonUrl?: string; cancelTitle: string; cancelMessage: string;
  }>().notNull().default({
    transitionTitle: "正在前往安全付款頁面", transitionMessage: "請稍候，我們正在準備您的付款。",
    successTitle: "付款成功，謝謝您的支持！", successMessage: "您的購買已確認。",
    successButtonLabel: "前往內容", cancelTitle: "付款尚未完成", cancelMessage: "您可以返回優惠頁，再試一次。",
  }),
  version: integer("version").notNull().default(1),
  publishedAt: timestamp("published_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  deletedAt: timestamp("deleted_at"),
}, (table) => ({
  offerUnique: uniqueIndex("offer_sales_pages_offer_uniq").on(table.offerId).where(sql`deleted_at IS NULL`),
  userIndex: index("offer_sales_pages_user_idx").on(table.userId),
  webinarIndex: index("offer_sales_pages_webinar_idx").on(table.webinarId),
}));
export type OfferSalesPage = typeof offerSalesPages.$inferSelect;
export type InsertOfferSalesPage = typeof offerSalesPages.$inferInsert;

// Safe, data-only webinar registration landing page. Rendering is performed by
// the client; this table intentionally stores no HTML, CSS, or JavaScript.
export const webinarLandingPages = pgTable("webinar_landing_pages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  webinarId: varchar("webinar_id").notNull().references(() => webinars.id, { onDelete: "cascade" }).unique(),
  title: text("title").notNull(),
  blocks: jsonb("blocks").$type<WebinarLandingBlockType[]>().notNull().default([]),
  brandSettings: jsonb("brand_settings").$type<{ primaryColor: string; secondaryColor: string; backgroundColor: string }>().notNull().default({ primaryColor: "#0f766e", secondaryColor: "#f59e0b", backgroundColor: "#ffffff" }),
  // Public visitors read only this immutable-at-save snapshot. Draft edits never
  // change the live page until the owner explicitly publishes again.
  publishedTitle: text("published_title"),
  publishedBlocks: jsonb("published_blocks").$type<WebinarLandingBlockType[]>(),
  publishedBrandSettings: jsonb("published_brand_settings").$type<{ primaryColor: string; secondaryColor: string; backgroundColor: string }>(),
  status: text("status").$type<"draft" | "published">().notNull().default("draft"),
  version: integer("version").notNull().default(1),
  publishedAt: timestamp("published_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  webinarIndex: index("webinar_landing_pages_webinar_idx").on(table.webinarId),
}));
export type WebinarLandingPage = typeof webinarLandingPages.$inferSelect;
export type InsertWebinarLandingPage = typeof webinarLandingPages.$inferInsert;

export const ctaButtons = pgTable("cta_buttons", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  webinarId: varchar("webinar_id").notNull().references(() => webinars.id),
  text: text("text").notNull(),
  url: text("url"),
  offerId: varchar("offer_id").references(() => webinarOffers.id, { onDelete: "restrict" }),
  salesPageId: varchar("sales_page_id").references(() => offerSalesPages.id, { onDelete: "restrict" }),
  startTime: integer("start_time").notNull(), // seconds when to show
  endTime: integer("end_time"), // seconds when to hide (null = until end)
  style: text("style").default("primary"), // primary, secondary, danger
  liveOnly: boolean("live_only").notNull().default(false),
  expiresAt: timestamp("expires_at"),
  ctaKey: varchar("cta_key", { length: 64 }).notNull().unique(), // server-generated stable tracking key
  archivedAt: timestamp("archived_at"),
}, (table) => ({
  liveExpiryIndex: index("cta_buttons_live_expiry_idx").on(table.webinarId, table.expiresAt)
    .where(sql`live_only = true`),
}));

export const safeCtaUrlSchema = z.string().trim().min(1).max(2048).refine((value) => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}, "CTA URL must be an absolute HTTP or HTTPS URL");
export const insertCtaButtonSchema = createInsertSchema(ctaButtons)
  .omit({ id: true, ctaKey: true, archivedAt: true, liveOnly: true, expiresAt: true })
  .extend({
    url: safeCtaUrlSchema.nullish(),
    offerId: z.string().uuid().nullish(),
    salesPageId: z.string().uuid().nullish(),
  })
  .superRefine((value, context) => {
    const targets = [value.url, value.offerId, value.salesPageId].filter(Boolean);
    if (targets.length !== 1) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["url"],
        message: "CTA must specify exactly one of url, offerId, or salesPageId",
      });
    }
  });
export type InsertCtaButton = z.infer<typeof insertCtaButtonSchema>;
export type CtaButton = typeof ctaButtons.$inferSelect;

// Tips (議程提示)
export const tips = pgTable("tips", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  webinarId: varchar("webinar_id").notNull().references(() => webinars.id),
  title: text("title").notNull(),
  content: text("content"),
  triggerTime: integer("trigger_time").notNull(), // seconds from video start
  duration: integer("duration").default(10), // how long to show (seconds)
  icon: text("icon").default("info"), // info, tip, warning, agenda
});

export const insertTipSchema = createInsertSchema(tips).omit({ id: true });
export type InsertTip = z.infer<typeof insertTipSchema>;
export type Tip = typeof tips.$inferSelect;

// Polls (投票)
export const polls = pgTable("polls", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  webinarId: varchar("webinar_id").notNull().references(() => webinars.id),
  question: text("question").notNull(),
  options: jsonb("options").notNull().$type<string[]>(),
  triggerTime: integer("trigger_time").notNull(), // seconds from video start
  duration: integer("duration").default(60), // how long poll stays open (seconds)
});

export const insertPollSchema = createInsertSchema(polls).omit({ id: true });
export type InsertPoll = z.infer<typeof insertPollSchema>;
export type Poll = typeof polls.$inferSelect;

// Poll Votes (投票記錄)
export const pollVotes = pgTable("poll_votes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  pollId: varchar("poll_id").notNull().references(() => polls.id),
  participantId: text("participant_id").notNull(), // could be registration id or session id
  optionIndex: integer("option_index").notNull(),
  votedAt: timestamp("voted_at").defaultNow(),
});

export const insertPollVoteSchema = createInsertSchema(pollVotes).omit({ id: true, votedAt: true });
export type InsertPollVote = z.infer<typeof insertPollVoteSchema>;
export type PollVote = typeof pollVotes.$inferSelect;

// Questions (Q&A 問答)
export const questions = pgTable("questions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  webinarId: varchar("webinar_id").notNull().references(() => webinars.id),
  registrationId: varchar("registration_id").references(() => registrations.id),
  askerName: text("asker_name").notNull(),
  askerEmail: text("asker_email"),
  question: text("question").notNull(),
  answer: text("answer"),
  answeredBy: text("answered_by"),
  answeredAt: timestamp("answered_at"),
  isPreset: boolean("is_preset").default(false), // 預設 FAQ
  displayOrder: integer("display_order").default(0),
  askedAt: timestamp("asked_at").defaultNow(),
  isPublic: boolean("is_public").default(true), // 是否公開顯示
});

export const insertQuestionSchema = createInsertSchema(questions).omit({ 
  id: true, askedAt: true, answeredAt: true 
});
export type InsertQuestion = z.infer<typeof insertQuestionSchema>;
export type Question = typeof questions.$inferSelect;

// Feedback Surveys (結束問卷)
export const feedbackSurveys = pgTable("feedback_surveys", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  webinarId: varchar("webinar_id").notNull().references(() => webinars.id),
  title: text("title").notNull().default("請給我們回饋"),
  questions: jsonb("questions").$type<{
    id: string;
    type: "rating" | "text" | "multiChoice";
    question: string;
    options?: string[];
    required: boolean;
  }[]>().default([]),
  isActive: boolean("is_active").default(true),
});

export const insertFeedbackSurveySchema = createInsertSchema(feedbackSurveys).omit({ id: true });
export type InsertFeedbackSurvey = z.infer<typeof insertFeedbackSurveySchema>;
export type FeedbackSurvey = typeof feedbackSurveys.$inferSelect;

// Feedback Responses (問卷回覆)
export const feedbackResponses = pgTable("feedback_responses", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  surveyId: varchar("survey_id").notNull().references(() => feedbackSurveys.id),
  registrationId: varchar("registration_id").references(() => registrations.id),
  responses: jsonb("responses").$type<Record<string, any>>().notNull(),
  submittedAt: timestamp("submitted_at").defaultNow(),
});

export const insertFeedbackResponseSchema = createInsertSchema(feedbackResponses).omit({ 
  id: true, submittedAt: true 
});
export type InsertFeedbackResponse = z.infer<typeof insertFeedbackResponseSchema>;
export type FeedbackResponse = typeof feedbackResponses.$inferSelect;

// Viewer Progress (觀看進度)
export const viewerProgress = pgTable("viewer_progress", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  webinarId: varchar("webinar_id").notNull().references(() => webinars.id),
  registrationId: varchar("registration_id").references(() => registrations.id),
  viewerSessionId: text("viewer_session_id").notNull(), // 瀏覽器 session ID
  lastPosition: integer("last_position").default(0), // 上次觀看位置 (秒)
  totalWatched: integer("total_watched").default(0), // 總觀看時間 (秒)
  watchedRanges: jsonb("watched_ranges").$type<{start: number; end: number}[]>().default([]),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertViewerProgressSchema = createInsertSchema(viewerProgress).omit({ 
  id: true, updatedAt: true 
});
export type InsertViewerProgress = z.infer<typeof insertViewerProgressSchema>;
export type ViewerProgress = typeof viewerProgress.$inferSelect;

// Webinar Analytics (數據分析)
export const webinarAnalytics = pgTable("webinar_analytics", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  webinarId: varchar("webinar_id").notNull().references(() => webinars.id),
  sessionDate: timestamp("session_date").notNull(),
  
  // 流量數據
  pageViews: integer("page_views").default(0),
  registrations: integer("registrations").default(0),
  registrationRate: real("registration_rate").default(0), // 報名率 %
  
  // 出席數據
  attendees: integer("attendees").default(0),
  attendanceRate: real("attendance_rate").default(0), // 出席率 %
  
  // 觀看數據
  avgWatchTime: integer("avg_watch_time").default(0), // 平均觀看秒數
  avgWatchPercent: real("avg_watch_percent").default(0), // 平均觀看比例 %
  
  // 互動數據
  chatMessages: integer("chat_messages").default(0),
  likes: integer("likes").default(0),
  pollParticipation: real("poll_participation").default(0), // 投票參與率 %
  questionsAsked: integer("questions_asked").default(0),
  ctaClicks: integer("cta_clicks").default(0),
  
  // 轉換數據
  ctaConversionRate: real("cta_conversion_rate").default(0),
  
  // 觀眾流失分析 (每10秒的觀看人數)
  viewerRetention: jsonb("viewer_retention").$type<number[]>().default([]),
  
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertWebinarAnalyticsSchema = createInsertSchema(webinarAnalytics).omit({ 
  id: true, updatedAt: true 
});
export type InsertWebinarAnalytics = z.infer<typeof insertWebinarAnalyticsSchema>;
export type WebinarAnalytics = typeof webinarAnalytics.$inferSelect;

export const webinarFunnelEventTypes = [
  "landing_view",
  "registration",
  "webinar_enter",
  "video_progress",
  "dropoff",
  "cta_view",
  "cta_click",
  "checkout_start",
  "purchase",
  "refund",
] as const;
export type WebinarFunnelEventType = typeof webinarFunnelEventTypes[number];

export type WebinarFunnelMetadata = {
  source?: string;
  medium?: string;
  campaign?: string;
  term?: string;
  content?: string;
  reason?: "pause" | "navigate" | "close" | "ended" | "unknown";
  progressPercent?: number;
  referrerHost?: string;
  userAgent?: string;
  ipHash?: string;
  serverRecorded?: boolean;
};

// Append-only event stream. Application code intentionally exposes insert/read only.
export const webinarFunnelEvents = pgTable("webinar_funnel_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id, { onDelete: "restrict" }),
  webinarId: varchar("webinar_id").references(() => webinars.id, { onDelete: "set null" }),
  eventType: text("event_type").$type<WebinarFunnelEventType>().notNull(),
  registrationId: varchar("registration_id").references(() => registrations.id, { onDelete: "set null" }),
  sessionId: varchar("session_id", { length: 128 }),
  ctaId: varchar("cta_id").references(() => ctaButtons.id, { onDelete: "set null" }),
  ctaKey: varchar("cta_key", { length: 64 }),
  offerId: varchar("offer_id").references(() => webinarOffers.id, { onDelete: "set null" }),
  salesPageId: varchar("sales_page_id").references(() => offerSalesPages.id, { onDelete: "set null" }),
  visitorTokenHash: varchar("visitor_token_hash", { length: 64 }),
  positionSeconds: integer("position_seconds"),
  value: numeric("value", { precision: 14, scale: 2 }),
  amountMinor: integer("amount_minor"),
  currency: varchar("currency", { length: 3 }),
  dedupeKey: varchar("dedupe_key", { length: 64 }).notNull(),
  metadata: jsonb("metadata").$type<WebinarFunnelMetadata>().notNull().default({}),
  occurredAt: timestamp("occurred_at").notNull().defaultNow(),
}, (table) => ({
  dedupeUnique: uniqueIndex("webinar_funnel_events_webinar_dedupe_uniq").on(table.webinarId, table.dedupeKey),
  offerDedupeUnique: uniqueIndex("webinar_funnel_events_offer_dedupe_uniq")
    .on(table.offerId, table.dedupeKey)
    .where(sql`webinar_id IS NULL AND offer_id IS NOT NULL`),
  webinarOccurredIndex: index("webinar_funnel_events_webinar_occurred_idx").on(table.webinarId, table.occurredAt),
  webinarTypeIndex: index("webinar_funnel_events_webinar_type_idx").on(table.webinarId, table.eventType),
  webinarCtaKeyIndex: index("webinar_funnel_events_webinar_cta_key_idx").on(table.webinarId, table.ctaKey),
  webinarRegistrationIndex: index("webinar_funnel_events_webinar_registration_idx").on(table.webinarId, table.registrationId),
}));

export type WebinarFunnelEvent = typeof webinarFunnelEvents.$inferSelect;
export type InsertWebinarFunnelEvent = typeof webinarFunnelEvents.$inferInsert;

export const stripeWebhookEvents = pgTable("stripe_webhook_events", {
  id: text("id").primaryKey(),
  eventType: text("event_type").notNull(),
  processedAt: timestamp("processed_at").notNull().defaultNow(),
});
export const emailReminders = pgTable("email_reminders", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  webinarId: varchar("webinar_id").notNull().references(() => webinars.id),
  registrationId: varchar("registration_id").notNull().references(() => registrations.id),
  reminderType: text("reminder_type").notNull(), // confirmation, reminder_24h, reminder_1h, followup, sequence
  sequenceId: varchar("sequence_id"), // 若為追蹤序列郵件，指向 emailSequences.id
  scheduledFor: timestamp("scheduled_for").notNull(),
  sentAt: timestamp("sent_at"),
  status: text("status").notNull().default("pending"), // pending, sent, failed
  errorMessage: text("error_message"),
  attemptCount: integer("attempt_count").notNull().default(0),
  leaseToken: varchar("lease_token", { length: 64 }),
  leaseExpiresAt: timestamp("lease_expires_at"),
}, (table) => ({
  regSeqUniq: uniqueIndex("email_reminders_reg_seq_uniq")
    .on(table.registrationId, table.sequenceId)
    .where(sql`sequence_id IS NOT NULL`),
  dueIndex: index("email_reminders_due_idx").on(table.status, table.scheduledFor),
  leaseIndex: index("email_reminders_lease_idx").on(table.status, table.leaseExpiresAt),
}));

export const insertEmailReminderSchema = createInsertSchema(emailReminders).omit({
  id: true, sentAt: true, errorMessage: true, attemptCount: true, leaseToken: true, leaseExpiresAt: true
});
export type InsertEmailReminder = z.infer<typeof insertEmailReminderSchema>;
export type EmailReminder = typeof emailReminders.$inferSelect;

// Chat Messages (即時聊天)
export const chatMessages = pgTable("chat_messages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  webinarId: varchar("webinar_id").notNull().references(() => webinars.id),
  sessionId: varchar("session_id"), // 觀眾獨立場次 ID（null = 公開訊息/主持人訊息）
  senderName: text("sender_name").notNull(),
  senderType: text("sender_type").notNull().default("viewer"), // viewer, host, bot, scheduled
  message: text("message").notNull(),
  sentAt: timestamp("sent_at").defaultNow(),
  isPrivate: boolean("is_private").default(false), // 只有該觀眾和主持人能看到
});

export const insertChatMessageSchema = createInsertSchema(chatMessages).omit({ id: true, sentAt: true });
export type InsertChatMessage = z.infer<typeof insertChatMessageSchema>;
export type ChatMessage = typeof chatMessages.$inferSelect;

// Likes (按讚)
export const likes = pgTable("likes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  webinarId: varchar("webinar_id").notNull().references(() => webinars.id),
  count: integer("count").notNull().default(0),
});

export const insertLikeSchema = createInsertSchema(likes).omit({ id: true });
export type InsertLike = z.infer<typeof insertLikeSchema>;
export type Like = typeof likes.$inferSelect;

// Users (SaaS 帳號)
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  email: text("email").notNull().default(""),
  companyName: text("company_name").default(""),
  subscriptionPlan: text("subscription_plan").notNull().default("free"),
  planExpiresAt: timestamp("plan_expires_at"),
  maxWebinars: integer("max_webinars").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  isSuperAdmin: boolean("is_super_admin").notNull().default(false),
  aiPoints: integer("ai_points").notNull().default(0), // 免費帳號不附 AI 點數
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  stripeSubscriptionCheckoutSessionId: text("stripe_subscription_checkout_session_id"),
  stripeTrialClaimedAt: timestamp("stripe_trial_claimed_at"),
  subscriptionStatus: text("subscription_status").notNull().default("inactive"),
  subscriptionStartedAt: timestamp("subscription_started_at"),
  cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
  addonWebinars: integer("addon_webinars").notNull().default(0),
  emailVerificationRequired: boolean("email_verification_required").notNull().default(false),
  emailVerifiedAt: timestamp("email_verified_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertUserSchema = createInsertSchema(users).omit({ id: true, createdAt: true, subscriptionPlan: true, planExpiresAt: true, maxWebinars: true, isActive: true, isSuperAdmin: true, aiPoints: true, stripeCustomerId: true, stripeSubscriptionId: true, stripeSubscriptionCheckoutSessionId: true, stripeTrialClaimedAt: true, subscriptionStatus: true, subscriptionStartedAt: true, cancelAtPeriodEnd: true, addonWebinars: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

export const ecpayConnections = pgTable("ecpay_connections", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }).unique(),
  merchantId: varchar("merchant_id", { length: 10 }).notNull(),
  environment: text("environment").notNull().default("stage"),
  hashKeyEncrypted: text("hash_key_encrypted").notNull(),
  hashIvEncrypted: text("hash_iv_encrypted").notNull(),
  enabled: boolean("enabled").notNull().default(false),
  verifiedAt: timestamp("verified_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export type EcpayConnection = typeof ecpayConnections.$inferSelect;

// Authentication tokens contain hashes only. Raw tokens are never persisted.
export const authTokens = pgTable("auth_tokens", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  purpose: text("purpose").notNull(), // email_verification, password_reset
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at").notNull(),
  consumedAt: timestamp("consumed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export type AuthToken = typeof authTokens.$inferSelect;

export const rateLimitBuckets = pgTable("rate_limit_buckets", {
  key: text("key").primaryKey(),
  windowStartedAt: timestamp("window_started_at").notNull(),
  requestCount: integer("request_count").notNull().default(1),
  expiresAt: timestamp("expires_at").notNull(),
});

export const errorEvents = pgTable("error_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  fingerprint: text("fingerprint").notNull(),
  method: text("method"),
  path: text("path"),
  statusCode: integer("status_code").notNull().default(500),
  message: text("message").notNull(),
  stack: text("stack"),
  userId: varchar("user_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export type ErrorEvent = typeof errorEvents.$inferSelect;

export const supportFeedback = pgTable("support_feedback", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  category: text("category").notNull().default("feedback"),
  subject: text("subject").notNull(),
  message: text("message").notNull(),
  status: text("status").notNull().default("open"),
  adminNote: text("admin_note"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export const insertSupportFeedbackSchema = createInsertSchema(supportFeedback)
  .pick({ category: true, subject: true, message: true })
  .extend({
    category: z.enum(["feedback", "question", "bug"]).default("feedback"),
    subject: z.string().trim().min(1).max(200),
    message: z.string().trim().min(1).max(5000),
  });
export type InsertSupportFeedback = z.infer<typeof insertSupportFeedbackSchema>;
export type SupportFeedback = typeof supportFeedback.$inferSelect;

// AI 點數交易記錄（充值 / 後台贈送），用於 Stripe 充值的冪等保護
export const aiPointTransactions = pgTable("ai_point_transactions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  type: text("type").notNull(), // purchase, grant
  points: integer("points").notNull(), // 增加的點數
  amountTwd: integer("amount_twd"), // 付款金額（元），grant 為 null
  stripeSessionId: text("stripe_session_id").unique(), // Stripe checkout session（冪等用）
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertAiPointTransactionSchema = createInsertSchema(aiPointTransactions).omit({ id: true, createdAt: true });
export type InsertAiPointTransaction = z.infer<typeof insertAiPointTransactionSchema>;
export type AiPointTransaction = typeof aiPointTransactions.$inferSelect;

export const aiCreditLots = pgTable("ai_credit_lots", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  source: text("source").notNull(), // legacy, monthly_gift, purchase, admin_grant
  originalPoints: integer("original_points").notNull(),
  remainingPoints: integer("remaining_points").notNull(),
  grantedAt: timestamp("granted_at").notNull().defaultNow(),
  expiresAt: timestamp("expires_at"),
  idempotencyKey: text("idempotency_key").unique(),
}, (table) => ({
  userExpiryIndex: index("ai_credit_lots_user_expiry_idx").on(table.userId, table.expiresAt),
}));
export type AiCreditLot = typeof aiCreditLots.$inferSelect;

export const aiCreditReservations = pgTable("ai_credit_reservations", {
  id: varchar("id").primaryKey(),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  points: integer("points").notNull(),
  allocations: jsonb("allocations").notNull().$type<Array<{ lotId: string; points: number }>>(),
  status: text("status").notNull().default("reserved"), // reserved, consumed, refunded
  createdAt: timestamp("created_at").notNull().defaultNow(),
  completedAt: timestamp("completed_at"),
}, (table) => ({
  userCreatedIndex: index("ai_credit_reservations_user_created_idx").on(table.userId, table.createdAt),
}));

export const aiCreditRevocations = pgTable("ai_credit_revocations", {
  idempotencyKey: text("idempotency_key").primaryKey(),
  userId: varchar("user_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const aiResponseArtifacts = pgTable("ai_response_artifacts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  reservationId: varchar("reservation_id").references(() => aiCreditReservations.id).unique(),
  userId: varchar("user_id").notNull().references(() => users.id),
  webinarId: varchar("webinar_id").references(() => webinars.id),
  kind: text("kind").notNull(),
  requestText: text("request_text").notNull(),
  responseText: text("response_text").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const uploadedAssets = pgTable("uploaded_assets", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  url: text("url").notNull().unique(),
  filename: text("filename").notNull().unique(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Webinar Sessions (用於循環排程的場次)
export const webinarSessions = pgTable("webinar_sessions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  webinarId: varchar("webinar_id").notNull().references(() => webinars.id),
  scheduledStart: timestamp("scheduled_start").notNull(),
  scheduledEnd: timestamp("scheduled_end"),
  status: text("status").notNull().default("scheduled"), // scheduled, live, ended, cancelled
  attendeeCount: integer("attendee_count").default(0),
});

export const insertWebinarSessionSchema = createInsertSchema(webinarSessions).omit({ id: true });
export type InsertWebinarSession = z.infer<typeof insertWebinarSessionSchema>;
export type WebinarSession = typeof webinarSessions.$inferSelect;

// Webhooks (Webhook 整合)
export const webhooks = pgTable("webhooks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  webinarId: varchar("webinar_id").notNull().references(() => webinars.id),
  eventType: text("event_type").notNull(), // registration, completion, attendance
  targetUrl: text("target_url").notNull(),
  secret: text("secret"),
  enabled: boolean("enabled").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertWebhookSchema = createInsertSchema(webhooks).omit({ id: true, createdAt: true }).extend({
  eventType: z.enum(["registration", "completion", "attendance"]),
  targetUrl: z.string().trim().url().max(2048),
  secret: z.string().max(512).nullish(),
});
export type InsertWebhook = z.infer<typeof insertWebhookSchema>;
export type Webhook = typeof webhooks.$inferSelect;

export const webhookDeliveries = pgTable("webhook_deliveries", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  webhookId: varchar("webhook_id").notNull().references(() => webhooks.id, { onDelete: "cascade" }),
  eventType: text("event_type").notNull(),
  eventKey: text("event_key"),
  payload: jsonb("payload").notNull(),
  status: text("status").notNull().default("pending"),
  attemptCount: integer("attempt_count").notNull().default(0),
  leaseToken: varchar("lease_token", { length: 64 }),
  nextAttemptAt: timestamp("next_attempt_at").notNull().defaultNow(),
  lastError: text("last_error"),
  deliveredAt: timestamp("delivered_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  eventKeyUnique: uniqueIndex("webhook_deliveries_event_key_uniq").on(table.webhookId, table.eventKey),
  retryIndex: index("webhook_deliveries_retry_idx").on(table.status, table.nextAttemptAt),
}));

// Webinar Documents (AI 助教知識文檔)
export const webinarDocuments = pgTable("webinar_documents", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  webinarId: varchar("webinar_id").notNull().references(() => webinars.id),
  title: text("title").notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertWebinarDocumentSchema = createInsertSchema(webinarDocuments).omit({ id: true, createdAt: true });
export type InsertWebinarDocument = z.infer<typeof insertWebinarDocumentSchema>;
export type WebinarDocument = typeof webinarDocuments.$inferSelect;

// Email Sequences (AI 銷售追蹤電子報序列) - eWebinar 風格分眾追蹤
export const emailSequences = pgTable("email_sequences", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  webinarId: varchar("webinar_id").notNull().references(() => webinars.id),
  name: text("name").notNull(), // 內部名稱（如「第 1 封：感謝+回放」）
  segment: text("segment").notNull().default("all"), // all, watched, not_watched, no_show
  delayMinutes: integer("delay_minutes").notNull().default(60), // 研討會結束後幾分鐘寄出
  subject: text("subject").notNull(),
  htmlBody: text("html_body").notNull(), // 支援 {{name}} {{title}} {{url}} 變數
  enabled: boolean("enabled").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  enabledWebinarIndex: index("email_sequences_enabled_webinar_idx").on(table.enabled, table.webinarId),
}));

export const insertEmailSequenceSchema = createInsertSchema(emailSequences).omit({ id: true, createdAt: true });
export type InsertEmailSequence = z.infer<typeof insertEmailSequenceSchema>;
export type EmailSequence = typeof emailSequences.$inferSelect;

// Social Posts (AI 生成排程社群貼文草稿，無社群 API → 供手動發佈)
export const socialPosts = pgTable("social_posts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  webinarId: varchar("webinar_id").notNull().references(() => webinars.id),
  platform: text("platform").notNull().default("facebook"), // facebook, instagram, linkedin, x, threads
  content: text("content").notNull(),
  scheduledFor: timestamp("scheduled_for"), // 建議發佈時間（手動發佈用）
  status: text("status").notNull().default("draft"), // draft, posted
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertSocialPostSchema = createInsertSchema(socialPosts).omit({ id: true, createdAt: true });
export type InsertSocialPost = z.infer<typeof insertSocialPostSchema>;
export type SocialPost = typeof socialPosts.$inferSelect;

export type WebinarOffer = typeof webinarOffers.$inferSelect;

export const webinarPayments = pgTable("webinar_payments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id, { onDelete: "restrict" }),
  webinarId: varchar("webinar_id").references(() => webinars.id, { onDelete: "set null" }),
  offerId: varchar("offer_id").notNull().references(() => webinarOffers.id, { onDelete: "restrict" }),
  ctaId: varchar("cta_id").references(() => ctaButtons.id, { onDelete: "restrict" }),
  registrationId: varchar("registration_id").references(() => registrations.id, { onDelete: "set null" }),
  visitorTokenHash: varchar("visitor_token_hash", { length: 64 }),
  paymentProvider: text("payment_provider").notNull().default("stripe"),
  stripeCheckoutSessionId: text("stripe_checkout_session_id").unique(),
  checkoutStatusTokenHash: varchar("checkout_status_token_hash", { length: 64 }).unique(),
  salesPageId: varchar("sales_page_id").references(() => offerSalesPages.id, { onDelete: "set null" }),
  originSalesPageIdSnapshot: varchar("origin_sales_page_id_snapshot"),
  salesPageVersion: integer("sales_page_version"),
  checkoutSettingsSnapshot: jsonb("checkout_settings_snapshot").$type<{
    transitionTitle: string; transitionMessage: string; successTitle: string; successMessage: string;
    successButtonLabel: string; successButtonUrl?: string; cancelTitle: string; cancelMessage: string;
  }>(),
  offerSlugSnapshot: varchar("offer_slug_snapshot", { length: 80 }),
  stripePaymentIntentId: text("stripe_payment_intent_id").unique(),
  providerOrderId: varchar("provider_order_id", { length: 64 }).unique(),
  ecpayConnectionId: varchar("ecpay_connection_id").references(() => ecpayConnections.id, { onDelete: "restrict" }),
  merchantIdSnapshot: varchar("merchant_id_snapshot", { length: 10 }),
  providerEnvironment: text("provider_environment"),
  providerHashKeySnapshot: text("provider_hash_key_snapshot"),
  providerHashIvSnapshot: text("provider_hash_iv_snapshot"),
  amountMinor: integer("amount_minor").notNull(),
  refundedMinor: integer("refunded_minor").notNull().default(0),
  currency: varchar("currency", { length: 3 }).notNull(),
  status: text("status").notNull().default("paid"),
  purchasedAt: timestamp("purchased_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const currencyCodeSchema = z.string().trim().regex(/^[A-Za-z]{3}$/)
  .transform(value => value.toUpperCase());

export const createWebinarOfferSchema = z.object({
  paymentProvider: z.literal("ecpay").default("ecpay"),
  name: z.string().trim().min(1).max(200),
  amountMinor: z.number().int().min(1).max(999999999),
  currency: currencyCodeSchema,
  checkoutMode: z.literal("payment").default("payment"),
}).strict().superRefine((value, context) => {
  if (value.currency !== "TWD") {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["currency"], message: "ECPay offers must use TWD" });
  }
  if (value.amountMinor % 100 !== 0) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["amountMinor"], message: "ECPay TWD offers must use whole-dollar amounts" });
  }
});

export type CreateWebinarOffer = z.infer<typeof createWebinarOfferSchema>;

export type WebinarPayment = typeof webinarPayments.$inferSelect;

export const webinarPendingRefunds = pgTable("webinar_pending_refunds", {
  stripeEventId: text("stripe_event_id").primaryKey(),
  stripePaymentIntentId: text("stripe_payment_intent_id").notNull(),
  cumulativeRefundMinor: integer("cumulative_refund_minor").notNull(),
  currency: varchar("currency", { length: 3 }),
  reconciledAt: timestamp("reconciled_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  pendingPaymentIndex: index("webinar_pending_refunds_payment_idx").on(table.stripePaymentIntentId),
}));
