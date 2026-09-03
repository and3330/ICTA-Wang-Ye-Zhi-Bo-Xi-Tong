import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, integer, boolean, jsonb, real, numeric, uniqueIndex, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

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

export const insertWebinarSchema = createInsertSchema(webinars).omit({ id: true, createdAt: true }).extend({
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

// CTA Buttons (行動呼籲按鈕)
export const ctaButtons = pgTable("cta_buttons", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  webinarId: varchar("webinar_id").notNull().references(() => webinars.id),
  text: text("text").notNull(),
  url: text("url").notNull(),
  startTime: integer("start_time").notNull(), // seconds when to show
  endTime: integer("end_time"), // seconds when to hide (null = until end)
  style: text("style").default("primary"), // primary, secondary, danger
  ctaKey: varchar("cta_key", { length: 64 }).notNull().unique(), // server-generated stable tracking key
});

export const safeCtaUrlSchema = z.string().trim().min(1).max(2048).refine((value) => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}, "CTA URL must be an absolute HTTP or HTTPS URL");
export const insertCtaButtonSchema = createInsertSchema(ctaButtons).omit({ id: true, ctaKey: true }).extend({
  url: safeCtaUrlSchema,
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
  webinarId: varchar("webinar_id").notNull().references(() => webinars.id, { onDelete: "cascade" }),
  eventType: text("event_type").$type<WebinarFunnelEventType>().notNull(),
  registrationId: varchar("registration_id").references(() => registrations.id, { onDelete: "set null" }),
  sessionId: varchar("session_id", { length: 128 }),
  ctaId: varchar("cta_id").references(() => ctaButtons.id, { onDelete: "set null" }),
  ctaKey: varchar("cta_key", { length: 64 }),
  visitorTokenHash: varchar("visitor_token_hash", { length: 64 }),
  positionSeconds: integer("position_seconds"),
  value: numeric("value", { precision: 14, scale: 2 }),
  currency: varchar("currency", { length: 3 }),
  dedupeKey: varchar("dedupe_key", { length: 64 }).notNull(),
  metadata: jsonb("metadata").$type<WebinarFunnelMetadata>().notNull().default({}),
  occurredAt: timestamp("occurred_at").notNull().defaultNow(),
}, (table) => ({
  dedupeUnique: uniqueIndex("webinar_funnel_events_webinar_dedupe_uniq").on(table.webinarId, table.dedupeKey),
  webinarOccurredIndex: index("webinar_funnel_events_webinar_occurred_idx").on(table.webinarId, table.occurredAt),
  webinarTypeIndex: index("webinar_funnel_events_webinar_type_idx").on(table.webinarId, table.eventType),
  webinarCtaKeyIndex: index("webinar_funnel_events_webinar_cta_key_idx").on(table.webinarId, table.ctaKey),
}));

export type WebinarFunnelEvent = typeof webinarFunnelEvents.$inferSelect;
export type InsertWebinarFunnelEvent = typeof webinarFunnelEvents.$inferInsert;

// Email Reminders (Email 提醒排程)
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
}, (table) => ({
  regSeqUniq: uniqueIndex("email_reminders_reg_seq_uniq")
    .on(table.registrationId, table.sequenceId)
    .where(sql`sequence_id IS NOT NULL`),
}));

export const insertEmailReminderSchema = createInsertSchema(emailReminders).omit({ 
  id: true, sentAt: true, errorMessage: true 
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
  aiPoints: integer("ai_points").notNull().default(20), // AI 回覆點數餘額（新廠商送 20 點試用）
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  subscriptionStatus: text("subscription_status").notNull().default("inactive"),
  subscriptionStartedAt: timestamp("subscription_started_at"),
  cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
  addonWebinars: integer("addon_webinars").notNull().default(0),
  emailVerificationRequired: boolean("email_verification_required").notNull().default(false),
  emailVerifiedAt: timestamp("email_verified_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertUserSchema = createInsertSchema(users).omit({ id: true, createdAt: true, subscriptionPlan: true, planExpiresAt: true, maxWebinars: true, isActive: true, isSuperAdmin: true, aiPoints: true, stripeCustomerId: true, stripeSubscriptionId: true, subscriptionStatus: true, subscriptionStartedAt: true, cancelAtPeriodEnd: true, addonWebinars: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

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

export const insertWebhookSchema = createInsertSchema(webhooks).omit({ id: true, createdAt: true });
export type InsertWebhook = z.infer<typeof insertWebhookSchema>;
export type Webhook = typeof webhooks.$inferSelect;

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
});

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
