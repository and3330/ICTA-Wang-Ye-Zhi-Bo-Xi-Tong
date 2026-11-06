import { db } from "./db";
import crypto from "node:crypto";
import { EMAIL_CLAIM_BATCH_SIZE, EMAIL_LEASE_MS } from "./emailDeliveryPolicy";
import { authoritativeRegistrationFunnelEvent } from "./funnelAnalytics";
import { eq, and, lt, lte, gt, gte, desc, asc, count, isNull, or, sql, like, inArray } from "drizzle-orm";
import {
  webinars, type InsertWebinar, type Webinar,
  entitlementOverrides, noCardTrials,
  registrations, registrationIdentityKeys, type InsertRegistration, type Registration,
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
  aiPointTransactions, aiCreditLots, aiCreditReservations, aiCreditRevocations, aiResponseArtifacts,
  salesScriptDrafts, salesScriptJobs, salesScriptJobCheckpoints, salesScriptPurchases,
  type SalesScriptJob, type SalesScriptPurchase,
  authTokens, supportFeedback, type InsertSupportFeedback, type SupportFeedback,
  webinarFunnelEvents, type InsertWebinarFunnelEvent, type WebinarFunnelEvent,
  webinarOffers, webinarPayments, type WebinarOffer,
  offerSalesPages, type OfferSalesPage, type InsertOfferSalesPage,
  webinarLandingPages, type WebinarLandingPage, type InsertWebinarLandingPage,
  courseMarketplaceListings,
} from "@shared/schema";
import type { SalesScriptOutput } from "@shared/salesScript";
import { START_REMINDERS } from "@shared/email-reminders";

export class SalesScriptIdempotencyConflictError extends Error {
  constructor() {
    super("Idempotency key body does not match its original request");
  }
}

export async function lockCourseMarketplace(tx: any, webinarId: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"course-marketplace:" + webinarId}))`);
}

export async function invalidateCourseMarketplaceListing(tx: any, webinarId: string) {
  await tx.update(courseMarketplaceListings).set({
    status: "pending", reviewedAt: null, reviewedBy: null, approvedAt: null,
    rejectionReason: null, version: sql`${courseMarketplaceListings.version} + 1`, updatedAt: new Date(),
  }).where(and(eq(courseMarketplaceListings.webinarId, webinarId), eq(courseMarketplaceListings.status, "approved"), eq(courseMarketplaceListings.optedIn, true)));
}

// A shared development database must never allow test workers to claim normal
// work. The scope is generated entirely on the server and is not client input.
export const salesScriptQueueScope = process.env.NODE_ENV === "test"
  ? `test-${process.pid}`
  : "app";

function canonicalSalesScriptAnswers(answers: Record<string, string>) {
  const canonical = JSON.stringify(Object.fromEntries(Object.entries(answers).sort(([a], [b]) => a.localeCompare(b))));
  return crypto.createHash("sha256").update(canonical).digest("hex");
}

export function allocateAiCreditLots(
  lots: Array<{ id: string; remainingPoints: number }>,
  points: number,
): Array<{ lotId: string; points: number }> | null {
  const available = lots.reduce((sum, lot) => sum + lot.remainingPoints, 0);
  if (available < points) return null;
  let needed = points;
  const allocations: Array<{ lotId: string; points: number }> = [];
  for (const lot of lots) {
    if (needed <= 0) break;
    const used = Math.min(needed, lot.remainingPoints);
    allocations.push({ lotId: lot.id, points: used });
    needed -= used;
  }
  return allocations;
}

export function annualGrantRevocationKeys(
  lots: Array<{ idempotencyKey: string | null }>,
): string[] {
  return lots.flatMap((lot) => lot.idempotencyKey ? [lot.idempotencyKey] : []);
}

export function partitionCtasForReplacement(oldCtaIds: string[], paymentCtaIds: Array<string | null>) {
  const referenced = new Set(paymentCtaIds.filter((id): id is string => Boolean(id)));
  return {
    retireIds: oldCtaIds.filter((id) => referenced.has(id)),
    deleteIds: oldCtaIds.filter((id) => !referenced.has(id)),
  };
}

function salesPageOwnedByWebinar(webinarId: string) {
  return sql`COALESCE(
    ${offerSalesPages.userId},
    (SELECT owned_offer.user_id FROM webinar_offers owned_offer WHERE owned_offer.id = ${offerSalesPages.offerId}),
    (SELECT owner_webinar.user_id
       FROM webinar_offers owned_offer
       JOIN webinars owner_webinar ON owner_webinar.id = owned_offer.webinar_id
      WHERE owned_offer.id = ${offerSalesPages.offerId}),
    (SELECT page_webinar.user_id FROM webinars page_webinar WHERE page_webinar.id = ${offerSalesPages.webinarId})
  ) = (SELECT source_webinar.user_id FROM webinars source_webinar WHERE source_webinar.id = ${webinarId})
  AND (SELECT source_webinar.user_id FROM webinars source_webinar WHERE source_webinar.id = ${webinarId}) IS NOT NULL`;
}

export interface IStorage {
  // Users (Admin)
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  listAllUsers(): Promise<User[]>;
  updateUser(id: string, data: Partial<Omit<User, "id" | "password" | "createdAt">>): Promise<User | undefined>;
  getWebinarCountByUser(userId: string): Promise<number>;
  getPublishedWebinarCountByUser(userId: string): Promise<number>;
  publishWebinarWithinLimit(userId: string, webinarId: string): Promise<{ webinar?: Webinar; limitExceeded: boolean; entitlementExpired?: boolean; maxPublished?: number }>;
  getUserByStripeCustomerId(stripeCustomerId: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  createAuthToken(userId: string, purpose: string, tokenHash: string, expiresAt: Date): Promise<void>;
  getLatestAuthTokenCreatedAt(userId: string, purpose: string): Promise<Date | null>;
  consumeEmailVerificationCode(userId: string, tokenHash: string): Promise<boolean>;
  resetPasswordWithToken(tokenHash: string, passwordHash: string): Promise<boolean>;
  createSupportFeedback(userId: string, data: InsertSupportFeedback): Promise<SupportFeedback>;
  listSupportFeedback(): Promise<SupportFeedback[]>;
  updateSupportFeedback(id: string, data: { status?: string; adminNote?: string | null }): Promise<SupportFeedback | undefined>;
  // AI 點數
  reserveAiCredits(userId: string, points: number): Promise<{ reservationId: string; remaining: number } | null>;
  finalizeAiCreditReservation(reservationId: string): Promise<void>;
  persistAiChatResponse(data: { reservationId: string; userId: string; webinarId: string; sessionId: string; teacherName: string; requestText: string; responseText: string }): Promise<ChatMessage>;
  persistAiArtifactAndConsume(data: { reservationId: string; userId: string; webinarId: string; kind: string; requestText: string; responseText: string }): Promise<void>;
  persistGeneratedInteractions(data: { reservationId: string | null; userId: string; webinarId: string; replace: boolean; requestText: string; result: any }): Promise<{ fakeUsers: number; messages: number; polls: number; tips: number; ctas: number }>;
  persistGeneratedEmailSequences(data: { reservationId: string | null; userId: string; webinarId: string; replace: boolean; requestText: string; emails: any[] }): Promise<EmailSequence[]>;
  persistGeneratedSocialPosts(data: { reservationId: string | null; userId: string; webinarId: string; replace: boolean; requestText: string; posts: any[] }): Promise<SocialPost[]>;
  refundAiCreditReservation(reservationId: string): Promise<void>;
  getAiCreditSummary(userId: string): Promise<{ points: number; giftedPoints: number; permanentPoints: number; nextExpiry: Date | null; nextExpiryPoints: number }>;
  grantAiCredits(data: { userId: string; points: number; source: "monthly_gift" | "admin_grant"; grantedAt?: Date; expiresAt?: Date | null; idempotencyKey?: string | null }): Promise<{ added: boolean; points: number }>;
  revokeUnusedAiCreditsByPrefix(userId: string, idempotencyKeyPrefix: string): Promise<number>;
  revokeAiCreditSource(userId: string, idempotencyKey: string): Promise<number>;
  reconcileAnnualAiCredits(data: {
    userId: string;
    idempotencyKeyPrefix: string;
    grants: Array<{ points: number; grantedAt: Date; expiresAt: Date; idempotencyKey: string }>;
    verifyPayment: () => Promise<boolean>;
  }): Promise<{ valid: boolean; added: number; revoked: number }>;
  creditPointPurchase(data: { userId: string; points: number; amountTwd: number; stripeSessionId: string }): Promise<{ points: number; alreadyProcessed: boolean }>;
  getPointTransactionOwner(stripeSessionId: string): Promise<string | null>;
  saveSalesScriptDraft(data: { ownerId: string; webinarId: string; answers: Record<string, string> }): Promise<void>;
  getSalesScriptDraft(ownerId: string, webinarId: string): Promise<{ answers: Record<string, string>; updatedAt: Date } | null>;
  getSalesScriptJobs(ownerId: string, webinarId: string): Promise<SalesScriptJob[]>;
  getSalesScriptJob(ownerId: string, webinarId: string, jobId: string): Promise<SalesScriptJob | null>;
  getSalesScriptPurchaseState(ownerId: string, webinarId: string): Promise<{
    purchase: SalesScriptPurchase | null; jobId: string | null; hasPurchasedAccess: boolean; canGenerate: boolean;
  }>;
  purchaseSalesScript(data: {
    ownerId: string; webinarId: string; idempotencyKey: string; basicAnswers: Record<string, string>; points: number;
  }): Promise<{ purchase: SalesScriptPurchase; jobId: string | null; created: boolean } | null>;
  attachSalesScriptPurchaseToJob(data: {
    ownerId: string; webinarId: string; purchaseId: string; idempotencyKey: string; answers: Record<string, string>;
  }): Promise<{ job: SalesScriptJob; created: boolean } | null>;
  admitSalesScriptJob(data: { ownerId: string; webinarId: string; idempotencyKey: string; answers: Record<string, string>; points: number }): Promise<{ job: SalesScriptJob; created: boolean } | null>;
  claimNextSalesScriptJob(leaseToken: string, leaseExpiresAt: Date): Promise<SalesScriptJob | null>;
  renewSalesScriptJobLease(data: { jobId: string; leaseToken: string; leaseExpiresAt: Date }): Promise<boolean>;
  saveSalesScriptCheckpoint(data: { jobId: string; leaseToken: string; stage: number; section: SalesScriptOutput["sections"][number] }): Promise<boolean>;
  completeSalesScriptJob(data: { jobId: string; ownerId: string; reservationId: string; leaseToken: string; result: SalesScriptOutput }): Promise<boolean>;
  failSalesScriptJob(data: { jobId: string; ownerId: string; reservationId: string; leaseToken?: string; message: string }): Promise<boolean>;
  
  // Webinars
  createWebinar(data: InsertWebinar): Promise<Webinar>;
  createAiWizardWebinar(data: {
    webinar: InsertWebinar;
    reservationId?: string | null;
    knowledge: string;
    interactions: {
      fakeUsers: string[];
      messages: { name: string; message: string; triggerTime: number }[];
      polls: { question: string; options: string[]; triggerTime: number }[];
      tips: { title: string; content: string; triggerTime: number; icon: string }[];
      ctas: { text: string; url: string; startTime: number }[];
    };
    emails: { name: string; segment: string; delayMinutes: number; subject: string; htmlBody: string }[];
  }): Promise<Webinar>;
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
  getRegistrationsByWebinarPage(webinarId: string, limit: number, offset: number): Promise<{ registrations: Registration[]; total: number }>;
  getFunnelEventsByRegistration(webinarId: string, registrationId: string): Promise<WebinarFunnelEvent[]>;
  getFunnelEventsByRegistrations(webinarId: string, registrationIds: string[]): Promise<WebinarFunnelEvent[]>;
  getRegistrationByEmail(webinarId: string, email: string): Promise<Registration | undefined>;
  bulkUpdateRegistrations(webinarId: string, ids: string[], action: "archive" | "unarchive" | "delete"): Promise<number>;
  updateRegistration(id: string, data: Partial<Registration>): Promise<Registration | undefined>;
  updateRegistrationForWebinar(webinarId: string, id: string, data: Partial<Registration>): Promise<Registration | undefined>;
  
  // Fake Users
  createFakeUser(data: InsertFakeUser): Promise<FakeUser>;
  getFakeUsersByWebinar(webinarId: string): Promise<FakeUser[]>;
  deleteFakeUser(webinarId: string, id: string): Promise<boolean>;
  updateFakeUser(webinarId: string, id: string, data: { name?: string; avatar?: string | null }): Promise<FakeUser | undefined>;
  
  // Scheduled Messages
  createScheduledMessage(data: InsertScheduledMessage): Promise<ScheduledMessage>;
  getScheduledMessagesByWebinar(webinarId: string): Promise<ScheduledMessage[]>;
  deleteScheduledMessage(webinarId: string, id: string): Promise<boolean>;
  updateScheduledMessage(webinarId: string, id: string, data: { fakeUserId?: string; message?: string; triggerTime?: number }): Promise<ScheduledMessage | undefined>;
  
  // CTA Buttons
  createWebinarOffer(data: typeof webinarOffers.$inferInsert): Promise<WebinarOffer>;
  getWebinarOffers(webinarId: string): Promise<WebinarOffer[]>;
  getWebinarOffer(id: string): Promise<WebinarOffer | undefined>;
  deactivateWebinarOffer(webinarId: string, id: string): Promise<WebinarOffer | undefined>;
  listOfferSalesPages(webinarId: string): Promise<OfferSalesPage[]>;
  getOfferSalesPage(webinarId: string, pageId: string): Promise<OfferSalesPage | undefined>;
  createOfferSalesPage(data: InsertOfferSalesPage): Promise<OfferSalesPage>;
  updateOfferSalesPage(
    webinarId: string,
    pageId: string,
    version: number,
    data: Partial<Pick<OfferSalesPage, "title" | "slug" | "orderedBlocks" | "checkoutSettings">>,
  ): Promise<OfferSalesPage | undefined>;
  setOfferSalesPageStatus(
    webinarId: string,
    pageId: string,
    version: number,
    status: "draft" | "published",
  ): Promise<OfferSalesPage | undefined>;
  deleteOfferSalesPage(webinarId: string, pageId: string): Promise<boolean>;
  getPublicOfferSalesPage(slug: string): Promise<{ page: OfferSalesPage; offer: WebinarOffer } | undefined>;
  getPublishedSalesPageCheckoutContext(
    webinarId: string,
    offerId: string,
    salesPageId: string,
  ): Promise<{ page: OfferSalesPage; offer: WebinarOffer } | undefined>;
  getWebinarLandingPage(webinarId: string): Promise<WebinarLandingPage | undefined>;
  createWebinarLandingPage(data: InsertWebinarLandingPage): Promise<WebinarLandingPage>;
  updateWebinarLandingPage(webinarId: string, version: number, data: Partial<Pick<WebinarLandingPage, "title" | "blocks" | "brandSettings">>): Promise<WebinarLandingPage | undefined>;
  setWebinarLandingPageStatus(webinarId: string, version: number, status: "draft" | "published"): Promise<WebinarLandingPage | undefined>;
  getPublicWebinarLandingPage(webinarId: string): Promise<WebinarLandingPage | undefined>;
  createCtaButton(data: InsertCtaButton): Promise<CtaButton>;
  createLiveCtaButton(data: InsertCtaButton, expiresAt: Date): Promise<CtaButton>;
  getCtaButtonsByWebinar(webinarId: string): Promise<CtaButton[]>;
  deleteCtaButton(webinarId: string, id: string): Promise<boolean>;
  
  // Tips
  createTip(data: InsertTip): Promise<Tip>;
  getTipsByWebinar(webinarId: string): Promise<Tip[]>;
  deleteTip(webinarId: string, id: string): Promise<boolean>;
  updateTip(webinarId: string, id: string, data: Partial<InsertTip>): Promise<Tip | undefined>;
  
  // Polls
  createPoll(data: InsertPoll): Promise<Poll>;
  getPollsByWebinar(webinarId: string): Promise<Poll[]>;
  getPoll(id: string): Promise<Poll | undefined>;
  deletePoll(webinarId: string, id: string): Promise<boolean>;
  updatePoll(webinarId: string, id: string, data: Partial<InsertPoll>): Promise<Poll | undefined>;
  
  // Poll Votes
  createPollVote(data: InsertPollVote): Promise<PollVote>;
  getPollVotes(pollId: string): Promise<PollVote[]>;
  
  // Questions (Q&A)
  createQuestion(data: InsertQuestion): Promise<Question>;
  getQuestionsByWebinar(webinarId: string): Promise<Question[]>;
  getPresetQuestions(webinarId: string): Promise<Question[]>;
  updateQuestion(webinarId: string, id: string, data: Partial<Question>): Promise<Question | undefined>;
  deleteQuestion(webinarId: string, id: string): Promise<boolean>;
  
  // Feedback Surveys
  createFeedbackSurvey(data: InsertFeedbackSurvey): Promise<FeedbackSurvey>;
  getFeedbackSurveyByWebinar(webinarId: string): Promise<FeedbackSurvey | undefined>;
  getFeedbackSurvey(id: string): Promise<FeedbackSurvey | undefined>;
  updateFeedbackSurvey(webinarId: string, id: string, data: Partial<FeedbackSurvey>): Promise<FeedbackSurvey | undefined>;
  
  // Feedback Responses
  createFeedbackResponse(data: InsertFeedbackResponse): Promise<FeedbackResponse>;
  getFeedbackResponsesBySurvey(surveyId: string): Promise<FeedbackResponse[]>;
  
  // Viewer Progress
  getViewerProgress(webinarId: string, sessionId: string): Promise<ViewerProgress | undefined>;
  getLatestViewerProgressForRegistration(webinarId: string, registrationId: string): Promise<ViewerProgress | undefined>;
  upsertViewerProgress(data: InsertViewerProgress): Promise<ViewerProgress>;
  
  // Analytics
  getWebinarAnalytics(webinarId: string): Promise<WebinarAnalytics[]>;
  upsertWebinarAnalytics(data: InsertWebinarAnalytics): Promise<WebinarAnalytics>;
  createFunnelEvent(data: InsertWebinarFunnelEvent): Promise<{ event: WebinarFunnelEvent; deduplicated: boolean }>;
  getFunnelEvents(webinarId: string, from?: Date, to?: Date): Promise<WebinarFunnelEvent[]>;
  
  // Email Reminders
  createEmailReminder(data: InsertEmailReminder): Promise<EmailReminder>;
  enqueueUpcomingStartReminders(now: Date): Promise<number>;
  hasAttendedSession(registration: Registration): Promise<boolean>;
  getPendingEmailReminders(before: Date): Promise<EmailReminder[]>;
  claimPendingEmailReminders(before: Date, leaseToken: string, limit?: number): Promise<EmailReminder[]>;
  updateEmailReminder(id: string, data: Partial<EmailReminder>): Promise<void>;
  updateClaimedEmailReminder(id: string, leaseToken: string, data: Partial<EmailReminder>): Promise<boolean>;
  renewClaimedEmailReminder(id: string, leaseToken: string, leaseExpiresAt: Date): Promise<boolean>;
  enqueueDueSequenceReminders(before: Date, limit?: number): Promise<number>;
  
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
  deleteWebinarSession(webinarId: string, id: string): Promise<boolean>;
  moveWebinarSession(webinarId: string, id: string, data: { scheduledStart: Date }): Promise<WebinarSession | undefined>;
  
  // Webhooks
  createWebhook(data: InsertWebhook): Promise<Webhook>;
  getWebhooksByWebinar(webinarId: string): Promise<Webhook[]>;
  getWebhooksByEvent(webinarId: string, eventType: string): Promise<Webhook[]>;
  deleteWebhook(webinarId: string, id: string): Promise<boolean>;
  updateWebhook(webinarId: string, id: string, data: Partial<Webhook>): Promise<Webhook | undefined>;

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
): Promise<{ webinarId?: string; limitExceeded: boolean; entitlementExpired?: boolean; maxPublished?: number }> {
  return database.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${userId}))`);
    // Publication and moderation share this lock. Even an idempotent
    // "publish" request is treated as a fresh public release and must be
    // reviewed again before it can return to the course marketplace.
    await lockCourseMarketplace(tx, webinarId);
    // Lock every row that can reduce publication capacity. Concurrent expiry,
    // revocation, suspension, or deletion then has a clear order relative to
    // this publication instead of allowing a stale preflight decision.
    const [owner] = await tx.select({
      isActive: users.isActive,
      isSuperAdmin: users.isSuperAdmin,
      subscriptionPlan: users.subscriptionPlan,
      subscriptionStatus: users.subscriptionStatus,
      planExpiresAt: users.planExpiresAt,
      maxWebinars: users.maxWebinars,
    }).from(users).where(eq(users.id, userId)).for("update");
    const overrides = await tx.select({
      publishingSlots: entitlementOverrides.publishingSlots,
      startsAt: entitlementOverrides.startsAt,
      expiresAt: entitlementOverrides.expiresAt,
      revokedAt: entitlementOverrides.revokedAt,
    }).from(entitlementOverrides)
      .where(eq(entitlementOverrides.userId, userId)).for("update");
    const [trial] = await tx.select({
      startsAt: noCardTrials.startsAt,
      expiresAt: noCardTrials.expiresAt,
    }).from(noCardTrials)
      .where(eq(noCardTrials.userId, userId)).for("update");
    // Unlike now(), clock_timestamp() advances while this transaction waits
    // for the advisory lock, so a trial that expires during the wait fails.
    const clock = await tx.execute(sql`select clock_timestamp() as now`);
    const now = new Date(String(clock.rows[0]?.now));
    const paidCapacity = owner?.isActive && (
      owner.isSuperAdmin || owner.subscriptionPlan === "enterprise"
        ? true
        : ["active", "trialing"].includes(owner.subscriptionStatus)
          && (!owner.planExpiresAt || owner.planExpiresAt.getTime() > now.getTime())
    ) ? (owner.isSuperAdmin || owner.subscriptionPlan === "enterprise" ? 999 : owner.maxWebinars) : 0;
    const overrideCapacity = owner?.isActive
      ? overrides.reduce((capacity, override) => (
          !override.revokedAt
          && override.startsAt.getTime() <= now.getTime()
          && override.expiresAt.getTime() > now.getTime()
            ? Math.max(capacity, override.publishingSlots)
            : capacity
        ), 0)
      : 0;
    const trialCapacity = owner?.isActive && trial
      && trial.startsAt.getTime() <= now.getTime()
      && trial.expiresAt.getTime() > now.getTime()
      ? 1
      : 0;
    const maxPublished = Math.max(paidCapacity, overrideCapacity, trialCapacity);
    if (maxPublished < 1) {
      return { webinarId: undefined, limitExceeded: false, entitlementExpired: true, maxPublished: 0 };
    }
    const existing = await tx
      .select({ id: webinars.id, publishStatus: webinars.publishStatus })
      .from(webinars)
      .where(and(eq(webinars.id, webinarId), eq(webinars.userId, userId)));
    if (!existing[0]) return { webinarId: undefined, limitExceeded: false };
    if (existing[0].publishStatus === "published") {
      await invalidateCourseMarketplaceListing(tx, webinarId);
      return { webinarId: existing[0].id, limitExceeded: false, maxPublished };
    }

    const result = await tx
      .select({ value: count() })
      .from(webinars)
      .where(and(eq(webinars.userId, userId), eq(webinars.publishStatus, "published")));
    if ((result[0]?.value || 0) >= maxPublished) {
      return { webinarId: undefined, limitExceeded: true, maxPublished };
    }

    const updated = await tx
      .update(webinars)
      .set({ publishStatus: "published" })
      .where(and(eq(webinars.id, webinarId), eq(webinars.userId, userId)))
      .returning({ id: webinars.id });
    if (updated[0]) await invalidateCourseMarketplaceListing(tx, webinarId);
    return { webinarId: updated[0]?.id, limitExceeded: false, maxPublished };
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
    return db.transaction(async (tx) => {
      const [user] = await tx.insert(users).values(data).returning();
      if (user.aiPoints > 0) {
        await tx.insert(aiCreditLots).values({
          userId: user.id,
          source: "legacy",
          originalPoints: user.aiPoints,
          remainingPoints: user.aiPoints,
          expiresAt: null,
          idempotencyKey: `signup:${user.id}`,
        });
      }
      return user;
    });
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

  async publishWebinarWithinLimit(userId: string, webinarId: string): Promise<{ webinar?: Webinar; limitExceeded: boolean; entitlementExpired?: boolean; maxPublished?: number }> {
    const result = await claimWebinarPublicationWithinLimit(db, userId, webinarId);
    if (!result.webinarId) return { webinar: undefined, limitExceeded: result.limitExceeded, entitlementExpired: result.entitlementExpired, maxPublished: result.maxPublished };
    return { webinar: await this.getWebinar(result.webinarId), limitExceeded: false, maxPublished: result.maxPublished };
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

  async consumeEmailVerificationCode(userId: string, tokenHash: string): Promise<boolean> {
    return db.transaction(async (tx) => {
      const token = await tx.update(authTokens).set({ consumedAt: new Date() })
        .where(and(
          eq(authTokens.userId, userId),
          eq(authTokens.tokenHash, tokenHash),
          eq(authTokens.purpose, "email_verification"),
          isNull(authTokens.consumedAt),
          gt(authTokens.expiresAt, new Date()),
        )).returning({ userId: authTokens.userId });
      if (!token[0]) return false;
      await tx.update(users).set({ emailVerifiedAt: new Date() }).where(eq(users.id, userId));
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

  async getAiCreditSummary(userId: string) {
    const now = new Date();
    const activeLots = await db.select().from(aiCreditLots).where(and(
      eq(aiCreditLots.userId, userId),
      gt(aiCreditLots.remainingPoints, 0),
      or(isNull(aiCreditLots.expiresAt), gt(aiCreditLots.expiresAt, now)),
    ));
    const gifted = activeLots.filter((lot) => lot.source === "monthly_gift");
    const expiring = gifted.filter((lot) => lot.expiresAt)
      .sort((a, b) => a.expiresAt!.getTime() - b.expiresAt!.getTime());
    return {
      points: activeLots.reduce((sum, lot) => sum + lot.remainingPoints, 0),
      giftedPoints: gifted.reduce((sum, lot) => sum + lot.remainingPoints, 0),
      permanentPoints: activeLots.filter((lot) => lot.source !== "monthly_gift")
        .reduce((sum, lot) => sum + lot.remainingPoints, 0),
      nextExpiry: expiring[0]?.expiresAt || null,
      nextExpiryPoints: expiring[0]?.remainingPoints || 0,
    };
  }

  async saveSalesScriptDraft(data: { ownerId: string; webinarId: string; answers: Record<string, string> }): Promise<void> {
    await db.insert(salesScriptDrafts).values(data).onConflictDoUpdate({
      target: salesScriptDrafts.webinarId,
      set: { ownerId: data.ownerId, answers: data.answers, updatedAt: new Date() },
    });
  }

  async getSalesScriptDraft(ownerId: string, webinarId: string) {
    const [draft] = await db.select({
      answers: salesScriptDrafts.answers,
      updatedAt: salesScriptDrafts.updatedAt,
    }).from(salesScriptDrafts).where(and(
      eq(salesScriptDrafts.ownerId, ownerId),
      eq(salesScriptDrafts.webinarId, webinarId),
    )).limit(1);
    return draft || null;
  }

  async getSalesScriptJobs(ownerId: string, webinarId: string): Promise<SalesScriptJob[]> {
    return db.select().from(salesScriptJobs).where(and(
      eq(salesScriptJobs.ownerId, ownerId),
      eq(salesScriptJobs.webinarId, webinarId),
    )).orderBy(desc(salesScriptJobs.createdAt));
  }

  async getSalesScriptJob(ownerId: string, webinarId: string, jobId: string): Promise<SalesScriptJob | null> {
    const [job] = await db.select().from(salesScriptJobs).where(and(
      eq(salesScriptJobs.id, jobId),
      eq(salesScriptJobs.ownerId, ownerId),
      eq(salesScriptJobs.webinarId, webinarId),
    )).limit(1);
    return job || null;
  }

  async getSalesScriptPurchaseState(ownerId: string, webinarId: string) {
    const purchases = await db.select().from(salesScriptPurchases).where(and(
      eq(salesScriptPurchases.ownerId, ownerId),
      eq(salesScriptPurchases.webinarId, webinarId),
    )).orderBy(desc(salesScriptPurchases.createdAt));
    const purchase = purchases.find((item) => item.status === "ready" || item.status === "generating") || purchases[0] || null;
    const jobs = await this.getSalesScriptJobs(ownerId, webinarId);
    const jobReservations = jobs.length
      ? await db.select({ id: aiCreditReservations.id, status: aiCreditReservations.status })
        .from(aiCreditReservations).where(inArray(aiCreditReservations.id, jobs.map((job) => job.reservationId)))
      : [];
    const reservationStatuses = new Map(jobReservations.map((item) => [item.id, item.status]));
    const jobForPurchase = purchase
      ? jobs.find((job) => job.purchaseId === purchase.id) || null
      : null;
    const reservation = purchase
      ? (await db.select({ status: aiCreditReservations.status }).from(aiCreditReservations)
        .where(eq(aiCreditReservations.id, purchase.reservationId)).limit(1))[0]
      : null;
    const activePurchaseAccess = Boolean(
      purchase
      && (purchase.status === "ready" || purchase.status === "generating")
      && reservation?.status === "reserved",
    );
    // Jobs created before purchases were already charged at admission. They
    // retain access while in progress and forever after successful completion.
    const historicalAccess = jobs.some((job) => (
      (job.status === "completed" && reservationStatuses.get(job.reservationId) === "consumed")
      || ((job.status === "queued" || job.status === "running") && reservationStatuses.get(job.reservationId) === "reserved")
    ));
    return {
      purchase,
      jobId: jobForPurchase?.id || null,
      hasPurchasedAccess: activePurchaseAccess || historicalAccess,
      canGenerate: Boolean(purchase && purchase.status === "ready" && reservation?.status === "reserved" && !jobForPurchase),
    };
  }

  async purchaseSalesScript(data: {
    ownerId: string; webinarId: string; idempotencyKey: string; basicAnswers: Record<string, string>; points: number;
  }): Promise<{ purchase: SalesScriptPurchase; jobId: string | null; created: boolean } | null> {
    if (!Number.isInteger(data.points) || data.points <= 0) throw new Error("Invalid credit reservation");
    return db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`ai-credits:${data.ownerId}`}))`);
      const [sameKey] = await tx.select().from(salesScriptPurchases).where(and(
        eq(salesScriptPurchases.ownerId, data.ownerId),
        eq(salesScriptPurchases.idempotencyKey, data.idempotencyKey),
      )).for("update");
      if (sameKey) {
        if (sameKey.webinarId !== data.webinarId
          || sameKey.costPoints !== data.points
          || canonicalSalesScriptAnswers(sameKey.basicAnswers) !== canonicalSalesScriptAnswers(data.basicAnswers)) {
          throw new SalesScriptIdempotencyConflictError();
        }
        const [job] = await tx.select({ id: salesScriptJobs.id }).from(salesScriptJobs)
          .where(eq(salesScriptJobs.purchaseId, sameKey.id)).limit(1);
        return { purchase: sameKey, jobId: job?.id || null, created: false };
      }
      const [active] = await tx.select().from(salesScriptPurchases).where(and(
        eq(salesScriptPurchases.ownerId, data.ownerId),
        eq(salesScriptPurchases.webinarId, data.webinarId),
        or(eq(salesScriptPurchases.status, "ready"), eq(salesScriptPurchases.status, "generating")),
      )).for("update");
      if (active) {
        const [reservation] = await tx.select({ status: aiCreditReservations.status }).from(aiCreditReservations)
          .where(eq(aiCreditReservations.id, active.reservationId)).for("update");
        if (reservation?.status === "reserved") {
          const [job] = await tx.select({ id: salesScriptJobs.id }).from(salesScriptJobs)
            .where(eq(salesScriptJobs.purchaseId, active.id)).limit(1);
          return { purchase: active, jobId: job?.id || null, created: false };
        }
        await tx.update(salesScriptPurchases).set({ status: "refunded", updatedAt: new Date(), completedAt: new Date() })
          .where(eq(salesScriptPurchases.id, active.id));
      }
      const now = new Date();
      const stale = await tx.select().from(aiCreditReservations).where(and(
        eq(aiCreditReservations.userId, data.ownerId),
        eq(aiCreditReservations.status, "reserved"),
        lt(aiCreditReservations.createdAt, new Date(now.getTime() - 15 * 60_000)),
      )).for("update");
      for (const reservation of stale) {
        const [protectedPurchase] = await tx.select({ id: salesScriptPurchases.id }).from(salesScriptPurchases).where(and(
          eq(salesScriptPurchases.reservationId, reservation.id),
          or(eq(salesScriptPurchases.status, "ready"), eq(salesScriptPurchases.status, "generating")),
        )).limit(1);
        if (protectedPurchase) continue;
        const [salesJob] = await tx.select({ status: salesScriptJobs.status }).from(salesScriptJobs)
          .where(eq(salesScriptJobs.reservationId, reservation.id)).limit(1);
        if (salesJob && (salesJob.status === "queued" || salesJob.status === "running")) continue;
        const [artifact] = await tx.select({ id: aiResponseArtifacts.id }).from(aiResponseArtifacts)
          .where(eq(aiResponseArtifacts.reservationId, reservation.id)).limit(1);
        if (artifact) {
          await tx.update(aiCreditReservations).set({ status: "consumed", completedAt: now })
            .where(and(eq(aiCreditReservations.id, reservation.id), eq(aiCreditReservations.status, "reserved")));
          continue;
        }
        for (const allocation of reservation.allocations as Array<{ lotId: string; points: number }>) {
          await tx.update(aiCreditLots).set({
            remainingPoints: sql`LEAST(${aiCreditLots.originalPoints}, ${aiCreditLots.remainingPoints} + ${allocation.points})`,
          }).where(and(eq(aiCreditLots.id, allocation.lotId), sql`NOT EXISTS (
            SELECT 1 FROM ${aiCreditRevocations} WHERE ${aiCreditRevocations.idempotencyKey} = ${aiCreditLots.idempotencyKey}
          )`));
        }
        await tx.update(aiCreditReservations).set({ status: "refunded", completedAt: now })
          .where(and(eq(aiCreditReservations.id, reservation.id), eq(aiCreditReservations.status, "reserved")));
      }
      const lots = await tx.select().from(aiCreditLots).where(and(
        eq(aiCreditLots.userId, data.ownerId), gt(aiCreditLots.remainingPoints, 0),
        or(isNull(aiCreditLots.expiresAt), gt(aiCreditLots.expiresAt, now)),
      )).orderBy(sql`${aiCreditLots.expiresAt} ASC NULLS LAST`, asc(aiCreditLots.grantedAt)).for("update");
      const allocations = allocateAiCreditLots(lots, data.points);
      if (!allocations) return null;
      const available = lots.reduce((sum, lot) => sum + lot.remainingPoints, 0);
      for (const allocation of allocations) {
        const lot = lots.find((candidate) => candidate.id === allocation.lotId)!;
        await tx.update(aiCreditLots).set({ remainingPoints: lot.remainingPoints - allocation.points })
          .where(eq(aiCreditLots.id, lot.id));
      }
      const reservationId = crypto.randomUUID();
      await tx.insert(aiCreditReservations).values({ id: reservationId, userId: data.ownerId, points: data.points, allocations, status: "reserved" });
      const [purchase] = await tx.insert(salesScriptPurchases).values({
        webinarId: data.webinarId, ownerId: data.ownerId, reservationId, idempotencyKey: data.idempotencyKey,
        basicAnswers: data.basicAnswers, costPoints: data.points,
      }).returning();
      await tx.update(users).set({ aiPoints: available - data.points }).where(eq(users.id, data.ownerId));
      return { purchase, jobId: null, created: true };
    });
  }

  async attachSalesScriptPurchaseToJob(data: {
    ownerId: string; webinarId: string; purchaseId: string; idempotencyKey: string; answers: Record<string, string>;
  }): Promise<{ job: SalesScriptJob; created: boolean } | null> {
    return db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`ai-credits:${data.ownerId}`}))`);
      const [purchase] = await tx.select().from(salesScriptPurchases).where(and(
        eq(salesScriptPurchases.id, data.purchaseId), eq(salesScriptPurchases.ownerId, data.ownerId),
        eq(salesScriptPurchases.webinarId, data.webinarId),
      )).for("update");
      if (!purchase) return null;
      const [sameKey] = await tx.select().from(salesScriptJobs).where(and(
        eq(salesScriptJobs.ownerId, data.ownerId), eq(salesScriptJobs.idempotencyKey, data.idempotencyKey),
      )).for("update");
      if (sameKey) {
        if (sameKey.webinarId !== data.webinarId || sameKey.purchaseId !== purchase.id
          || canonicalSalesScriptAnswers(sameKey.answers) !== canonicalSalesScriptAnswers(data.answers)) {
          throw new SalesScriptIdempotencyConflictError();
        }
        return { job: sameKey, created: false };
      }
      const [attached] = await tx.select().from(salesScriptJobs)
        .where(eq(salesScriptJobs.purchaseId, purchase.id)).for("update");
      if (attached) return { job: attached, created: false };
      const [reservation] = await tx.select().from(aiCreditReservations).where(and(
        eq(aiCreditReservations.id, purchase.reservationId), eq(aiCreditReservations.userId, data.ownerId),
      )).for("update");
      if (purchase.status !== "ready" || reservation?.status !== "reserved") return null;
      const [job] = await tx.insert(salesScriptJobs).values({
        webinarId: data.webinarId, ownerId: data.ownerId, reservationId: purchase.reservationId, purchaseId: purchase.id,
        idempotencyKey: data.idempotencyKey, answers: data.answers, costPoints: purchase.costPoints, queueScope: salesScriptQueueScope,
      }).returning();
      await tx.update(salesScriptPurchases).set({ status: "generating", updatedAt: new Date() })
        .where(eq(salesScriptPurchases.id, purchase.id));
      return { job, created: true };
    });
  }

  async admitSalesScriptJob(data: {
    ownerId: string; webinarId: string; idempotencyKey: string; answers: Record<string, string>; points: number;
  }): Promise<{ job: SalesScriptJob; created: boolean } | null> {
    if (!Number.isInteger(data.points) || data.points <= 0) throw new Error("Invalid credit reservation");
    return db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`ai-credits:${data.ownerId}`}))`);
      const [existing] = await tx.select().from(salesScriptJobs).where(and(
        eq(salesScriptJobs.ownerId, data.ownerId),
        eq(salesScriptJobs.idempotencyKey, data.idempotencyKey),
      )).for("update");
      if (existing) {
        if (existing.webinarId !== data.webinarId) throw new Error("Idempotency key was already used for another webinar");
        if (existing.costPoints !== data.points
          || canonicalSalesScriptAnswers(existing.answers) !== canonicalSalesScriptAnswers(data.answers)) {
          throw new SalesScriptIdempotencyConflictError();
        }
        return { job: existing, created: false };
      }
      const now = new Date();
      // Keep the established reservation reconciliation semantics for old
      // reply/generator reservations while fencing durable sales-script work.
      // The advisory lock is already held, so a stale refund and this new
      // charge cannot interleave.
      const stale = await tx.select().from(aiCreditReservations).where(and(
        eq(aiCreditReservations.userId, data.ownerId),
        eq(aiCreditReservations.status, "reserved"),
        lt(aiCreditReservations.createdAt, new Date(now.getTime() - 15 * 60_000)),
      )).for("update");
      for (const reservation of stale) {
        const [protectedPurchase] = await tx.select({ id: salesScriptPurchases.id }).from(salesScriptPurchases).where(and(
          eq(salesScriptPurchases.reservationId, reservation.id),
          or(eq(salesScriptPurchases.status, "ready"), eq(salesScriptPurchases.status, "generating")),
        )).limit(1);
        // A paid questionnaire may wait indefinitely before a job is started.
        // It must never be reclaimed by the legacy 15-minute reservation sweep.
        if (protectedPurchase) continue;
        const [salesJob] = await tx.select({ status: salesScriptJobs.status }).from(salesScriptJobs)
          .where(eq(salesScriptJobs.reservationId, reservation.id)).limit(1);
        if (salesJob && (salesJob.status === "queued" || salesJob.status === "running")) continue;
        const [artifact] = await tx.select({ id: aiResponseArtifacts.id }).from(aiResponseArtifacts)
          .where(eq(aiResponseArtifacts.reservationId, reservation.id)).limit(1);
        if (artifact) {
          await tx.update(aiCreditReservations).set({ status: "consumed", completedAt: now })
            .where(and(eq(aiCreditReservations.id, reservation.id), eq(aiCreditReservations.status, "reserved")));
          continue;
        }
        for (const allocation of reservation.allocations as Array<{ lotId: string; points: number }>) {
          await tx.update(aiCreditLots)
            .set({ remainingPoints: sql`LEAST(${aiCreditLots.originalPoints}, ${aiCreditLots.remainingPoints} + ${allocation.points})` })
            .where(and(eq(aiCreditLots.id, allocation.lotId), sql`NOT EXISTS (
              SELECT 1 FROM ${aiCreditRevocations}
              WHERE ${aiCreditRevocations.idempotencyKey} = ${aiCreditLots.idempotencyKey}
            )`));
        }
        await tx.update(aiCreditReservations).set({ status: "refunded", completedAt: now })
          .where(and(eq(aiCreditReservations.id, reservation.id), eq(aiCreditReservations.status, "reserved")));
      }
      const lots = await tx.select().from(aiCreditLots).where(and(
        eq(aiCreditLots.userId, data.ownerId),
        gt(aiCreditLots.remainingPoints, 0),
        or(isNull(aiCreditLots.expiresAt), gt(aiCreditLots.expiresAt, now)),
      )).orderBy(sql`${aiCreditLots.expiresAt} ASC NULLS LAST`, asc(aiCreditLots.grantedAt)).for("update");
      const available = lots.reduce((sum, lot) => sum + lot.remainingPoints, 0);
      const allocations = allocateAiCreditLots(lots, data.points);
      if (!allocations) return null;
      for (const allocation of allocations) {
        const lot = lots.find((candidate) => candidate.id === allocation.lotId)!;
        await tx.update(aiCreditLots).set({ remainingPoints: lot.remainingPoints - allocation.points })
          .where(eq(aiCreditLots.id, lot.id));
      }
      const reservationId = crypto.randomUUID();
      await tx.insert(aiCreditReservations).values({
        id: reservationId, userId: data.ownerId, points: data.points, allocations, status: "reserved",
      });
      const [job] = await tx.insert(salesScriptJobs).values({
        webinarId: data.webinarId,
        ownerId: data.ownerId,
        reservationId,
        idempotencyKey: data.idempotencyKey,
        answers: data.answers,
        costPoints: data.points,
        queueScope: salesScriptQueueScope,
      }).returning();
      await tx.update(users).set({ aiPoints: available - data.points }).where(eq(users.id, data.ownerId));
      return { job, created: true };
    });
  }

  async claimNextSalesScriptJob(leaseToken: string, leaseExpiresAt: Date): Promise<SalesScriptJob | null> {
    return db.transaction(async (tx) => {
      const now = new Date();
      const [candidate] = await tx.select().from(salesScriptJobs).where(and(
        eq(salesScriptJobs.queueScope, salesScriptQueueScope),
        or(
          eq(salesScriptJobs.status, "queued"),
          and(eq(salesScriptJobs.status, "running"), or(
            isNull(salesScriptJobs.leaseExpiresAt),
            lt(salesScriptJobs.leaseExpiresAt, now),
          )),
        ),
      )).orderBy(asc(salesScriptJobs.createdAt)).limit(1).for("update", { skipLocked: true });
      if (!candidate) return null;
      const [claimed] = await tx.update(salesScriptJobs).set({
        status: "running",
        leaseToken,
        leaseExpiresAt,
        attemptCount: candidate.attemptCount + 1,
        updatedAt: now,
      }).where(and(
        eq(salesScriptJobs.id, candidate.id),
        eq(salesScriptJobs.queueScope, salesScriptQueueScope),
      )).returning();
      return claimed || null;
    });
  }

  async renewSalesScriptJobLease(data: { jobId: string; leaseToken: string; leaseExpiresAt: Date }): Promise<boolean> {
    const renewed = await db.update(salesScriptJobs).set({
      leaseExpiresAt: data.leaseExpiresAt,
      updatedAt: new Date(),
    }).where(and(
      eq(salesScriptJobs.id, data.jobId),
      eq(salesScriptJobs.queueScope, salesScriptQueueScope),
      eq(salesScriptJobs.status, "running"),
      eq(salesScriptJobs.leaseToken, data.leaseToken),
    )).returning({ id: salesScriptJobs.id });
    return renewed.length === 1;
  }

  async saveSalesScriptCheckpoint(data: {
    jobId: string; leaseToken: string; stage: number; section: SalesScriptOutput["sections"][number];
  }): Promise<boolean> {
    return db.transaction(async (tx) => {
      const [job] = await tx.select({ id: salesScriptJobs.id }).from(salesScriptJobs).where(and(
        eq(salesScriptJobs.id, data.jobId),
        eq(salesScriptJobs.queueScope, salesScriptQueueScope),
        eq(salesScriptJobs.status, "running"),
        eq(salesScriptJobs.leaseToken, data.leaseToken),
      )).for("update");
      if (!job) return false;
      await tx.insert(salesScriptJobCheckpoints).values({
        jobId: data.jobId, stage: data.stage, section: data.section,
      }).onConflictDoNothing();
      await tx.update(salesScriptJobs).set({
        completedStages: sql`GREATEST(${salesScriptJobs.completedStages}, ${data.stage})`,
        updatedAt: new Date(),
      }).where(eq(salesScriptJobs.id, data.jobId));
      return true;
    });
  }

  async completeSalesScriptJob(data: {
    jobId: string; ownerId: string; reservationId: string; leaseToken: string; result: SalesScriptOutput;
  }): Promise<boolean> {
    return db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`ai-credits:${data.ownerId}`}))`);
      const [reservation] = await tx.select().from(aiCreditReservations).where(and(
        eq(aiCreditReservations.id, data.reservationId),
        eq(aiCreditReservations.userId, data.ownerId),
      )).for("update");
      const [job] = await tx.select().from(salesScriptJobs).where(and(
        eq(salesScriptJobs.id, data.jobId),
        eq(salesScriptJobs.queueScope, salesScriptQueueScope),
      )).for("update");
      if (!reservation || !job || job.ownerId !== data.ownerId || job.reservationId !== data.reservationId) return false;
      if (job.status === "completed" && reservation.status === "consumed") return true;
      if (job.status !== "running" || job.leaseToken !== data.leaseToken || reservation.status !== "reserved") return false;
      await tx.insert(aiResponseArtifacts).values({
        reservationId: data.reservationId,
        userId: data.ownerId,
        webinarId: job.webinarId,
        kind: "sales_script",
        requestText: JSON.stringify(job.answers),
        responseText: JSON.stringify(data.result),
      });
      await tx.update(salesScriptJobs).set({
        status: "completed", completedStages: 6, result: data.result, completedAt: new Date(),
        leaseToken: null, leaseExpiresAt: null, errorMessage: null, updatedAt: new Date(),
      }).where(eq(salesScriptJobs.id, data.jobId));
      await tx.update(aiCreditReservations).set({ status: "consumed", completedAt: new Date() })
        .where(and(eq(aiCreditReservations.id, data.reservationId), eq(aiCreditReservations.status, "reserved")));
      if (job.purchaseId) {
        await tx.update(salesScriptPurchases).set({ status: "completed", completedAt: new Date(), updatedAt: new Date() })
          .where(and(eq(salesScriptPurchases.id, job.purchaseId), eq(salesScriptPurchases.status, "generating")));
      }
      return true;
    });
  }

  async failSalesScriptJob(data: {
    jobId: string; ownerId: string; reservationId: string; leaseToken?: string; message: string;
  }): Promise<boolean> {
    return db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`ai-credits:${data.ownerId}`}))`);
      const [reservation] = await tx.select().from(aiCreditReservations).where(and(
        eq(aiCreditReservations.id, data.reservationId),
        eq(aiCreditReservations.userId, data.ownerId),
      )).for("update");
      const [job] = await tx.select().from(salesScriptJobs).where(and(
        eq(salesScriptJobs.id, data.jobId),
        eq(salesScriptJobs.queueScope, salesScriptQueueScope),
      )).for("update");
      if (!reservation || !job || job.ownerId !== data.ownerId || job.reservationId !== data.reservationId) return false;
      if (job.status === "failed" || job.status === "cancelled") return true;
      if (job.status === "completed" || (data.leaseToken && job.leaseToken !== data.leaseToken)) return false;
      if (reservation.status === "reserved") {
        for (const allocation of reservation.allocations as Array<{ lotId: string; points: number }>) {
          await tx.update(aiCreditLots)
            .set({ remainingPoints: sql`LEAST(${aiCreditLots.originalPoints}, ${aiCreditLots.remainingPoints} + ${allocation.points})` })
            .where(and(eq(aiCreditLots.id, allocation.lotId), sql`NOT EXISTS (
              SELECT 1 FROM ${aiCreditRevocations}
              WHERE ${aiCreditRevocations.idempotencyKey} = ${aiCreditLots.idempotencyKey}
            )`));
        }
        await tx.update(aiCreditReservations).set({ status: "refunded", completedAt: new Date() })
          .where(and(eq(aiCreditReservations.id, data.reservationId), eq(aiCreditReservations.status, "reserved")));
        const activeLots = await tx.select({ remainingPoints: aiCreditLots.remainingPoints }).from(aiCreditLots).where(and(
          eq(aiCreditLots.userId, data.ownerId),
          gt(aiCreditLots.remainingPoints, 0),
          or(isNull(aiCreditLots.expiresAt), gt(aiCreditLots.expiresAt, new Date())),
        ));
        await tx.update(users).set({ aiPoints: activeLots.reduce((sum, lot) => sum + lot.remainingPoints, 0) })
          .where(eq(users.id, data.ownerId));
      }
      await tx.update(salesScriptJobs).set({
        status: "failed", leaseToken: null, leaseExpiresAt: null,
        errorMessage: data.message.slice(0, 1000), updatedAt: new Date(),
      }).where(eq(salesScriptJobs.id, data.jobId));
      if (job.purchaseId) {
        await tx.update(salesScriptPurchases).set({ status: "refunded", completedAt: new Date(), updatedAt: new Date() })
          .where(and(eq(salesScriptPurchases.id, job.purchaseId), eq(salesScriptPurchases.status, "generating")));
      }
      return true;
    });
  }

  async reserveAiCredits(userId: string, points: number): Promise<{ reservationId: string; remaining: number } | null> {
    if (!Number.isInteger(points) || points <= 0) throw new Error("Invalid credit reservation");
    return db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`ai-credits:${userId}`}))`);
      const now = new Date();
      const stale = await tx.select().from(aiCreditReservations).where(and(
        eq(aiCreditReservations.userId, userId),
        eq(aiCreditReservations.status, "reserved"),
        lt(aiCreditReservations.createdAt, new Date(now.getTime() - 15 * 60_000)),
      )).for("update");
      for (const reservation of stale) {
        const [protectedPurchase] = await tx.select({ id: salesScriptPurchases.id }).from(salesScriptPurchases).where(and(
          eq(salesScriptPurchases.reservationId, reservation.id),
          or(eq(salesScriptPurchases.status, "ready"), eq(salesScriptPurchases.status, "generating")),
        )).limit(1);
        if (protectedPurchase) continue;
        // A sales-script job can legitimately run longer than the legacy
        // 15-minute reply reservation window. Its worker lease is recovered
        // after restart; never refund it while it can still produce output.
        const [salesJob] = await tx.select({
          id: salesScriptJobs.id,
          status: salesScriptJobs.status,
        }).from(salesScriptJobs).where(eq(salesScriptJobs.reservationId, reservation.id)).limit(1);
        if (salesJob && (salesJob.status === "queued" || salesJob.status === "running")) continue;
        const [artifact] = await tx.select({ id: aiResponseArtifacts.id }).from(aiResponseArtifacts)
          .where(eq(aiResponseArtifacts.reservationId, reservation.id)).limit(1);
        if (artifact) {
          await tx.update(aiCreditReservations).set({ status: "consumed", completedAt: now })
            .where(and(eq(aiCreditReservations.id, reservation.id), eq(aiCreditReservations.status, "reserved")));
          continue;
        }
        for (const allocation of reservation.allocations as Array<{ lotId: string; points: number }>) {
          await tx.update(aiCreditLots)
            .set({ remainingPoints: sql`LEAST(${aiCreditLots.originalPoints}, ${aiCreditLots.remainingPoints} + ${allocation.points})` })
            .where(and(
              eq(aiCreditLots.id, allocation.lotId),
              sql`NOT EXISTS (
                SELECT 1 FROM ${aiCreditRevocations}
                WHERE ${aiCreditRevocations.idempotencyKey} = ${aiCreditLots.idempotencyKey}
              )`,
            ));
        }
        await tx.update(aiCreditReservations).set({ status: "refunded", completedAt: now })
          .where(and(eq(aiCreditReservations.id, reservation.id), eq(aiCreditReservations.status, "reserved")));
      }
      const lots = await tx.select().from(aiCreditLots).where(and(
        eq(aiCreditLots.userId, userId),
        gt(aiCreditLots.remainingPoints, 0),
        or(isNull(aiCreditLots.expiresAt), gt(aiCreditLots.expiresAt, now)),
      )).orderBy(sql`${aiCreditLots.expiresAt} ASC NULLS LAST`, asc(aiCreditLots.grantedAt)).for("update");
      const available = lots.reduce((sum, lot) => sum + lot.remainingPoints, 0);
      if (available < points) return null;

      const allocations = allocateAiCreditLots(lots, points)!;
      for (const allocation of allocations) {
        const lot = lots.find((candidate) => candidate.id === allocation.lotId)!;
        const used = allocation.points;
        await tx.update(aiCreditLots)
          .set({ remainingPoints: lot.remainingPoints - used })
          .where(eq(aiCreditLots.id, lot.id));
      }
      const reservationId = crypto.randomUUID();
      await tx.insert(aiCreditReservations).values({ id: reservationId, userId, points, allocations, status: "reserved" });
      await tx.update(users).set({ aiPoints: available - points }).where(eq(users.id, userId));
      return { reservationId, remaining: available - points };
    });
  }

  async finalizeAiCreditReservation(reservationId: string): Promise<void> {
    await db.update(aiCreditReservations)
      .set({ status: "consumed", completedAt: new Date() })
      .where(and(eq(aiCreditReservations.id, reservationId), eq(aiCreditReservations.status, "reserved")));
  }

  async persistAiChatResponse(data: { reservationId: string; userId: string; webinarId: string; sessionId: string; teacherName: string; requestText: string; responseText: string }): Promise<ChatMessage> {
    return db.transaction(async (tx) => {
      const [reservation] = await tx.select().from(aiCreditReservations)
        .where(and(eq(aiCreditReservations.id, data.reservationId), eq(aiCreditReservations.userId, data.userId)))
        .for("update");
      if (!reservation || reservation.status !== "reserved") throw new Error("AI credit reservation is not active");
      const [message] = await tx.insert(chatMessages).values({
        webinarId: data.webinarId,
        sessionId: data.sessionId,
        senderName: data.teacherName,
        message: data.responseText,
        senderType: "host",
        isPrivate: true,
      }).returning();
      await tx.insert(aiResponseArtifacts).values({
        reservationId: reservation.id,
        userId: data.userId,
        webinarId: data.webinarId,
        kind: "viewer_chat",
        requestText: data.requestText,
        responseText: data.responseText,
      });
      const consumed = await tx.update(aiCreditReservations).set({ status: "consumed", completedAt: new Date() })
        .where(and(eq(aiCreditReservations.id, reservation.id), eq(aiCreditReservations.status, "reserved")))
        .returning({ id: aiCreditReservations.id });
      if (!consumed[0]) throw new Error("AI credit reservation could not be consumed");
      return message;
    });
  }

  async persistAiArtifactAndConsume(data: { reservationId: string; userId: string; webinarId: string; kind: string; requestText: string; responseText: string }): Promise<void> {
    await db.transaction(async (tx) => {
      const [reservation] = await tx.select({ id: aiCreditReservations.id }).from(aiCreditReservations)
        .where(and(
          eq(aiCreditReservations.id, data.reservationId),
          eq(aiCreditReservations.userId, data.userId),
          eq(aiCreditReservations.status, "reserved"),
        )).for("update");
      if (!reservation) throw new Error("AI credit reservation is not active");
      await tx.insert(aiResponseArtifacts).values({
        reservationId: reservation.id,
        userId: data.userId,
        webinarId: data.webinarId,
        kind: data.kind,
        requestText: data.requestText,
        responseText: data.responseText,
      });
      const consumed = await tx.update(aiCreditReservations).set({ status: "consumed", completedAt: new Date() })
        .where(and(eq(aiCreditReservations.id, reservation.id), eq(aiCreditReservations.status, "reserved")))
        .returning({ id: aiCreditReservations.id });
      if (!consumed[0]) throw new Error("AI credit reservation could not be consumed");
    });
  }

  private async persistGeneratedAiResult<T>(
    data: { reservationId: string | null; userId: string; webinarId: string; kind: string; requestText: string; responseText: string },
    persist: (tx: any) => Promise<T>,
  ): Promise<T> {
    return db.transaction(async (tx) => {
      if (data.reservationId) {
        const [reservation] = await tx.select({ id: aiCreditReservations.id }).from(aiCreditReservations)
          .where(and(
            eq(aiCreditReservations.id, data.reservationId),
            eq(aiCreditReservations.userId, data.userId),
            eq(aiCreditReservations.status, "reserved"),
          )).for("update");
        if (!reservation) throw new Error("AI credit reservation is not active");
      }
      const saved = await persist(tx);
      await tx.insert(aiResponseArtifacts).values({
        reservationId: data.reservationId,
        userId: data.userId,
        webinarId: data.webinarId,
        kind: data.kind,
        requestText: data.requestText,
        responseText: data.responseText,
      });
      if (data.reservationId) {
        const consumed = await tx.update(aiCreditReservations).set({ status: "consumed", completedAt: new Date() })
          .where(and(eq(aiCreditReservations.id, data.reservationId), eq(aiCreditReservations.status, "reserved")))
          .returning({ id: aiCreditReservations.id });
        if (!consumed[0]) throw new Error("AI credit reservation could not be consumed");
      }
      return saved;
    });
  }

  async persistGeneratedInteractions(data: { reservationId: string | null; userId: string; webinarId: string; replace: boolean; requestText: string; result: any }) {
    return this.persistGeneratedAiResult({
      ...data,
      kind: "generated_interactions",
      responseText: JSON.stringify(data.result),
    }, async (tx) => {
      if (data.replace) {
        const oldPolls = await tx.select({ id: polls.id }).from(polls).where(eq(polls.webinarId, data.webinarId));
        if (oldPolls.length) await tx.delete(pollVotes).where(inArray(pollVotes.pollId, oldPolls.map((poll: { id: string }) => poll.id)));
        await tx.delete(scheduledMessages).where(eq(scheduledMessages.webinarId, data.webinarId));
        await tx.delete(fakeUsers).where(eq(fakeUsers.webinarId, data.webinarId));
        const oldCtas = await tx.select({ id: ctaButtons.id }).from(ctaButtons)
          .where(eq(ctaButtons.webinarId, data.webinarId));
        const oldCtaIds = oldCtas.map((cta: { id: string }) => cta.id);
        if (oldCtaIds.length) {
          const paidRefs = await tx.select({ ctaId: webinarPayments.ctaId }).from(webinarPayments)
            .where(and(
              eq(webinarPayments.webinarId, data.webinarId),
              inArray(webinarPayments.ctaId, oldCtaIds),
            ));
          const { retireIds: referencedIds, deleteIds: unreferencedIds } = partitionCtasForReplacement(
            oldCtaIds,
            paidRefs.map((row: { ctaId: string | null }) => row.ctaId),
          );
          if (referencedIds.length) {
            await tx.update(ctaButtons).set({ archivedAt: new Date() }).where(and(
              eq(ctaButtons.webinarId, data.webinarId),
              inArray(ctaButtons.id, referencedIds),
            ));
          }
          if (unreferencedIds.length) {
            await tx.delete(ctaButtons).where(and(
              eq(ctaButtons.webinarId, data.webinarId),
              inArray(ctaButtons.id, unreferencedIds),
            ));
          }
        }
        await tx.delete(tips).where(eq(tips.webinarId, data.webinarId));
        await tx.delete(polls).where(eq(polls.webinarId, data.webinarId));
      }
      const nameToId = new Map<string, string>();
      for (const name of data.result.fakeUsers) {
        const [fakeUser] = await tx.insert(fakeUsers).values({ webinarId: data.webinarId, name }).returning();
        nameToId.set(name, fakeUser.id);
      }
      for (const message of data.result.messages) {
        await tx.insert(scheduledMessages).values({
          webinarId: data.webinarId, fakeUserId: nameToId.get(message.name) || null,
          message: message.message, triggerTime: message.triggerTime, messageType: "chat",
        });
      }
      for (const poll of data.result.polls) await tx.insert(polls).values({ webinarId: data.webinarId, ...poll });
      for (const tip of data.result.tips) await tx.insert(tips).values({ webinarId: data.webinarId, ...tip });
      for (const cta of data.result.ctas) {
        await tx.insert(ctaButtons).values({
          webinarId: data.webinarId, text: cta.text, url: cta.url,
          startTime: cta.startTime, ctaKey: crypto.randomBytes(18).toString("base64url"),
        });
      }
      return {
        fakeUsers: data.result.fakeUsers.length, messages: data.result.messages.length,
        polls: data.result.polls.length, tips: data.result.tips.length, ctas: data.result.ctas.length,
      };
    });
  }

  async persistGeneratedEmailSequences(data: { reservationId: string | null; userId: string; webinarId: string; replace: boolean; requestText: string; emails: any[] }) {
    return this.persistGeneratedAiResult({
      ...data,
      kind: "generated_email_sequences",
      responseText: JSON.stringify(data.emails),
    }, async (tx) => {
      if (data.replace) await tx.delete(emailSequences).where(eq(emailSequences.webinarId, data.webinarId));
      const created: EmailSequence[] = [];
      for (let sortOrder = 0; sortOrder < data.emails.length; sortOrder += 1) {
        const email = data.emails[sortOrder];
        const [saved] = await tx.insert(emailSequences).values({
          webinarId: data.webinarId, name: email.name, segment: email.segment,
          delayMinutes: email.delayMinutes, subject: email.subject, htmlBody: email.htmlBody,
          enabled: true, sortOrder,
        }).returning();
        created.push(saved);
      }
      return created;
    });
  }

  async persistGeneratedSocialPosts(data: { reservationId: string | null; userId: string; webinarId: string; replace: boolean; requestText: string; posts: any[] }) {
    return this.persistGeneratedAiResult({
      ...data,
      kind: "generated_social_posts",
      responseText: JSON.stringify(data.posts),
    }, async (tx) => {
      if (data.replace) await tx.delete(socialPosts).where(eq(socialPosts.webinarId, data.webinarId));
      const created: SocialPost[] = [];
      for (const post of data.posts) {
        const [saved] = await tx.insert(socialPosts).values({
          webinarId: data.webinarId, platform: post.platform, content: post.content, status: "draft",
        }).returning();
        created.push(saved);
      }
      return created;
    });
  }

  async refundAiCreditReservation(reservationId: string): Promise<void> {
    await db.transaction(async (tx) => {
      const [candidate] = await tx.select({ userId: aiCreditReservations.userId }).from(aiCreditReservations)
        .where(eq(aiCreditReservations.id, reservationId));
      if (!candidate) return;
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`ai-credits:${candidate.userId}`}))`);
      const [reservation] = await tx.select().from(aiCreditReservations)
        .where(eq(aiCreditReservations.id, reservationId)).for("update");
      if (!reservation || reservation.status !== "reserved") return;
      for (const allocation of reservation.allocations as Array<{ lotId: string; points: number }>) {
        await tx.update(aiCreditLots)
          .set({ remainingPoints: sql`LEAST(${aiCreditLots.originalPoints}, ${aiCreditLots.remainingPoints} + ${allocation.points})` })
          .where(and(
            eq(aiCreditLots.id, allocation.lotId),
            sql`NOT EXISTS (
              SELECT 1 FROM ${aiCreditRevocations}
              WHERE ${aiCreditRevocations.idempotencyKey} = ${aiCreditLots.idempotencyKey}
            )`,
          ));
      }
      await tx.update(aiCreditReservations)
        .set({ status: "refunded", completedAt: new Date() })
        .where(eq(aiCreditReservations.id, reservationId));
      const active = await tx.select({ remainingPoints: aiCreditLots.remainingPoints }).from(aiCreditLots).where(and(
        eq(aiCreditLots.userId, reservation.userId),
        gt(aiCreditLots.remainingPoints, 0),
        or(isNull(aiCreditLots.expiresAt), gt(aiCreditLots.expiresAt, new Date())),
      ));
      await tx.update(users)
        .set({ aiPoints: active.reduce((sum, lot) => sum + lot.remainingPoints, 0) })
        .where(eq(users.id, reservation.userId));
    });
  }

  async grantAiCredits(data: { userId: string; points: number; source: "monthly_gift" | "admin_grant"; grantedAt?: Date; expiresAt?: Date | null; idempotencyKey?: string | null }) {
    if (!Number.isInteger(data.points) || data.points <= 0) throw new Error("Invalid credit grant");
    return db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`ai-credits:${data.userId}`}))`);
      if (data.idempotencyKey) {
        const [revoked] = await tx.select({ userId: aiCreditRevocations.userId }).from(aiCreditRevocations)
          .where(eq(aiCreditRevocations.idempotencyKey, data.idempotencyKey)).limit(1);
        if (revoked) {
          if (revoked.userId !== data.userId) throw new Error("AI credit revocation attribution mismatch");
          const active = await tx.select({ remainingPoints: aiCreditLots.remainingPoints }).from(aiCreditLots).where(and(
            eq(aiCreditLots.userId, data.userId),
            gt(aiCreditLots.remainingPoints, 0),
            or(isNull(aiCreditLots.expiresAt), gt(aiCreditLots.expiresAt, new Date())),
          ));
          return { added: false, points: active.reduce((sum, lot) => sum + lot.remainingPoints, 0) };
        }
      }
      const inserted = await tx.insert(aiCreditLots).values({
        userId: data.userId,
        source: data.source,
        originalPoints: data.points,
        remainingPoints: data.points,
        grantedAt: data.grantedAt || new Date(),
        expiresAt: data.expiresAt || null,
        idempotencyKey: data.idempotencyKey || null,
      }).onConflictDoNothing({ target: aiCreditLots.idempotencyKey }).returning({ id: aiCreditLots.id });
      if (inserted.length > 0) {
        await tx.insert(aiPointTransactions).values({
          userId: data.userId,
          type: data.source,
          points: data.points,
          amountTwd: null,
          stripeSessionId: null,
        });
      }
      const active = await tx.select({ remainingPoints: aiCreditLots.remainingPoints }).from(aiCreditLots).where(and(
        eq(aiCreditLots.userId, data.userId),
        gt(aiCreditLots.remainingPoints, 0),
        or(isNull(aiCreditLots.expiresAt), gt(aiCreditLots.expiresAt, new Date())),
      ));
      const points = active.reduce((sum, lot) => sum + lot.remainingPoints, 0);
      await tx.update(users).set({ aiPoints: points }).where(eq(users.id, data.userId));
      return { added: inserted.length > 0, points };
    });
  }

  async revokeUnusedAiCreditsByPrefix(userId: string, idempotencyKeyPrefix: string): Promise<number> {
    return db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`ai-credits:${userId}`}))`);
      const revoked = await tx.update(aiCreditLots)
        .set({ remainingPoints: 0 })
        .where(and(
          eq(aiCreditLots.userId, userId),
          eq(aiCreditLots.source, "monthly_gift"),
          gt(aiCreditLots.remainingPoints, 0),
          like(aiCreditLots.idempotencyKey, `${idempotencyKeyPrefix}%`),
        ))
        .returning({ remainingPoints: aiCreditLots.remainingPoints });
      const active = await tx.select({ remainingPoints: aiCreditLots.remainingPoints }).from(aiCreditLots).where(and(
        eq(aiCreditLots.userId, userId),
        gt(aiCreditLots.remainingPoints, 0),
        or(isNull(aiCreditLots.expiresAt), gt(aiCreditLots.expiresAt, new Date())),
      ));
      await tx.update(users).set({
        aiPoints: active.reduce((sum, lot) => sum + lot.remainingPoints, 0),
      }).where(eq(users.id, userId));
      return revoked.length;
    });
  }

  async revokeAiCreditSource(userId: string, idempotencyKey: string): Promise<number> {
    return db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`ai-credits:${userId}`}))`);
      await tx.insert(aiCreditRevocations).values({ userId, idempotencyKey })
        .onConflictDoNothing({ target: aiCreditRevocations.idempotencyKey });
      const revoked = await tx.update(aiCreditLots).set({ remainingPoints: 0 }).where(and(
        eq(aiCreditLots.userId, userId),
        eq(aiCreditLots.idempotencyKey, idempotencyKey),
        gt(aiCreditLots.remainingPoints, 0),
      )).returning({ remainingPoints: aiCreditLots.remainingPoints });
      const active = await tx.select({ remainingPoints: aiCreditLots.remainingPoints }).from(aiCreditLots).where(and(
        eq(aiCreditLots.userId, userId),
        gt(aiCreditLots.remainingPoints, 0),
        or(isNull(aiCreditLots.expiresAt), gt(aiCreditLots.expiresAt, new Date())),
      ));
      await tx.update(users).set({ aiPoints: active.reduce((sum, lot) => sum + lot.remainingPoints, 0) })
        .where(eq(users.id, userId));
      return revoked.length;
    });
  }

  async reconcileAnnualAiCredits(data: {
    userId: string;
    idempotencyKeyPrefix: string;
    grants: Array<{ points: number; grantedAt: Date; expiresAt: Date; idempotencyKey: string }>;
    verifyPayment: () => Promise<boolean>;
  }): Promise<{ valid: boolean; added: number; revoked: number }> {
    return db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`ai-credits:${data.userId}`}))`);
      const valid = await data.verifyPayment();
      let added = 0;
      let revoked = 0;
      if (valid) {
        for (const grant of data.grants) {
          const [revocation] = await tx.select({ idempotencyKey: aiCreditRevocations.idempotencyKey }).from(aiCreditRevocations)
            .where(eq(aiCreditRevocations.idempotencyKey, grant.idempotencyKey)).limit(1);
          if (revocation) continue;
          const inserted = await tx.insert(aiCreditLots).values({
            userId: data.userId,
            source: "monthly_gift",
            originalPoints: grant.points,
            remainingPoints: grant.points,
            grantedAt: grant.grantedAt,
            expiresAt: grant.expiresAt,
            idempotencyKey: grant.idempotencyKey,
          }).onConflictDoNothing({ target: aiCreditLots.idempotencyKey }).returning({ id: aiCreditLots.id });
          if (inserted.length > 0) {
            added += 1;
            await tx.insert(aiPointTransactions).values({
              userId: data.userId,
              type: "monthly_gift",
              points: grant.points,
              amountTwd: null,
              stripeSessionId: null,
            });
          }
        }
      } else {
        const annualLots = await tx.select({ idempotencyKey: aiCreditLots.idempotencyKey }).from(aiCreditLots)
          .where(and(
            eq(aiCreditLots.userId, data.userId),
            eq(aiCreditLots.source, "monthly_gift"),
            like(aiCreditLots.idempotencyKey, `${data.idempotencyKeyPrefix}%`),
          ));
        const revocationKeys = annualGrantRevocationKeys(annualLots);
        if (revocationKeys.length) {
          await tx.insert(aiCreditRevocations).values(revocationKeys.map((idempotencyKey) => ({
            userId: data.userId,
            idempotencyKey,
          }))).onConflictDoNothing({ target: aiCreditRevocations.idempotencyKey });
        }
        const rows = await tx.update(aiCreditLots)
          .set({ remainingPoints: 0 })
          .where(and(
            eq(aiCreditLots.userId, data.userId),
            eq(aiCreditLots.source, "monthly_gift"),
            gt(aiCreditLots.remainingPoints, 0),
            like(aiCreditLots.idempotencyKey, `${data.idempotencyKeyPrefix}%`),
          ))
          .returning({ id: aiCreditLots.id });
        revoked = rows.length;
      }
      const active = await tx.select({ remainingPoints: aiCreditLots.remainingPoints }).from(aiCreditLots).where(and(
        eq(aiCreditLots.userId, data.userId),
        gt(aiCreditLots.remainingPoints, 0),
        or(isNull(aiCreditLots.expiresAt), gt(aiCreditLots.expiresAt, new Date())),
      ));
      await tx.update(users).set({
        aiPoints: active.reduce((sum, lot) => sum + lot.remainingPoints, 0),
      }).where(eq(users.id, data.userId));
      return { valid, added, revoked };
    });
  }

  // 交易記錄 + 加點在同一個 DB transaction 中完成（冪等 + 一致性）
  // 回傳 { points: 新餘額, alreadyProcessed }。session 已處理時不重複入點。
  async creditPointPurchase(data: { userId: string; points: number; amountTwd: number; stripeSessionId: string }): Promise<{ points: number; alreadyProcessed: boolean }> {
    return await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`ai-credits:${data.userId}`}))`);
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
        const active = await tx.select({ remainingPoints: aiCreditLots.remainingPoints }).from(aiCreditLots).where(and(
          eq(aiCreditLots.userId, data.userId),
          gt(aiCreditLots.remainingPoints, 0),
          or(isNull(aiCreditLots.expiresAt), gt(aiCreditLots.expiresAt, new Date())),
        ));
        return { points: active.reduce((sum, lot) => sum + lot.remainingPoints, 0), alreadyProcessed: true };
      }

      const idempotencyKey = `purchase:${data.stripeSessionId}`;
      const [revoked] = await tx.select({ userId: aiCreditRevocations.userId }).from(aiCreditRevocations)
        .where(eq(aiCreditRevocations.idempotencyKey, idempotencyKey)).limit(1);
      if (revoked && revoked.userId !== data.userId) throw new Error("AI credit revocation attribution mismatch");
      if (!revoked) {
        await tx.insert(aiCreditLots).values({
          userId: data.userId,
          source: "purchase",
          originalPoints: data.points,
          remainingPoints: data.points,
          expiresAt: null,
          idempotencyKey,
        });
      }
      const active = await tx.select({ remainingPoints: aiCreditLots.remainingPoints }).from(aiCreditLots).where(and(
        eq(aiCreditLots.userId, data.userId),
        gt(aiCreditLots.remainingPoints, 0),
        or(isNull(aiCreditLots.expiresAt), gt(aiCreditLots.expiresAt, new Date())),
      ));
      const points = active.reduce((sum, lot) => sum + lot.remainingPoints, 0);
      await tx.update(users).set({ aiPoints: points }).where(eq(users.id, data.userId));
      return { points, alreadyProcessed: false };
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

  async createAiWizardWebinar(data: {
    webinar: InsertWebinar;
    reservationId?: string | null;
    knowledge: string;
    interactions: {
      fakeUsers: string[];
      messages: { name: string; message: string; triggerTime: number }[];
      polls: { question: string; options: string[]; triggerTime: number }[];
      tips: { title: string; content: string; triggerTime: number; icon: string }[];
      ctas: { text: string; url: string; startTime: number }[];
    };
    emails: { name: string; segment: string; delayMinutes: number; subject: string; htmlBody: string }[];
  }): Promise<Webinar> {
    return db.transaction(async (tx) => {
      const [webinar] = await tx.insert(webinars).values(data.webinar as any).returning();
      await tx.insert(webinarDocuments).values({
        webinarId: webinar.id,
        title: "AI 建立精靈參考資料",
        content: data.knowledge,
      });

      const fakeUserRows = data.interactions.fakeUsers.length
        ? await tx.insert(fakeUsers)
            .values(data.interactions.fakeUsers.map((name) => ({ webinarId: webinar.id, name })))
            .returning({ id: fakeUsers.id, name: fakeUsers.name })
        : [];
      const nameToId = new Map(fakeUserRows.map((row) => [row.name, row.id]));

      if (data.interactions.messages.length) {
        await tx.insert(scheduledMessages).values(data.interactions.messages.map((message) => ({
          webinarId: webinar.id,
          fakeUserId: nameToId.get(message.name) || null,
          message: message.message,
          triggerTime: message.triggerTime,
          messageType: "chat",
        })));
      }
      if (data.interactions.polls.length) {
        await tx.insert(polls).values(data.interactions.polls.map((poll) => ({ webinarId: webinar.id, ...poll })));
      }
      if (data.interactions.tips.length) {
        await tx.insert(tips).values(data.interactions.tips.map((tip) => ({ webinarId: webinar.id, ...tip })));
      }
      if (data.interactions.ctas.length) {
        await tx.insert(ctaButtons).values(data.interactions.ctas.map((cta) => ({
          webinarId: webinar.id,
          ...cta,
          ctaKey: crypto.randomBytes(18).toString("base64url"),
        })));
      }
      if (data.emails.length) {
        await tx.insert(emailSequences).values(data.emails.map((email, index) => ({
          webinarId: webinar.id,
          ...email,
          enabled: false,
          sortOrder: index,
        })));
      }
      if (data.reservationId) {
        const consumed = await tx.update(aiCreditReservations)
          .set({ status: "consumed", completedAt: new Date() })
          .where(and(
            eq(aiCreditReservations.id, data.reservationId),
            eq(aiCreditReservations.status, "reserved"),
          ))
          .returning({ id: aiCreditReservations.id });
        if (consumed.length !== 1) {
          throw new Error("AI credit reservation could not be finalized");
        }
      }
      return webinar;
    });
  }

  async getWebinar(id: string): Promise<Webinar | undefined> {
    const result = await db.select().from(webinars).where(and(eq(webinars.id, id), isNull(webinars.deletedAt)));
    return result[0];
  }

  async getAllWebinars(): Promise<Webinar[]> {
    return db.select().from(webinars).where(isNull(webinars.deletedAt)).orderBy(desc(webinars.createdAt));
  }

  async getWebinarsByUser(userId: string): Promise<Webinar[]> {
    return db.select().from(webinars).where(and(eq(webinars.userId, userId), isNull(webinars.deletedAt))).orderBy(desc(webinars.createdAt));
  }

  async updateWebinar(id: string, data: Partial<InsertWebinar>): Promise<Webinar | undefined> {
    const update: Record<string, unknown> = { ...data };
    if (data.aiSettings !== undefined) {
      update.aiSettings = sql`COALESCE(${webinars.aiSettings}, '{}'::jsonb) || ${JSON.stringify(data.aiSettings)}::jsonb`;
    }
    return db.transaction(async (tx) => {
      await lockCourseMarketplace(tx, id);
      const [before] = await tx.select().from(webinars).where(eq(webinars.id, id)).limit(1);
      const result = await tx.update(webinars).set(update as any).where(eq(webinars.id, id)).returning();
      const publicFields = [
        "title", "description", "coverImage", "startTime", "timezone",
        "scheduleMode", "recurringSchedule", "brandSettings",
        "videoProvider", "videoAssetId", "vimeoUrl", "videoDuration", "publishStatus",
        "customFields", "scarcitySettings", "thankYouSettings",
        "replaySettings", "replayEnabled", "replayAvailableHours", "aiSettings",
      ];
      if (before && result[0] && publicFields.some(field => Object.prototype.hasOwnProperty.call(data, field))) {
        await invalidateCourseMarketplaceListing(tx, id);
      }
      return result[0];
    });
  }

  async deleteWebinar(id: string): Promise<void> {
    // Financial and attribution records are legal/audit records. A webinar is
    // therefore retired atomically rather than cascading or manually deleting
    // its graph.
    await db.transaction(async (tx) => {
      await lockCourseMarketplace(tx, id);
      await tx.update(webinars).set({
        deletedAt: new Date(),
        publishStatus: "draft",
        status: "ended",
      }).where(and(eq(webinars.id, id), isNull(webinars.deletedAt)));
      await tx.update(webinarLandingPages).set({ status: "draft", updatedAt: new Date() }).where(eq(webinarLandingPages.webinarId, id));
      await invalidateCourseMarketplaceListing(tx, id);
    });
  }

  // Registrations
  /**
   * Older databases still carry a trigger (migration 0014/0015) that allows one
   * registration per email per webinar, backed by registration_identity_keys.
   * Production schema is applied by publishing, which does not drop triggers,
   * so 0036 may never have run there. Clearing the key for this email first
   * lets the trigger record the new signup instead of rejecting it, and is a
   * no-op where the trigger is already gone.
   */
  private async releaseLegacyEmailLock(tx: any, webinarId: string, email: string) {
    await tx.delete(registrationIdentityKeys).where(and(
      eq(registrationIdentityKeys.webinarId, webinarId),
      eq(registrationIdentityKeys.normalizedEmail, email.trim().toLowerCase()),
    ));
  }

  async createRegistration(data: InsertRegistration, analyticsVisitorToken?: string): Promise<Registration> {
    return db.transaction(async (tx) => {
      // Email is contact information, not a registration identity. Each signup
      // gets its own ID, watch access, email jobs, and attribution event.
      await this.releaseLegacyEmailLock(tx, data.webinarId, data.email);
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

      await this.releaseLegacyEmailLock(tx, data.webinarId, data.email);
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
    const result = await db.select().from(registrations).where(and(eq(registrations.id, id), isNull(registrations.deletedAt)));
    return result[0];
  }

  async getRegistrationsByWebinar(webinarId: string): Promise<Registration[]> {
    return db.select().from(registrations).where(and(eq(registrations.webinarId, webinarId), isNull(registrations.deletedAt)));
  }

  async getRegistrationsByWebinarPage(webinarId: string, limit: number, offset: number): Promise<{ registrations: Registration[]; total: number }> {
    const [rows, totals] = await Promise.all([
      db.select().from(registrations)
        .where(and(eq(registrations.webinarId, webinarId), isNull(registrations.deletedAt)))
        .orderBy(desc(registrations.registeredAt), desc(registrations.id))
        .limit(limit)
        .offset(offset),
      db.select({ value: count() }).from(registrations).where(and(eq(registrations.webinarId, webinarId), isNull(registrations.deletedAt))),
    ]);
    return { registrations: rows, total: Number(totals[0]?.value || 0) };
  }

  async getRegistrationByEmail(webinarId: string, email: string): Promise<Registration | undefined> {
    const result = await db.select().from(registrations)
      .where(and(eq(registrations.webinarId, webinarId), isNull(registrations.deletedAt), sql`lower(btrim(${registrations.email})) = ${email.trim().toLowerCase()}`));
    return result[0];
  }

  async bulkUpdateRegistrations(webinarId: string, ids: string[], action: "archive" | "unarchive" | "delete"): Promise<number> {
    if (ids.length === 0) return 0;
    return db.transaction(async (tx) => {
      const now = new Date();
      const changes = action === "archive" ? { archivedAt: now }
        : action === "unarchive" ? { archivedAt: null }
        : { deletedAt: now };
      const changed = await tx.update(registrations).set(changes).where(and(
        eq(registrations.webinarId, webinarId),
        inArray(registrations.id, ids),
        isNull(registrations.deletedAt),
      )).returning({ id: registrations.id });
      if (action === "delete" && changed.length > 0) {
        // A deleted registrant must not keep receiving reminders.
        await tx.update(emailReminders).set({ status: "cancelled" }).where(and(
          inArray(emailReminders.registrationId, changed.map(row => row.id)),
          eq(emailReminders.status, "pending"),
        ));
      }
      return changed.length;
    });
  }

  async updateRegistration(id: string, data: Partial<Registration>): Promise<Registration | undefined> {
    const result = await db.update(registrations).set(data).where(eq(registrations.id, id)).returning();
    return result[0];
  }

  async updateRegistrationForWebinar(webinarId: string, id: string, data: Partial<Registration>): Promise<Registration | undefined> {
    const result = await db.update(registrations).set(data).where(and(
      eq(registrations.id, id), eq(registrations.webinarId, webinarId),
    )).returning();
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

  async deleteFakeUser(webinarId: string, id: string): Promise<boolean> {
    return (await db.delete(fakeUsers).where(and(eq(fakeUsers.id, id), eq(fakeUsers.webinarId, webinarId)))
      .returning({ id: fakeUsers.id })).length === 1;
  }

  async updateFakeUser(webinarId: string, id: string, data: { name?: string; avatar?: string | null }): Promise<FakeUser | undefined> {
    const result = await db.update(fakeUsers).set(data)
      .where(and(eq(fakeUsers.id, id), eq(fakeUsers.webinarId, webinarId))).returning();
    return result[0];
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

  async deleteScheduledMessage(webinarId: string, id: string): Promise<boolean> {
    return (await db.delete(scheduledMessages).where(and(
      eq(scheduledMessages.id, id), eq(scheduledMessages.webinarId, webinarId),
    )).returning({ id: scheduledMessages.id })).length === 1;
  }

  async updateScheduledMessage(webinarId: string, id: string, data: { fakeUserId?: string; message?: string; triggerTime?: number }): Promise<ScheduledMessage | undefined> {
    const result = await db.update(scheduledMessages).set(data).where(and(
      eq(scheduledMessages.id, id), eq(scheduledMessages.webinarId, webinarId),
    )).returning();
    return result[0];
  }

  // CTA Buttons
  async createWebinarOffer(data: typeof webinarOffers.$inferInsert): Promise<WebinarOffer> {
    const result = await db.insert(webinarOffers).values(data).returning();
    return result[0];
  }

  async getWebinarOffers(webinarId: string): Promise<WebinarOffer[]> {
    return db.select().from(webinarOffers)
      .where(and(
        eq(webinarOffers.webinarId, webinarId),
        eq(webinarOffers.active, true),
        sql`COALESCE(
          ${webinarOffers.userId},
          (SELECT owner_webinar.user_id FROM webinars owner_webinar WHERE owner_webinar.id = ${webinarOffers.webinarId})
        ) = (SELECT source_webinar.user_id FROM webinars source_webinar WHERE source_webinar.id = ${webinarId})`,
        sql`(SELECT source_webinar.user_id FROM webinars source_webinar WHERE source_webinar.id = ${webinarId}) IS NOT NULL`,
      ))
      .orderBy(desc(webinarOffers.createdAt));
  }

  async getWebinarOffer(id: string): Promise<WebinarOffer | undefined> {
    const result = await db.select().from(webinarOffers).where(eq(webinarOffers.id, id)).limit(1);
    return result[0];
  }

  async deactivateWebinarOffer(webinarId: string, id: string): Promise<WebinarOffer | undefined> {
    const result = await db.update(webinarOffers).set({ active: false })
      .where(and(
        eq(webinarOffers.id, id),
        eq(webinarOffers.webinarId, webinarId),
        sql`COALESCE(
          ${webinarOffers.userId},
          (SELECT owner_webinar.user_id FROM webinars owner_webinar WHERE owner_webinar.id = ${webinarOffers.webinarId})
        ) = (SELECT source_webinar.user_id FROM webinars source_webinar WHERE source_webinar.id = ${webinarId})`,
      )).returning();
    return result[0];
  }

  async listOfferSalesPages(webinarId: string): Promise<OfferSalesPage[]> {
    return db.select().from(offerSalesPages)
      .where(and(
        eq(offerSalesPages.webinarId, webinarId),
        isNull(offerSalesPages.deletedAt),
        salesPageOwnedByWebinar(webinarId),
      ))
      .orderBy(desc(offerSalesPages.updatedAt));
  }

  async getOfferSalesPage(webinarId: string, pageId: string): Promise<OfferSalesPage | undefined> {
    const result = await db.select().from(offerSalesPages).where(and(
      eq(offerSalesPages.id, pageId),
      eq(offerSalesPages.webinarId, webinarId),
      isNull(offerSalesPages.deletedAt),
      salesPageOwnedByWebinar(webinarId),
    )).limit(1);
    return result[0];
  }

  async createOfferSalesPage(data: InsertOfferSalesPage): Promise<OfferSalesPage> {
    const result = await db.insert(offerSalesPages).values(data).returning();
    return result[0];
  }

  async updateOfferSalesPage(
    webinarId: string,
    pageId: string,
    version: number,
    data: Partial<Pick<OfferSalesPage, "title" | "slug" | "orderedBlocks" | "checkoutSettings">>,
  ): Promise<OfferSalesPage | undefined> {
    const result = await db.update(offerSalesPages).set({
      ...data,
      version: sql`${offerSalesPages.version} + 1`,
      updatedAt: new Date(),
    }).where(and(
      eq(offerSalesPages.id, pageId),
      eq(offerSalesPages.webinarId, webinarId),
      eq(offerSalesPages.version, version),
      isNull(offerSalesPages.deletedAt),
      salesPageOwnedByWebinar(webinarId),
    )).returning();
    return result[0];
  }

  async setOfferSalesPageStatus(
    webinarId: string,
    pageId: string,
    version: number,
    status: "draft" | "published",
  ): Promise<OfferSalesPage | undefined> {
    const publicationGuard = status === "published"
      ? sql`EXISTS (
          SELECT 1 FROM ${webinarOffers}
          WHERE ${webinarOffers.id} = ${offerSalesPages.offerId}
            AND COALESCE(
              ${offerSalesPages.userId},
              ${webinarOffers.userId},
              (SELECT owner_webinar.user_id FROM webinars owner_webinar WHERE owner_webinar.id = ${webinarOffers.webinarId})
            ) = COALESCE(
              ${webinarOffers.userId},
              (SELECT owner_webinar.user_id FROM webinars owner_webinar WHERE owner_webinar.id = ${webinarOffers.webinarId})
            )
            AND COALESCE(
              ${webinarOffers.userId},
              (SELECT owner_webinar.user_id FROM webinars owner_webinar WHERE owner_webinar.id = ${webinarOffers.webinarId})
            ) IS NOT NULL
            AND ${webinarOffers.active} = true
        )`
      : sql`true`;
    const result = await db.update(offerSalesPages).set({
      status,
      publishedAt: status === "published" ? new Date() : null,
      publishedCheckoutSettings: status === "published" ? sql`${offerSalesPages.checkoutSettings}` : offerSalesPages.publishedCheckoutSettings,
      publishedOrderedBlocks: status === "published" ? sql`${offerSalesPages.orderedBlocks}` : offerSalesPages.publishedOrderedBlocks,
      version: sql`${offerSalesPages.version} + 1`,
      updatedAt: new Date(),
    }).where(and(
      eq(offerSalesPages.id, pageId),
      eq(offerSalesPages.webinarId, webinarId),
      eq(offerSalesPages.version, version),
      isNull(offerSalesPages.deletedAt),
      salesPageOwnedByWebinar(webinarId),
      publicationGuard,
    )).returning();
    return result[0];
  }

  async deleteOfferSalesPage(webinarId: string, pageId: string): Promise<boolean> {
    const result = await db.update(offerSalesPages).set({
      status: "draft",
      deletedAt: new Date(),
      updatedAt: new Date(),
    }).where(and(
      eq(offerSalesPages.id, pageId),
      eq(offerSalesPages.webinarId, webinarId),
      isNull(offerSalesPages.deletedAt),
      salesPageOwnedByWebinar(webinarId),
    )).returning({ id: offerSalesPages.id });
    return result.length > 0;
  }

  async getPublicOfferSalesPage(slug: string): Promise<{ page: OfferSalesPage; offer: WebinarOffer } | undefined> {
    const result = await db.select({ page: offerSalesPages, offer: webinarOffers })
      .from(offerSalesPages)
      .innerJoin(webinarOffers, eq(offerSalesPages.offerId, webinarOffers.id))
      .where(and(
        eq(offerSalesPages.slug, slug),
        eq(offerSalesPages.status, "published"),
        isNull(offerSalesPages.deletedAt),
        sql`COALESCE(
          ${offerSalesPages.userId},
          ${webinarOffers.userId},
          (SELECT owner_webinar.user_id FROM webinars owner_webinar WHERE owner_webinar.id = ${webinarOffers.webinarId})
        ) = COALESCE(
          ${webinarOffers.userId},
          (SELECT owner_webinar.user_id FROM webinars owner_webinar WHERE owner_webinar.id = ${webinarOffers.webinarId})
        )`,
        sql`COALESCE(
          ${webinarOffers.userId},
          (SELECT owner_webinar.user_id FROM webinars owner_webinar WHERE owner_webinar.id = ${webinarOffers.webinarId})
        ) IS NOT NULL`,
        eq(webinarOffers.active, true),
      )).limit(1);
    return result[0];
  }

  async getWebinarLandingPage(webinarId: string): Promise<WebinarLandingPage | undefined> {
    const result = await db.select().from(webinarLandingPages).where(eq(webinarLandingPages.webinarId, webinarId)).limit(1);
    return result[0];
  }

  async createWebinarLandingPage(data: InsertWebinarLandingPage): Promise<WebinarLandingPage> {
    await db.insert(webinarLandingPages).values(data).onConflictDoNothing({ target: webinarLandingPages.webinarId });
    const result = await db.select().from(webinarLandingPages).where(eq(webinarLandingPages.webinarId, data.webinarId)).limit(1);
    return result[0];
  }

  async updateWebinarLandingPage(webinarId: string, version: number, data: Partial<Pick<WebinarLandingPage, "title" | "blocks" | "brandSettings">>): Promise<WebinarLandingPage | undefined> {
    const result = await db.update(webinarLandingPages).set({
      ...data, version: sql`${webinarLandingPages.version} + 1`, updatedAt: new Date(),
    }).where(and(eq(webinarLandingPages.webinarId, webinarId), eq(webinarLandingPages.version, version))).returning();
    return result[0];
  }

  async setWebinarLandingPageStatus(webinarId: string, version: number, status: "draft" | "published"): Promise<WebinarLandingPage | undefined> {
    const publicationGuard = status === "published"
      ? sql`EXISTS (SELECT 1 FROM ${webinars} WHERE ${webinars.id} = ${webinarLandingPages.webinarId} AND ${webinars.publishStatus} = 'published')`
      : sql`true`;
    return db.transaction(async (tx) => {
      await lockCourseMarketplace(tx, webinarId);
      const result = await tx.update(webinarLandingPages).set({
        status, publishedAt: status === "published" ? new Date() : null,
        ...(status === "published" ? {
          publishedTitle: webinarLandingPages.title,
          publishedBlocks: webinarLandingPages.blocks,
          publishedBrandSettings: webinarLandingPages.brandSettings,
        } : {}),
        version: sql`${webinarLandingPages.version} + 1`, updatedAt: new Date(),
      }).where(and(eq(webinarLandingPages.webinarId, webinarId), eq(webinarLandingPages.version, version), publicationGuard)).returning();
      if (status === "published" && result[0]) await invalidateCourseMarketplaceListing(tx, webinarId);
      return result[0];
    });
  }

  async getPublicWebinarLandingPage(webinarId: string): Promise<WebinarLandingPage | undefined> {
    const result = await db.select({ page: webinarLandingPages }).from(webinarLandingPages)
      .innerJoin(webinars, eq(webinars.id, webinarLandingPages.webinarId))
      .where(and(eq(webinarLandingPages.webinarId, webinarId), eq(webinarLandingPages.status, "published"), eq(webinars.publishStatus, "published"))).limit(1);
    const page = result[0]?.page;
    if (!page?.publishedTitle || !page.publishedBlocks || !page.publishedBrandSettings) return undefined;
    return {
      ...page,
      title: page.publishedTitle,
      blocks: page.publishedBlocks,
      brandSettings: page.publishedBrandSettings,
    };
  }

  async getPublishedSalesPageCheckoutContext(
    webinarId: string,
    offerId: string,
    salesPageId: string,
  ): Promise<{ page: OfferSalesPage; offer: WebinarOffer } | undefined> {
    // One query binds all public identifiers and availability state immediately
    // before checkout work. Direct sales-page checkout must not inherit CTA trust.
    const result = await db.select({ page: offerSalesPages, offer: webinarOffers })
      .from(offerSalesPages)
      .innerJoin(webinarOffers, eq(offerSalesPages.offerId, webinarOffers.id))
      .where(and(
        eq(offerSalesPages.id, salesPageId),
        eq(offerSalesPages.webinarId, webinarId),
        eq(offerSalesPages.offerId, offerId),
        eq(offerSalesPages.status, "published"),
        isNull(offerSalesPages.deletedAt),
        sql`COALESCE(
          ${offerSalesPages.userId},
          ${webinarOffers.userId},
          (SELECT owner_webinar.user_id FROM webinars owner_webinar WHERE owner_webinar.id = ${webinarOffers.webinarId})
        ) = COALESCE(
          ${webinarOffers.userId},
          (SELECT owner_webinar.user_id FROM webinars owner_webinar WHERE owner_webinar.id = ${webinarOffers.webinarId})
        )`,
        sql`COALESCE(
          ${webinarOffers.userId},
          (SELECT owner_webinar.user_id FROM webinars owner_webinar WHERE owner_webinar.id = ${webinarOffers.webinarId})
        ) IS NOT NULL`,
        eq(webinarOffers.id, offerId),
        eq(webinarOffers.active, true),
        salesPageOwnedByWebinar(webinarId),
      )).limit(1);
    return result[0];
  }

  async createCtaButton(data: InsertCtaButton): Promise<CtaButton> {
    // Client input never controls the stable analytics key.
    const ctaKey = crypto.randomBytes(18).toString("base64url");
    const result = await db.insert(ctaButtons).values({ ...data, ctaKey }).returning();
    return result[0];
  }

  async createLiveCtaButton(data: InsertCtaButton, expiresAt: Date): Promise<CtaButton> {
    const ctaKey = crypto.randomBytes(18).toString("base64url");
    const result = await db.insert(ctaButtons).values({
      ...data,
      ctaKey,
      liveOnly: true,
      expiresAt,
    }).returning();
    return result[0];
  }

  async getCtaButtonsByWebinar(webinarId: string): Promise<CtaButton[]> {
    return db.select().from(ctaButtons)
      .where(and(
        eq(ctaButtons.webinarId, webinarId),
        eq(ctaButtons.liveOnly, false),
        isNull(ctaButtons.archivedAt),
      ))
      .orderBy(asc(ctaButtons.startTime));
  }

  async deleteCtaButton(webinarId: string, id: string): Promise<boolean> {
    return db.transaction(async (tx) => {
      const [cta] = await tx.select({ id: ctaButtons.id }).from(ctaButtons).where(and(
        eq(ctaButtons.id, id), eq(ctaButtons.webinarId, webinarId),
      )).for("update");
      if (!cta) return false;
      const [payment] = await tx.select({ id: webinarPayments.id }).from(webinarPayments).where(and(
        eq(webinarPayments.webinarId, webinarId), eq(webinarPayments.ctaId, id),
      )).limit(1);
      if (payment) {
        await tx.update(ctaButtons).set({ archivedAt: new Date() }).where(and(
          eq(ctaButtons.id, id), eq(ctaButtons.webinarId, webinarId),
        ));
      } else {
        await tx.delete(ctaButtons).where(and(eq(ctaButtons.id, id), eq(ctaButtons.webinarId, webinarId)));
      }
      return true;
    });
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

  async deleteTip(webinarId: string, id: string): Promise<boolean> {
    return (await db.delete(tips).where(and(eq(tips.id, id), eq(tips.webinarId, webinarId)))
      .returning({ id: tips.id })).length === 1;
  }

  async updateTip(webinarId: string, id: string, data: Partial<InsertTip>): Promise<Tip | undefined> {
    const { webinarId: _ignored, ...patch } = data;
    const result = await db.update(tips).set(patch)
      .where(and(eq(tips.id, id), eq(tips.webinarId, webinarId))).returning();
    return result[0];
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

  async deletePoll(webinarId: string, id: string): Promise<boolean> {
    return (await db.delete(polls).where(and(eq(polls.id, id), eq(polls.webinarId, webinarId)))
      .returning({ id: polls.id })).length === 1;
  }

  async updatePoll(webinarId: string, id: string, data: Partial<InsertPoll>): Promise<Poll | undefined> {
    const { webinarId: _ignored, ...patch } = data;
    const result = await db.update(polls).set({
      ...patch,
      ...(patch.options ? { options: patch.options as string[] } : {}),
    }).where(and(eq(polls.id, id), eq(polls.webinarId, webinarId))).returning();
    return result[0];
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

  async updateQuestion(webinarId: string, id: string, data: Partial<Question>): Promise<Question | undefined> {
    const result = await db.update(questions).set(data).where(and(
      eq(questions.id, id), eq(questions.webinarId, webinarId),
    )).returning();
    return result[0];
  }

  async deleteQuestion(webinarId: string, id: string): Promise<boolean> {
    return (await db.delete(questions).where(and(eq(questions.id, id), eq(questions.webinarId, webinarId)))
      .returning({ id: questions.id })).length === 1;
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

  async getFeedbackSurvey(id: string): Promise<FeedbackSurvey | undefined> {
    return (await db.select().from(feedbackSurveys).where(eq(feedbackSurveys.id, id)).limit(1))[0];
  }

  async updateFeedbackSurvey(webinarId: string, id: string, data: Partial<FeedbackSurvey>): Promise<FeedbackSurvey | undefined> {
    const result = await db.update(feedbackSurveys).set(data).where(and(
      eq(feedbackSurveys.id, id), eq(feedbackSurveys.webinarId, webinarId),
    )).returning();
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

  async getLatestViewerProgressForRegistration(webinarId: string, registrationId: string): Promise<ViewerProgress | undefined> {
    const result = await db.select().from(viewerProgress)
      .where(and(eq(viewerProgress.webinarId, webinarId), eq(viewerProgress.registrationId, registrationId)))
      .orderBy(desc(viewerProgress.updatedAt))
      .limit(1);
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
    if (!data.webinarId) throw new Error("Funnel event idempotency conflict");
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

  async getFunnelEventsByRegistration(webinarId: string, registrationId: string): Promise<WebinarFunnelEvent[]> {
    return db.select().from(webinarFunnelEvents)
      .where(and(
        eq(webinarFunnelEvents.webinarId, webinarId),
        eq(webinarFunnelEvents.registrationId, registrationId),
      ))
      .orderBy(asc(webinarFunnelEvents.occurredAt), asc(webinarFunnelEvents.id));
  }

  async getFunnelEventsByRegistrations(webinarId: string, registrationIds: string[]): Promise<WebinarFunnelEvent[]> {
    if (!registrationIds.length) return [];
    return db.select().from(webinarFunnelEvents)
      .where(and(
        eq(webinarFunnelEvents.webinarId, webinarId),
        inArray(webinarFunnelEvents.registrationId, registrationIds),
      ))
      .orderBy(asc(webinarFunnelEvents.occurredAt), asc(webinarFunnelEvents.id));
  }

  // Email Reminders
  async createEmailReminder(data: InsertEmailReminder): Promise<EmailReminder> {
    const insert = db.insert(emailReminders).values(data);
    const isStartReminder = START_REMINDERS.some(item => item.kind === data.reminderType);
    const result = await (isStartReminder ? insert.onConflictDoNothing() : insert).returning();
    if (!result.length && isStartReminder) {
      const [existing] = await db.select().from(emailReminders).where(and(
        eq(emailReminders.registrationId, data.registrationId),
        eq(emailReminders.reminderType, data.reminderType),
      ));
      return existing;
    }
    return result[0];
  }

  async enqueueUpcomingStartReminders(now: Date): Promise<number> {
    // Also cover bookings made before these reminders existed. The partial
    // unique index fences registration requests, restarts and multiple workers.
    const result = await db.execute(sql`
      INSERT INTO email_reminders
        (id, webinar_id, registration_id, reminder_type, scheduled_for, status)
      SELECT gen_random_uuid(), w.id, r.id, timing.kind,
        r.selected_session - timing.minutes_before * interval '1 minute', 'pending'
      FROM registrations r JOIN webinars w ON w.id = r.webinar_id
      CROSS JOIN (VALUES
        ('reminder_5m', 'reminder5mEnabled', 5),
        ('reminder_start', 'reminderStartEnabled', 0),
        ('reminder_no_show_10m', 'reminderNoShow10mEnabled', -10)
      ) AS timing(kind, setting, minutes_before)
      WHERE w.publish_status = 'published' AND r.deleted_at IS NULL
        AND r.selected_session - timing.minutes_before * interval '1 minute' >= ${now.toISOString()}::timestamp
        AND r.selected_session <= ${now.toISOString()}::timestamp + interval '24 hours'
        AND COALESCE(w.email_settings ->> timing.setting,
          w.email_settings ->> 'reminder1hEnabled', 'true') = 'true'
        AND (timing.kind <> 'reminder_no_show_10m' OR (
          COALESCE(NULLIF(w.video_duration, 0), 3600) > 600
          AND NOT EXISTS (
            SELECT 1 FROM registrations a WHERE a.webinar_id = r.webinar_id
              AND a.selected_session = r.selected_session AND a.deleted_at IS NULL
              AND lower(trim(a.email)) = lower(trim(r.email))
              AND (a.attended IS TRUE OR a.attended_at IS NOT NULL OR a.watch_duration > 0)
          )
        ))
        AND NOT EXISTS (
          SELECT 1 FROM webinar_sessions s
          WHERE s.webinar_id = w.id AND s.scheduled_start = r.selected_session AND s.status = 'cancelled'
        )
        AND NOT EXISTS (
          SELECT 1 FROM email_reminders e
          WHERE e.registration_id = r.id AND e.status = 'cancelled'
            AND e.reminder_type IN ('reminder_24h', 'reminder_1h', 'reminder_5m', 'reminder_start', 'reminder_no_show_10m')
        )
      ON CONFLICT DO NOTHING
      RETURNING id
    `);
    return result.rows.length;
  }

  async hasAttendedSession(registration: Registration): Promise<boolean> {
    if (!registration.selectedSession) return false;
    const result = await db.execute(sql`
      SELECT 1 FROM registrations
      WHERE webinar_id = ${registration.webinarId}
        AND selected_session = ${new Date(registration.selectedSession).toISOString()}::timestamp
        AND lower(trim(email)) = lower(trim(${registration.email}))
        AND deleted_at IS NULL
        AND (attended IS TRUE OR attended_at IS NOT NULL OR watch_duration > 0)
      LIMIT 1
    `);
    return result.rows.length > 0;
  }

  async getPendingEmailReminders(before: Date): Promise<EmailReminder[]> {
    return db.select().from(emailReminders)
      .where(and(
        eq(emailReminders.status, "pending"),
        lte(emailReminders.scheduledFor, before)
      ));
  }

  async claimPendingEmailReminders(before: Date, leaseToken: string, limit = EMAIL_CLAIM_BATCH_SIZE): Promise<EmailReminder[]> {
    return db.transaction(async (tx) => {
      // A transaction-scoped lock makes claiming safe across scheduler replicas;
      // expired processing leases are recoverable after a crashed worker.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('email-reminder-claims'))`);
      await tx.update(emailReminders).set({
        status: "failed",
        errorMessage: "Delivery attempts exhausted after worker lease expired",
        leaseToken: null,
        leaseExpiresAt: null,
      }).where(and(
        eq(emailReminders.status, "processing"),
        lte(emailReminders.leaseExpiresAt, before),
        gte(emailReminders.attemptCount, 5),
      ));
      const candidates = await tx.select({ id: emailReminders.id }).from(emailReminders)
        .where(and(
          lte(emailReminders.scheduledFor, before),
          or(
            eq(emailReminders.status, "pending"),
            and(eq(emailReminders.status, "processing"), lt(emailReminders.leaseExpiresAt, before)),
          ),
          lt(emailReminders.attemptCount, 5),
        ))
        .orderBy(asc(emailReminders.scheduledFor))
        .limit(Math.min(EMAIL_CLAIM_BATCH_SIZE, Math.max(1, limit)));
      if (!candidates.length) return [];
      const ids = candidates.map(item => item.id);
      return tx.update(emailReminders).set({
        status: "processing",
        leaseToken,
        leaseExpiresAt: new Date(before.getTime() + EMAIL_LEASE_MS),
        attemptCount: sql`${emailReminders.attemptCount} + 1`,
      }).where(inArray(emailReminders.id, ids)).returning();
    });
  }

  async updateEmailReminder(id: string, data: Partial<EmailReminder>): Promise<void> {
    await db.update(emailReminders).set(data).where(eq(emailReminders.id, id));
  }

  async updateClaimedEmailReminder(id: string, leaseToken: string, data: Partial<EmailReminder>): Promise<boolean> {
    const updated = await db.update(emailReminders).set(data).where(and(
      eq(emailReminders.id, id),
      eq(emailReminders.status, "processing"),
      eq(emailReminders.leaseToken, leaseToken),
    )).returning({ id: emailReminders.id });
    return updated.length === 1;
  }

  async renewClaimedEmailReminder(id: string, leaseToken: string, leaseExpiresAt: Date): Promise<boolean> {
    const updated = await db.update(emailReminders).set({ leaseExpiresAt }).where(and(
      eq(emailReminders.id, id),
      eq(emailReminders.status, "processing"),
      eq(emailReminders.leaseToken, leaseToken),
      gt(emailReminders.leaseExpiresAt, new Date()),
    )).returning({ id: emailReminders.id });
    return updated.length === 1;
  }

  async enqueueDueSequenceReminders(before: Date, limit = 1_000): Promise<number> {
    const boundedLimit = Math.min(5_000, Math.max(1, limit));
    const result = await db.execute(sql`
      WITH candidates AS (
        SELECT
          ${webinars.id} AS webinar_id,
          ${registrations.id} AS registration_id,
          ${emailSequences.id} AS sequence_id,
          ${registrations.selectedSession}
            + make_interval(secs => COALESCE(NULLIF(${webinars.videoDuration}, 0), 3600))
            + make_interval(mins => COALESCE(${emailSequences.delayMinutes}, 0)) AS scheduled_for
        FROM ${registrations}
        INNER JOIN ${webinars} ON ${webinars.id} = ${registrations.webinarId}
        INNER JOIN ${emailSequences} ON ${emailSequences.webinarId} = ${webinars.id}
        WHERE ${webinars.publishStatus} = 'published'
          AND ${emailSequences.enabled} = true
          AND ${registrations.selectedSession} IS NOT NULL
          AND ${registrations.selectedSession}
            + make_interval(secs => COALESCE(NULLIF(${webinars.videoDuration}, 0), 3600)) <= ${before}
          AND (
            ${emailSequences.segment} = 'all'
            OR (${emailSequences.segment} = 'no_show' AND ${registrations.attended} IS NOT TRUE)
            OR (
              ${registrations.attended} IS TRUE
              AND ${emailSequences.segment} = 'watched'
              AND COALESCE(${registrations.watchDuration}, 0)::numeric
                / GREATEST(COALESCE(NULLIF(${webinars.videoDuration}, 0), 3600), 1) >= 0.7
            )
            OR (
              ${registrations.attended} IS TRUE
              AND ${emailSequences.segment} = 'not_watched'
              AND COALESCE(${registrations.watchDuration}, 0)::numeric
                / GREATEST(COALESCE(NULLIF(${webinars.videoDuration}, 0), 3600), 1) < 0.7
            )
          )
          AND NOT EXISTS (
            SELECT 1 FROM ${emailReminders}
            WHERE ${emailReminders.registrationId} = ${registrations.id}
              AND ${emailReminders.sequenceId} = ${emailSequences.id}
          )
        ORDER BY ${registrations.selectedSession}, ${registrations.id}, ${emailSequences.sortOrder}
        LIMIT ${boundedLimit}
      )
      INSERT INTO ${emailReminders}
        (webinar_id, registration_id, reminder_type, sequence_id, scheduled_for, status)
      SELECT webinar_id, registration_id, 'sequence', sequence_id, scheduled_for, 'pending'
      FROM candidates
      ON CONFLICT (registration_id, sequence_id) WHERE sequence_id IS NOT NULL DO NOTHING
      RETURNING id
    `);
    return result.rows.length;
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
    // Only this verified viewer's transcript. Past host broadcasts must not
    // appear as historical conversation for every newly arriving registrant.
    return db.select().from(chatMessages)
      .where(
        and(
          eq(chatMessages.webinarId, webinarId),
          eq(chatMessages.sessionId, sessionId)
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

  async moveWebinarSession(webinarId: string, id: string, data: { scheduledStart: Date }): Promise<WebinarSession | undefined> {
    const result = await db.update(webinarSessions).set({ scheduledStart: data.scheduledStart }).where(and(
      eq(webinarSessions.id, id), eq(webinarSessions.webinarId, webinarId),
    )).returning();
    return result[0];
  }

  async deleteWebinarSession(webinarId: string, id: string): Promise<boolean> {
    return (await db.delete(webinarSessions).where(and(
      eq(webinarSessions.id, id), eq(webinarSessions.webinarId, webinarId),
    )).returning({ id: webinarSessions.id })).length === 1;
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

  async deleteWebhook(webinarId: string, id: string): Promise<boolean> {
    return (await db.delete(webhooks).where(and(eq(webhooks.id, id), eq(webhooks.webinarId, webinarId)))
      .returning({ id: webhooks.id })).length === 1;
  }

  async updateWebhook(webinarId: string, id: string, data: Partial<Webhook>): Promise<Webhook | undefined> {
    const result = await db.update(webhooks).set(data).where(and(
      eq(webhooks.id, id), eq(webhooks.webinarId, webinarId),
    )).returning();
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
