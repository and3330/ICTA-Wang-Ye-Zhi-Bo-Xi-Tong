import { db } from "./db";
import crypto from "node:crypto";
import { authoritativeRegistrationFunnelEvent } from "./funnelAnalytics";
import { eq, and, lt, lte, gt, gte, desc, asc, count, isNull, or, sql } from "drizzle-orm";
import {
  webinars, type InsertWebinar, type Webinar,
  registrations, type InsertRegistration, type Registration,
  fakeUsers, type InsertFakeUser, type FakeUser,
  scheduledMessages, type InsertScheduledMessage, type ScheduledMessage,
  ctaButtons, type InsertCtaButton, type CtaButton,
  tips, type InsertTip, type Tip,
  polls, type InsertPoll, type Poll,
  pollVotes, type InsertPollVote, type PollVote,
  questions, type InsertQuestion, type Question,
  feedbackSurveys, type InsertFeedbackSurvey, type FeedbackSurvey,
  feedbackResponses, type InsertFeedbackResponse, type FeedbackResponse,
  viewerProgress, type InsertViewerProgress, type ViewerProgress,
  webinarAnalytics, type InsertWebinarAnalytics, type WebinarAnalytics,
  emailReminders, type InsertEmailReminder, type EmailReminder,
  chatMessages, type InsertChatMessage, type ChatMessage,
  likes, type InsertLike, type Like,
  users, type InsertUser, type User,
  webinarSessions, type InsertWebinarSession, type WebinarSession,
  webhooks, type InsertWebhook, type Webhook,
  webinarDocuments, type InsertWebinarDocument, type WebinarDocument,
  emailSequences, type InsertEmailSequence, type EmailSequence,
  socialPosts, type InsertSocialPost, type SocialPost,
  aiPointTransactions, type AiPointTransaction,
  authTokens, supportFeedback, type InsertSupportFeedback, type SupportFeedback,
  webinarFunnelEvents, type InsertWebinarFunnelEvent, type WebinarFunnelEvent,
} from "@shared/schema";

export interface IStorage {
  // Users (Admin)
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  listAllUsers(): Promise<User[]>;
  updateUser(id: string, data: Partial<Omit<User, "id" | "password" | "createdAt">>): Promise<User | undefined>;
  getWebinarCountByUser(userId: string): Promise<number>;
  getPublishedWebinarCountByUser(userId: string): Promise<number>;
  publishWebinarWithinLimit(userId: string, webinarId: string, maxPublished: number): Promise<{ webinar?: Webinar; limitExceeded: boolean }>;
  getUserByStripeCustomerId(stripeCustomerId: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  createAuthToken(userId: string, purpose: string, tokenHash: string, expiresAt: Date): Promise<void>;
  getLatestAuthTokenCreatedAt(userId: string, purpose: string): Promise<Date | null>;
  consumeEmailVerificationToken(tokenHash: string): Promise<boolean>;
  resetPasswordWithToken(tokenHash: string, passwordHash: string): Promise<boolean>;
  createSupportFeedback(userId: string, data: InsertSupportFeedback): Promise<SupportFeedback>;
  listSupportFeedback(): Promise<SupportFeedback[]>;
  updateSupportFeedback(id: string, data: { status?: string; adminNote?: string | null }): Promise<SupportFeedback | undefined>;
  // AI 點數
  deductAiPoints(userId: string, points: number): Promise<number | null>; // 原子扣點；不足回 null
  addAiPoints(userId: string, points: number): Promise<number>; // 原子加點，回新餘額
  isStripeSessionProcessed(stripeSessionId: string): Promise<boolean>;
  recordPointTransaction(data: { userId: string; type: string; points: number; amountTwd?: number | null; stripeSessionId?: string | null }): Promise<AiPointTransaction>;
  creditPointPurchase(data: { userId: string; points: number; amountTwd: number; stripeSessionId: string }): Promise<{ points: number; alreadyProcessed: boolean }>;
  getPointTransactionOwner(stripeSessionId: string): Promise<string | null>;
  
  // Webinars
  createWebinar(data: InsertWebinar): Promise<Webinar>;
  getWebinar(id: string): Promise<Webinar | undefined>;
  getAllWebinars(): Promise<Webinar[]>;
  getWebinarsByUser(userId: string): Promise<Webinar[]>;
  updateWebinar(id: string, data: Partial<InsertWebinar>): Promise<Webinar | undefined>;
  deleteWebinar(id: string): Promise<void>;
  
  // Registrations
  createRegistration(data: InsertRegistration, analyticsVisitorToken?: string): Promise<Registration>;
  createRegistrationWithinMonthlyLimit(
    userId: string,
    data: InsertRegistration,
    monthlyLimit: number,
    analyticsVisitorToken?: string,
  ): Promise<Registration | null>;
  getRegistration(id: string): Promise<Registration | undefined>;
  getRegistrationsByWebinar(webinarId: string): Promise<Registration[]>;
  getRegistrationByEmail(webinarId: string, email: string): Promise<Registration | undefined>;
  updateRegistration(id: string, data: Partial<Registration>): Promise<Registration | undefined>;
  
  // Fake Users
  createFakeUser(data: InsertFakeUser): Promise<FakeUser>;
  getFakeUsersByWebinar(webinarId: string): Promise<FakeUser[]>;
  deleteFakeUser(id: string): Promise<void>;
  
  // Scheduled Messages
  createScheduledMessage(data: InsertScheduledMessage): Promise<ScheduledMessage>;
  getScheduledMessagesByWebinar(webinarId: string): Promise<ScheduledMessage[]>;
  deleteScheduledMessage(id: string): Promise<void>;
  
  // CTA Buttons
  createCtaButton(data: InsertCtaButton): Promise<CtaButton>;
  getCtaButtonsByWebinar(webinarId: string): Promise<CtaButton[]>;
  deleteCtaButton(id: string): Promise<void>;
  
  // Tips
  createTip(data: InsertTip): Promise<Tip>;
  getTipsByWebinar(webinarId: string): Promise<Tip[]>;
  deleteTip(id: string): Promise<void>;
  
  // Polls
  createPoll(data: InsertPoll): Promise<Poll>;
  getPollsByWebinar(webinarId: string): Promise<Poll[]>;
  getPoll(id: string): Promise<Poll | undefined>;
  deletePoll(id: string): Promise<void>;
  
  // Poll Votes
  createPollVote(data: InsertPollVote): Promise<PollVote>;
  getPollVotes(pollId: string): Promise<PollVote[]>;
  
  // Questions (Q&A)
  createQuestion(data: InsertQuestion): Promise<Question>;
  getQuestionsByWebinar(webinarId: string): Promise<Question[]>;
  getPresetQuestions(webinarId: string): Promise<Question[]>;
  updateQuestion(id: string, data: Partial<Question>): Promise<Question | undefined>;
  deleteQuestion(id: string): Promise<void>;
  
  // Feedback Surveys
  createFeedbackSurvey(data: InsertFeedbackSurvey): Promise<FeedbackSurvey>;
  getFeedbackSurveyByWebinar(webinarId: string): Promise<FeedbackSurvey | undefined>;
  updateFeedbackSurvey(id: string, data: Partial<FeedbackSurvey>): Promise<FeedbackSurvey | undefined>;
  
  // Feedback Responses
  createFeedbackResponse(data: InsertFeedbackResponse): Promise<FeedbackResponse>;
  getFeedbackResponsesBySurvey(surveyId: string): Promise<FeedbackResponse[]>;
  
  // Viewer Progress
  getViewerProgress(webinarId: string, sessionId: string): Promise<ViewerProgress | undefined>;
  upsertViewerProgress(data: InsertViewerProgress): Promise<ViewerProgress>;
  
  // Analytics
  getWebinarAnalytics(webinarId: string): Promise<WebinarAnalytics[]>;
  upsertWebinarAnalytics(data: InsertWebinarAnalytics): Promise<WebinarAnalytics>;
  createFunnelEvent(data: InsertWebinarFunnelEvent): Promise<{ event: WebinarFunnelEvent; deduplicated: boolean }>;
  getFunnelEvents(webinarId: string, from?: Date, to?: Date): Promise<WebinarFunnelEvent[]>;
  
  // Email Reminders
  createEmailReminder(data: InsertEmailReminder): Promise<EmailReminder>;
  getPendingEmailReminders(before: Date): Promise<EmailReminder[]>;
  updateEmailReminder(id: string, data: Partial<EmailReminder>): Promise<void>;
  
  // Chat Messages
  createChatMessage(data: InsertChatMessage): Promise<ChatMessage>;
  getChatMessagesByWebinar(webinarId: string): Promise<ChatMessage[]>;
  getChatMessagesBySession(webinarId: string, sessionId: string): Promise<ChatMessage[]>;
  
  // Likes
  getLikes(webinarId: string): Promise<Like | undefined>;
  incrementLikes(webinarId: string): Promise<number>;
  
  // Webinar Sessions
  createWebinarSession(data: InsertWebinarSession): Promise<WebinarSession>;
  getWebinarSessions(webinarId: string): Promise<WebinarSession[]>;
  getUpcomingSessions(webinarId: string): Promise<WebinarSession[]>;
  updateWebinarSession(id: string, data: Partial<WebinarSession>): Promise<void>;
  deleteWebinarSession(id: string): Promise<void>;
  
  // Webhooks
  createWebhook(data: InsertWebhook): Promise<Webhook>;
  getWebhooksByWebinar(webinarId: string): Promise<Webhook[]>;
  getWebhooksByEvent(webinarId: string, eventType: string): Promise<Webhook[]>;
  deleteWebhook(id: string): Promise<void>;
  updateWebhook(id: string, data: Partial<Webhook>): Promise<Webhook | undefined>;

  // Webinar Documents (AI 知識文檔)
  createWebinarDocument(data: InsertWebinarDocument): Promise<WebinarDocument>;
  getWebinarDocuments(webinarId: string): Promise<WebinarDocument[]>;
  deleteWebinarDocument(webinarId: string, id: string): Promise<void>;

  // Email Sequences (AI 銷售追蹤序列)
  createEmailSequence(data: InsertEmailSequence): Promise<EmailSequence>;
  getEmailSequences(webinarId: string): Promise<EmailSequence[]>;
  getEnabledEmailSequences(webinarId: string): Promise<EmailSequence[]>;
  getEmailSequence(id: string): Promise<EmailSequence | undefined>;
  updateEmailSequence(webinarId: string, id: string, data: Partial<EmailSequence>): Promise<EmailSequence | undefined>;
  deleteEmailSequence(webinarId: string, id: string): Promise<void>;
  hasSequenceReminder(registrationId: string, sequenceId: string): Promise<boolean>;

  // Social Posts (AI 排程貼文草稿)
  createSocialPost(data: InsertSocialPost): Promise<SocialPost>;
  getSocialPosts(webinarId: string): Promise<SocialPost[]>;
  updateSocialPost(webinarId: string, id: string, data: Partial<SocialPost>): Promise<SocialPost | undefined>;
  deleteSocialPost(webinarId: string, id: string): Promise<void>;
}

export async function claimWebinarPublicationWithinLimit(
  database: typeof db,
  userId: string,
  webinarId: string,
  maxPublished: number,
): Promise<{ webinarId?: string; limitExceeded: boolean }> {
  return database.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${userId}))`);
    const existing = await tx
      .select({ id: webinars.id, publishStatus: webinars.publishStatus })
      .from(webinars)
      .where(and(eq(webinars.id, webinarId), eq(webinars.userId, userId)));
    if (!existing[0]) return { webinarId: undefined, limitExceeded: false };
    if (existing[0].publishStatus === "published") {
      return { webinarId: existing[0].id, limitExceeded: false };
    }

    const result = await tx
      .select({ value: count() })
      .from(webinars)
      .where(and(eq(webinars.userId, userId), eq(webinars.publishStatus, "published")));
    if ((result[0]?.value || 0) >= maxPublished) {
      return { webinarId: undefined, limitExceeded: true };
    }

    const updated = await tx
      .update(webinars)
      .set({ publishStatus: "published" })
      .where(and(eq(webinars.id, webinarId), eq(webinars.userId, userId)))
      .returning({ id: webinars.id });
    return { webinarId: updated[0]?.id, limitExceeded: false };
  });
}

export async function issueAuthToken(
  database: typeof db,
  userId: string,
  purpose: string,
  tokenHash: string,
  expiresAt: Date,
): Promise<void> {
  await database.transaction(async (tx) => {
    // The lock spans invalidation and insertion, preventing concurrent active tokens
    // for the same user and purpose across application instances.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${userId}:${purpose}`}))`);
    await tx.update(authTokens).set({ consumedAt: new Date() })
      .where(and(eq(authTokens.userId, userId), eq(authTokens.purpose, purpose), isNull(authTokens.consumedAt)));
    await tx.insert(authTokens).values({ userId, purpose, tokenHash, expiresAt });
  });
}

export class DatabaseStorage implements IStorage {
  // Users (Admin)
  async getUser(id: string): Promise<User | undefined> {
    const result = await db.select().from(users).where(eq(users.id, id));
    return result[0];
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const result = await db.select().from(users).where(eq(users.username, username));
    return result[0];
  }

  async createUser(data: InsertUser): Promise<User> {
    const result = await db.insert(users).values(data).returning();
    return result[0];
  }

  async listAllUsers(): Promise<User[]> {
    return db.select().from(users).orderBy(asc(users.createdAt));
  }

  async updateUser(id: string, data: Partial<Omit<User, "id" | "password" | "createdAt">>): Promise<User | undefined> {
    const result = await db.update(users).set(data).where(eq(users.id, id)).returning();
    return result[0];
  }

  async getWebinarCountByUser(userId: string): Promise<number> {
    const result = await db.select({ value: count() }).from(webinars).where(eq(webinars.userId, userId));
    return result[0]?.value || 0;
  }

  async getPublishedWebinarCountByUser(userId: string): Promise<number> {
    const result = await db.select({ value: count() }).from(webinars).where(and(eq(webinars.userId, userId), eq(webinars.publishStatus, "published")));
    return result[0]?.value || 0;
  }

  async publishWebinarWithinLimit(userId: string, webinarId: string, maxPublished: number): Promise<{ webinar?: Webinar; limitExceeded: boolean }> {
    const result = await claimWebinarPublicationWithinLimit(db, userId, webinarId, maxPublished);
    if (!result.webinarId) return { webinar: undefined, limitExceeded: result.limitExceeded };
    return { webinar: await this.getWebinar(result.webinarId), limitExceeded: false };
  }

  async getUserByStripeCustomerId(stripeCustomerId: string): Promise<User | undefined> {
    const result = await db.select().from(users).where(eq(users.stripeCustomerId, stripeCustomerId));
    return result[0];
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const result = await db.select().from(users).where(sql`lower(${users.email}) = lower(${email})`).limit(1);
    return result[0];
  }

  async createAuthToken(userId: string, purpose: string, tokenHash: string, expiresAt: Date): Promise<void> {
    await issueAuthToken(db, userId, purpose, tokenHash, expiresAt);
  }

  async getLatestAuthTokenCreatedAt(userId: string, purpose: string): Promise<Date | null> {
    const result = await db.select({ createdAt: authTokens.createdAt }).from(authTokens)
      .where(and(eq(authTokens.userId, userId), eq(authTokens.purpose, purpose)))
      .orderBy(desc(authTokens.createdAt)).limit(1);
    return result[0]?.createdAt ?? null;
  }

  async consumeEmailVerificationToken(tokenHash: string): Promise<boolean> {
    return db.transaction(async (tx) => {
      const token = await tx.update(authTokens).set({ consumedAt: new Date() })
        .where(and(
          eq(authTokens.tokenHash, tokenHash),
          eq(authTokens.purpose, "email_verification"),
          isNull(authTokens.consumedAt),
          gt(authTokens.expiresAt, new Date()),
        )).returning({ userId: authTokens.userId });
      if (!token[0]) return false;
      await tx.update(users).set({ emailVerifiedAt: new Date() }).where(eq(users.id, token[0].userId));
      return true;
    });
  }

  async resetPasswordWithToken(tokenHash: string, passwordHash: string): Promise<boolean> {
    return db.transaction(async (tx) => {
      const token = await tx.update(authTokens).set({ consumedAt: new Date() })
        .where(and(
          eq(authTokens.tokenHash, tokenHash),
          eq(authTokens.purpose, "password_reset"),
          isNull(authTokens.consumedAt),
          gt(authTokens.expiresAt, new Date()),
        )).returning({ userId: authTokens.userId });
      if (!token[0]) return false;
      await tx.update(users).set({ password: passwordHash }).where(eq(users.id, token[0].userId));
      // connect-pg-simple stores session data as json in sess.
      await tx.execute(sql`DELETE FROM "session" WHERE sess->>'userId' = ${token[0].userId}`);
      return true;
    });
  }

  async createSupportFeedback(userId: string, data: InsertSupportFeedback): Promise<SupportFeedback> {
    const result = await db.insert(supportFeedback).values({ userId, ...data }).returning();
    return result[0];
  }

  async listSupportFeedback(): Promise<SupportFeedback[]> {
    return db.select().from(supportFeedback).orderBy(desc(supportFeedback.createdAt));
  }

  async updateSupportFeedback(id: string, data: { status?: string; adminNote?: string | null }): Promise<SupportFeedback | undefined> {
    const result = await db.update(supportFeedback).set({ ...data, updatedAt: new Date() })
      .where(eq(supportFeedback.id, id)).returning();
    return result[0];
  }

  // 原子扣點：只有餘額足夠才扣，避免並發競態。成功回新餘額，不足回 null
  async deductAiPoints(userId: string, points: number): Promise<number | null> {
    const result = await db
      .update(users)
      .set({ aiPoints: sql`${users.aiPoints} - ${points}` })
      .where(and(eq(users.id, userId), gte(users.aiPoints, points)))
      .returning({ aiPoints: users.aiPoints });
    return result[0]?.aiPoints ?? null;
  }

  async addAiPoints(userId: string, points: number): Promise<number> {
    const result = await db
      .update(users)
      .set({ aiPoints: sql`${users.aiPoints} + ${points}` })
      .where(eq(users.id, userId))
      .returning({ aiPoints: users.aiPoints });
    return result[0]?.aiPoints ?? 0;
  }

  async isStripeSessionProcessed(stripeSessionId: string): Promise<boolean> {
    const result = await db.select({ id: aiPointTransactions.id }).from(aiPointTransactions).where(eq(aiPointTransactions.stripeSessionId, stripeSessionId));
    return result.length > 0;
  }

  async recordPointTransaction(data: { userId: string; type: string; points: number; amountTwd?: number | null; stripeSessionId?: string | null }): Promise<AiPointTransaction> {
    const result = await db.insert(aiPointTransactions).values({
      userId: data.userId,
      type: data.type,
      points: data.points,
      amountTwd: data.amountTwd ?? null,
      stripeSessionId: data.stripeSessionId ?? null,
    }).returning();
    return result[0];
  }

  // 交易記錄 + 加點在同一個 DB transaction 中完成（冪等 + 一致性）
  // 回傳 { points: 新餘額, alreadyProcessed }。session 已處理時不重複入點。
  async creditPointPurchase(data: { userId: string; points: number; amountTwd: number; stripeSessionId: string }): Promise<{ points: number; alreadyProcessed: boolean }> {
    return await db.transaction(async (tx) => {
      const inserted = await tx
        .insert(aiPointTransactions)
        .values({
          userId: data.userId,
          type: "purchase",
          points: data.points,
          amountTwd: data.amountTwd,
          stripeSessionId: data.stripeSessionId,
        })
        .onConflictDoNothing({ target: aiPointTransactions.stripeSessionId })
        .returning({ id: aiPointTransactions.id });

      if (inserted.length === 0) {
        const current = await tx.select({ aiPoints: users.aiPoints }).from(users).where(eq(users.id, data.userId));
        return { points: current[0]?.aiPoints ?? 0, alreadyProcessed: true };
      }

      const updated = await tx
        .update(users)
        .set({ aiPoints: sql`${users.aiPoints} + ${data.points}` })
        .where(eq(users.id, data.userId))
        .returning({ aiPoints: users.aiPoints });
      return { points: updated[0]?.aiPoints ?? 0, alreadyProcessed: false };
    });
  }

  // 查詢某 Stripe session 的交易擁有者（用於授權檢查，避免 session 探測）
  async getPointTransactionOwner(stripeSessionId: string): Promise<string | null> {
    const result = await db.select({ userId: aiPointTransactions.userId }).from(aiPointTransactions).where(eq(aiPointTransactions.stripeSessionId, stripeSessionId));
    return result[0]?.userId ?? null;
  }

  // Webinars
  async createWebinar(data: InsertWebinar): Promise<Webinar> {
    const result = await db.insert(webinars).values(data as any).returning();
    return result[0];
  }

  async getWebinar(id: string): Promise<Webinar | undefined> {
    const result = await db.select().from(webinars).where(eq(webinars.id, id));
    return result[0];
  }

  async getAllWebinars(): Promise<Webinar[]> {
    return db.select().from(webinars).orderBy(desc(webinars.createdAt));
  }

  async getWebinarsByUser(userId: string): Promise<Webinar[]> {
    return db.select().from(webinars).where(eq(webinars.userId, userId)).orderBy(desc(webinars.createdAt));
  }

  async updateWebinar(id: string, data: Partial<InsertWebinar>): Promise<Webinar | undefined> {
    const result = await db.update(webinars).set(data as any).where(eq(webinars.id, id)).returning();
    return result[0];
  }

  async deleteWebinar(id: string): Promise<void> {
    // Delete in order respecting FK constraints
    // First: tables referencing polls (pollVotes)
    const webinarPolls = await db.select({ id: polls.id }).from(polls).where(eq(polls.webinarId, id));
    for (const poll of webinarPolls) {
      await db.delete(pollVotes).where(eq(pollVotes.pollId, poll.id));
    }
    // Tables referencing feedbackSurveys (feedbackResponses)
    const surveys = await db.select({ id: feedbackSurveys.id }).from(feedbackSurveys).where(eq(feedbackSurveys.webinarId, id));
    for (const survey of surveys) {
      await db.delete(feedbackResponses).where(eq(feedbackResponses.surveyId, survey.id));
    }
    // Tables referencing registrations (emailReminders, viewerProgress, questions with registrationId)
    await db.delete(emailReminders).where(eq(emailReminders.webinarId, id));
    await db.delete(viewerProgress).where(eq(viewerProgress.webinarId, id));
    await db.delete(questions).where(eq(questions.webinarId, id));
    // Now delete registrations
    await db.delete(registrations).where(eq(registrations.webinarId, id));
    // Delete other direct children
    await db.delete(scheduledMessages).where(eq(scheduledMessages.webinarId, id));
    await db.delete(fakeUsers).where(eq(fakeUsers.webinarId, id));
    await db.delete(ctaButtons).where(eq(ctaButtons.webinarId, id));
    await db.delete(polls).where(eq(polls.webinarId, id));
    await db.delete(tips).where(eq(tips.webinarId, id));
    await db.delete(feedbackSurveys).where(eq(feedbackSurveys.webinarId, id));
    await db.delete(chatMessages).where(eq(chatMessages.webinarId, id));
    await db.delete(likes).where(eq(likes.webinarId, id));
    await db.delete(webinarAnalytics).where(eq(webinarAnalytics.webinarId, id));
    await db.delete(webinarSessions).where(eq(webinarSessions.webinarId, id));
    // Finally delete the webinar
    await db.delete(webinars).where(eq(webinars.id, id));
  }

  // Registrations
  async createRegistration(data: InsertRegistration, analyticsVisitorToken?: string): Promise<Registration> {
    return db.transaction(async (tx) => {
      const result = await tx.insert(registrations).values(data).returning();
      const registration = result[0];
      await tx.insert(webinarFunnelEvents).values(
        authoritativeRegistrationFunnelEvent(registration.webinarId, registration.id, analyticsVisitorToken),
      ).onConflictDoNothing({
        target: [webinarFunnelEvents.webinarId, webinarFunnelEvents.dedupeKey],
      });
      return registration;
    });
  }

  async createRegistrationWithinMonthlyLimit(
    userId: string,
    data: InsertRegistration,
    monthlyLimit: number,
    analyticsVisitorToken?: string,
  ): Promise<Registration | null> {
    return db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`monthly-registrants:${userId}`}))`);
      const now = new Date();
      const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
      const totals = await tx
        .select({ value: count() })
        .from(registrations)
        .innerJoin(webinars, eq(registrations.webinarId, webinars.id))
        .where(and(
          eq(webinars.userId, userId),
          gte(registrations.registeredAt, monthStart),
          lt(registrations.registeredAt, nextMonth),
        ));
      if (Number(totals[0]?.value || 0) >= monthlyLimit) return null;

      const result = await tx.insert(registrations).values(data).returning();
      const registration = result[0];
      await tx.insert(webinarFunnelEvents).values(
        authoritativeRegistrationFunnelEvent(registration.webinarId, registration.id, analyticsVisitorToken),
      ).onConflictDoNothing({
        target: [webinarFunnelEvents.webinarId, webinarFunnelEvents.dedupeKey],
      });
      return registration;
    });
  }

  async getRegistration(id: string): Promise<Registration | undefined> {
    const result = await db.select().from(registrations).where(eq(registrations.id, id));
    return result[0];
  }

  async getRegistrationsByWebinar(webinarId: string): Promise<Registration[]> {
    return db.select().from(registrations).where(eq(registrations.webinarId, webinarId));
  }

  async getRegistrationByEmail(webinarId: string, email: string): Promise<Registration | undefined> {
    const result = await db.select().from(registrations)
      .where(and(eq(registrations.webinarId, webinarId), eq(registrations.email, email)));
    return result[0];
  }

  async updateRegistration(id: string, data: Partial<Registration>): Promise<Registration | undefined> {
    const result = await db.update(registrations).set(data).where(eq(registrations.id, id)).returning();
    return result[0];
  }

  // Fake Users
  async createFakeUser(data: InsertFakeUser): Promise<FakeUser> {
    const result = await db.insert(fakeUsers).values(data).returning();
    return result[0];
  }

  async getFakeUsersByWebinar(webinarId: string): Promise<FakeUser[]> {
    return db.select().from(fakeUsers).where(eq(fakeUsers.webinarId, webinarId));
  }

  async deleteFakeUser(id: string): Promise<void> {
    await db.delete(fakeUsers).where(eq(fakeUsers.id, id));
  }

  // Scheduled Messages
  async createScheduledMessage(data: InsertScheduledMessage): Promise<ScheduledMessage> {
    const result = await db.insert(scheduledMessages).values(data).returning();
    return result[0];
  }

  async getScheduledMessagesByWebinar(webinarId: string): Promise<ScheduledMessage[]> {
    return db.select().from(scheduledMessages)
      .where(eq(scheduledMessages.webinarId, webinarId))
      .orderBy(asc(scheduledMessages.triggerTime));
  }

  async deleteScheduledMessage(id: string): Promise<void> {
    await db.delete(scheduledMessages).where(eq(scheduledMessages.id, id));
  }

  // CTA Buttons
  async createCtaButton(data: InsertCtaButton): Promise<CtaButton> {
    // Client input never controls the stable analytics key.
    const ctaKey = crypto.randomBytes(18).toString("base64url");
    const result = await db.insert(ctaButtons).values({ ...data, ctaKey }).returning();
    return result[0];
  }

  async getCtaButtonsByWebinar(webinarId: string): Promise<CtaButton[]> {
    return db.select().from(ctaButtons)
      .where(eq(ctaButtons.webinarId, webinarId))
      .orderBy(asc(ctaButtons.startTime));
  }

  async deleteCtaButton(id: string): Promise<void> {
    await db.delete(ctaButtons).where(eq(ctaButtons.id, id));
  }

  // Tips
  async createTip(data: InsertTip): Promise<Tip> {
    const result = await db.insert(tips).values(data).returning();
    return result[0];
  }

  async getTipsByWebinar(webinarId: string): Promise<Tip[]> {
    return db.select().from(tips)
      .where(eq(tips.webinarId, webinarId))
      .orderBy(asc(tips.triggerTime));
  }

  async deleteTip(id: string): Promise<void> {
    await db.delete(tips).where(eq(tips.id, id));
  }

  // Polls
  async createPoll(data: InsertPoll): Promise<Poll> {
    const result = await db.insert(polls).values({
      ...data,
      options: data.options as string[]
    }).returning();
    return result[0];
  }

  async getPollsByWebinar(webinarId: string): Promise<Poll[]> {
    return db.select().from(polls)
      .where(eq(polls.webinarId, webinarId))
      .orderBy(asc(polls.triggerTime));
  }

  async getPoll(id: string): Promise<Poll | undefined> {
    const result = await db.select().from(polls).where(eq(polls.id, id));
    return result[0];
  }

  async deletePoll(id: string): Promise<void> {
    await db.delete(polls).where(eq(polls.id, id));
  }

  // Poll Votes
  async createPollVote(data: InsertPollVote): Promise<PollVote> {
    const result = await db.insert(pollVotes).values(data).returning();
    return result[0];
  }

  async getPollVotes(pollId: string): Promise<PollVote[]> {
    return db.select().from(pollVotes).where(eq(pollVotes.pollId, pollId));
  }

  // Questions (Q&A)
  async createQuestion(data: InsertQuestion): Promise<Question> {
    const result = await db.insert(questions).values(data).returning();
    return result[0];
  }

  async getQuestionsByWebinar(webinarId: string): Promise<Question[]> {
    return db.select().from(questions)
      .where(eq(questions.webinarId, webinarId))
      .orderBy(desc(questions.askedAt));
  }

  async getPresetQuestions(webinarId: string): Promise<Question[]> {
    return db.select().from(questions)
      .where(and(eq(questions.webinarId, webinarId), eq(questions.isPreset, true)))
      .orderBy(asc(questions.displayOrder));
  }

  async updateQuestion(id: string, data: Partial<Question>): Promise<Question | undefined> {
    const result = await db.update(questions).set(data).where(eq(questions.id, id)).returning();
    return result[0];
  }

  async deleteQuestion(id: string): Promise<void> {
    await db.delete(questions).where(eq(questions.id, id));
  }

  // Feedback Surveys
  async createFeedbackSurvey(data: InsertFeedbackSurvey): Promise<FeedbackSurvey> {
    const result = await db.insert(feedbackSurveys).values(data as any).returning();
    return result[0];
  }

  async getFeedbackSurveyByWebinar(webinarId: string): Promise<FeedbackSurvey | undefined> {
    const result = await db.select().from(feedbackSurveys)
      .where(eq(feedbackSurveys.webinarId, webinarId));
    return result[0];
  }

  async updateFeedbackSurvey(id: string, data: Partial<FeedbackSurvey>): Promise<FeedbackSurvey | undefined> {
    const result = await db.update(feedbackSurveys).set(data).where(eq(feedbackSurveys.id, id)).returning();
    return result[0];
  }

  // Feedback Responses
  async createFeedbackResponse(data: InsertFeedbackResponse): Promise<FeedbackResponse> {
    const result = await db.insert(feedbackResponses).values(data).returning();
    return result[0];
  }

  async getFeedbackResponsesBySurvey(surveyId: string): Promise<FeedbackResponse[]> {
    return db.select().from(feedbackResponses).where(eq(feedbackResponses.surveyId, surveyId));
  }

  // Viewer Progress
  async getViewerProgress(webinarId: string, sessionId: string): Promise<ViewerProgress | undefined> {
    const result = await db.select().from(viewerProgress)
      .where(and(
        eq(viewerProgress.webinarId, webinarId),
        eq(viewerProgress.viewerSessionId, sessionId)
      ));
    return result[0];
  }

  async upsertViewerProgress(data: InsertViewerProgress): Promise<ViewerProgress> {
    const existing = await this.getViewerProgress(data.webinarId, data.viewerSessionId);
    if (existing) {
      const result = await db.update(viewerProgress)
        .set({ ...data, updatedAt: new Date() } as any)
        .where(eq(viewerProgress.id, existing.id))
        .returning();
      return result[0];
    }
    const result = await db.insert(viewerProgress).values(data as any).returning();
    return result[0];
  }

  // Analytics
  async getWebinarAnalytics(webinarId: string): Promise<WebinarAnalytics[]> {
    return db.select().from(webinarAnalytics)
      .where(eq(webinarAnalytics.webinarId, webinarId))
      .orderBy(desc(webinarAnalytics.sessionDate));
  }

  async upsertWebinarAnalytics(data: InsertWebinarAnalytics): Promise<WebinarAnalytics> {
    const result = await db.insert(webinarAnalytics).values(data as any).returning();
    return result[0];
  }

  async createFunnelEvent(data: InsertWebinarFunnelEvent): Promise<{ event: WebinarFunnelEvent; deduplicated: boolean }> {
    const inserted = await db.insert(webinarFunnelEvents).values(data)
      .onConflictDoNothing({
        target: [webinarFunnelEvents.webinarId, webinarFunnelEvents.dedupeKey],
      }).returning();
    if (inserted[0]) return { event: inserted[0], deduplicated: false };
    const existing = await db.select().from(webinarFunnelEvents).where(and(
      eq(webinarFunnelEvents.webinarId, data.webinarId),
      eq(webinarFunnelEvents.dedupeKey, data.dedupeKey),
    )).limit(1);
    if (!existing[0]) throw new Error("Funnel event idempotency conflict");
    return { event: existing[0], deduplicated: true };
  }

  async getFunnelEvents(webinarId: string, from?: Date, to?: Date): Promise<WebinarFunnelEvent[]> {
    const conditions = [eq(webinarFunnelEvents.webinarId, webinarId)];
    if (from) conditions.push(gte(webinarFunnelEvents.occurredAt, from));
    if (to) conditions.push(lte(webinarFunnelEvents.occurredAt, to));
    return db.select().from(webinarFunnelEvents)
      .where(and(...conditions))
      .orderBy(asc(webinarFunnelEvents.occurredAt));
  }

  // Email Reminders
  async createEmailReminder(data: InsertEmailReminder): Promise<EmailReminder> {
    const result = await db.insert(emailReminders).values(data).returning();
    return result[0];
  }

  async getPendingEmailReminders(before: Date): Promise<EmailReminder[]> {
    return db.select().from(emailReminders)
      .where(and(
        eq(emailReminders.status, "pending"),
        lte(emailReminders.scheduledFor, before)
      ));
  }

  async updateEmailReminder(id: string, data: Partial<EmailReminder>): Promise<void> {
    await db.update(emailReminders).set(data).where(eq(emailReminders.id, id));
  }

  // Chat Messages
  async createChatMessage(data: InsertChatMessage): Promise<ChatMessage> {
    const result = await db.insert(chatMessages).values(data).returning();
    return result[0];
  }

  async getChatMessagesByWebinar(webinarId: string): Promise<ChatMessage[]> {
    return db.select().from(chatMessages)
      .where(eq(chatMessages.webinarId, webinarId))
      .orderBy(asc(chatMessages.sentAt));
  }

  async getChatMessagesBySession(webinarId: string, sessionId: string): Promise<ChatMessage[]> {
    // Viewer's own messages + host replies to them + canonical host broadcasts (sessionId=null, public)
    return db.select().from(chatMessages)
      .where(
        and(
          eq(chatMessages.webinarId, webinarId),
          or(
            eq(chatMessages.sessionId, sessionId),
            and(isNull(chatMessages.sessionId), eq(chatMessages.isPrivate, false))
          )
        )
      )
      .orderBy(asc(chatMessages.sentAt));
  }

  // Likes
  async getLikes(webinarId: string): Promise<Like | undefined> {
    const result = await db.select().from(likes).where(eq(likes.webinarId, webinarId));
    return result[0];
  }

  async incrementLikes(webinarId: string): Promise<number> {
    let existing = await this.getLikes(webinarId);
    if (!existing) {
      const result = await db.insert(likes).values({ webinarId, count: 1 }).returning();
      return result[0].count;
    }
    const result = await db.update(likes)
      .set({ count: existing.count + 1 })
      .where(eq(likes.webinarId, webinarId))
      .returning();
    return result[0].count;
  }

  // Webinar Sessions
  async createWebinarSession(data: InsertWebinarSession): Promise<WebinarSession> {
    const result = await db.insert(webinarSessions).values(data).returning();
    return result[0];
  }

  async getWebinarSessions(webinarId: string): Promise<WebinarSession[]> {
    return db.select().from(webinarSessions)
      .where(eq(webinarSessions.webinarId, webinarId))
      .orderBy(asc(webinarSessions.scheduledStart));
  }

  async getUpcomingSessions(webinarId: string): Promise<WebinarSession[]> {
    return db.select().from(webinarSessions)
      .where(and(
        eq(webinarSessions.webinarId, webinarId),
        eq(webinarSessions.status, "scheduled")
      ))
      .orderBy(asc(webinarSessions.scheduledStart));
  }

  async updateWebinarSession(id: string, data: Partial<WebinarSession>): Promise<void> {
    await db.update(webinarSessions).set(data).where(eq(webinarSessions.id, id));
  }

  async deleteWebinarSession(id: string): Promise<void> {
    await db.delete(webinarSessions).where(eq(webinarSessions.id, id));
  }

  // Webhooks
  async createWebhook(data: InsertWebhook): Promise<Webhook> {
    const result = await db.insert(webhooks).values(data).returning();
    return result[0];
  }

  async getWebhooksByWebinar(webinarId: string): Promise<Webhook[]> {
    return db.select().from(webhooks).where(eq(webhooks.webinarId, webinarId));
  }

  async getWebhooksByEvent(webinarId: string, eventType: string): Promise<Webhook[]> {
    return db.select().from(webhooks).where(
      and(eq(webhooks.webinarId, webinarId), eq(webhooks.eventType, eventType), eq(webhooks.enabled, true))
    );
  }

  async deleteWebhook(id: string): Promise<void> {
    await db.delete(webhooks).where(eq(webhooks.id, id));
  }

  async updateWebhook(id: string, data: Partial<Webhook>): Promise<Webhook | undefined> {
    const result = await db.update(webhooks).set(data).where(eq(webhooks.id, id)).returning();
    return result[0];
  }

  // Webinar Documents
  async createWebinarDocument(data: InsertWebinarDocument): Promise<WebinarDocument> {
    const result = await db.insert(webinarDocuments).values(data).returning();
    return result[0];
  }

  async getWebinarDocuments(webinarId: string): Promise<WebinarDocument[]> {
    return db.select().from(webinarDocuments)
      .where(eq(webinarDocuments.webinarId, webinarId))
      .orderBy(asc(webinarDocuments.createdAt));
  }

  async deleteWebinarDocument(webinarId: string, id: string): Promise<void> {
    await db.delete(webinarDocuments).where(
      and(eq(webinarDocuments.id, id), eq(webinarDocuments.webinarId, webinarId))
    );
  }

  // Email Sequences
  async createEmailSequence(data: InsertEmailSequence): Promise<EmailSequence> {
    const result = await db.insert(emailSequences).values(data).returning();
    return result[0];
  }

  async getEmailSequences(webinarId: string): Promise<EmailSequence[]> {
    return db.select().from(emailSequences)
      .where(eq(emailSequences.webinarId, webinarId))
      .orderBy(asc(emailSequences.sortOrder), asc(emailSequences.createdAt));
  }

  async getEnabledEmailSequences(webinarId: string): Promise<EmailSequence[]> {
    return db.select().from(emailSequences)
      .where(and(eq(emailSequences.webinarId, webinarId), eq(emailSequences.enabled, true)))
      .orderBy(asc(emailSequences.sortOrder), asc(emailSequences.createdAt));
  }

  async getEmailSequence(id: string): Promise<EmailSequence | undefined> {
    const result = await db.select().from(emailSequences).where(eq(emailSequences.id, id));
    return result[0];
  }

  async updateEmailSequence(webinarId: string, id: string, data: Partial<EmailSequence>): Promise<EmailSequence | undefined> {
    const result = await db.update(emailSequences).set(data)
      .where(and(eq(emailSequences.id, id), eq(emailSequences.webinarId, webinarId)))
      .returning();
    return result[0];
  }

  async deleteEmailSequence(webinarId: string, id: string): Promise<void> {
    await db.delete(emailSequences).where(
      and(eq(emailSequences.id, id), eq(emailSequences.webinarId, webinarId))
    );
  }

  async hasSequenceReminder(registrationId: string, sequenceId: string): Promise<boolean> {
    const result = await db.select({ id: emailReminders.id }).from(emailReminders)
      .where(and(
        eq(emailReminders.registrationId, registrationId),
        eq(emailReminders.sequenceId, sequenceId)
      ))
      .limit(1);
    return result.length > 0;
  }

  // Social Posts
  async createSocialPost(data: InsertSocialPost): Promise<SocialPost> {
    const result = await db.insert(socialPosts).values(data).returning();
    return result[0];
  }

  async getSocialPosts(webinarId: string): Promise<SocialPost[]> {
    return db.select().from(socialPosts)
      .where(eq(socialPosts.webinarId, webinarId))
      .orderBy(asc(socialPosts.scheduledFor), asc(socialPosts.createdAt));
  }

  async updateSocialPost(webinarId: string, id: string, data: Partial<SocialPost>): Promise<SocialPost | undefined> {
    const result = await db.update(socialPosts).set(data)
      .where(and(eq(socialPosts.id, id), eq(socialPosts.webinarId, webinarId)))
      .returning();
    return result[0];
  }

  async deleteSocialPost(webinarId: string, id: string): Promise<void> {
    await db.delete(socialPosts).where(
      and(eq(socialPosts.id, id), eq(socialPosts.webinarId, webinarId))
    );
  }
}

export const storage = new DatabaseStorage();
