import type { Express, Request } from "express";
import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import {
  memberOrderFiltersSchema,
  memberOrderListQuerySchema,
  updateMemberOrderSchema,
  type MemberOrderFilters,
} from "@shared/memberOrders";
import {
  memberOrderEvents,
  users,
  webinarOffers,
  webinarPayments,
  webinars,
} from "@shared/schema";
import { db } from "./db";

type SessionRequest = Request & { session: { userId?: string } };
const MAX_EXPORT_ROWS = 10_000;
const ownerSql = (userId: string) => sql`COALESCE(${webinarPayments.userId}, ${webinarOffers.userId}, ${webinars.userId}) = ${userId}`;

function iso(value: Date | null | undefined) {
  return value ? value.toISOString() : null;
}

function paymentReference(payment: any): string | null {
  return payment.providerOrderId || payment.stripePaymentIntentId || payment.stripeCheckoutSessionId || null;
}

function snapshot(payment: any, offer: any) {
  const name = payment.productNameSnapshot ?? offer?.ecpayItemName ?? null;
  return {
    product: {
      id: payment.offerId,
      name,
      nameSource: payment.productNameSnapshot ? "recorded" : name ? "legacy_live" : "legacy_missing",
    } as const,
    buyer: {
      name: payment.buyerNameSnapshot,
      email: payment.buyerEmailSnapshot,
      source: (payment.buyerNameSnapshot || payment.buyerEmailSnapshot) ? "recorded" : "legacy_missing",
    } as const,
  };
}

function orderDto(row: any, detail = false) {
  const payment = row.payment;
  const snapshots = snapshot(payment, row.offer);
  const refundedMinor = Math.max(0, Math.min(payment.amountMinor, payment.refundedMinor));
  const provider = payment.paymentProvider === "ecpay" ? "ecpay" : "stripe";
  const receipt = {
    provider,
    providerReference: paymentReference(payment),
    providerStatus: payment.providerStatus,
    ...(detail ? {
      providerStatusMessage: payment.providerStatusMessage,
      refundInformation: provider === "ecpay" ? "external_merchant_status_unknown" : "authoritative",
    } : {}),
  };
  return {
    id: payment.id,
    createdAt: iso(payment.createdAt)!,
    purchasedAt: iso(payment.purchasedAt),
    paymentStatus: payment.status,
    fulfillmentStatus: payment.fulfillmentStatus,
    version: payment.operationVersion,
    ...snapshots,
    money: {
      amountMinor: payment.amountMinor,
      refundedMinor,
      netMinor: Math.max(0, payment.amountMinor - refundedMinor),
      currency: payment.currency,
    },
    receipt,
    ...(detail ? {
      internalNote: payment.internalNote,
      attribution: {
        source: payment.webinarId ? "webinar" : "direct",
        webinarId: payment.webinarId,
        salesPageId: payment.salesPageId,
        originSalesPageId: payment.originSalesPageIdSnapshot,
        ctaId: payment.ctaId,
        registrationId: payment.registrationId,
      },
    } : {}),
  };
}

function conditions(userId: string, filters: MemberOrderFilters) {
  return [
    ownerSql(userId),
    ...(filters.productId ? [eq(webinarPayments.offerId, filters.productId)] : []),
    ...(filters.paymentStatus ? [eq(webinarPayments.status, filters.paymentStatus)] : []),
    ...(filters.fulfillmentStatus ? [eq(webinarPayments.fulfillmentStatus, filters.fulfillmentStatus)] : []),
    ...(filters.currency ? [eq(webinarPayments.currency, filters.currency)] : []),
    ...(filters.from ? [sql`${webinarPayments.createdAt} >= ${new Date(filters.from)}`] : []),
    ...(filters.to ? [sql`${webinarPayments.createdAt} <= ${new Date(filters.to)}`] : []),
    ...(filters.q ? [or(
      ilike(webinarPayments.id, `%${filters.q}%`),
      ilike(webinarPayments.providerOrderId, `%${filters.q}%`),
      ilike(webinarPayments.stripePaymentIntentId, `%${filters.q}%`),
      ilike(webinarPayments.stripeCheckoutSessionId, `%${filters.q}%`),
      ilike(webinarPayments.buyerNameSnapshot, `%${filters.q}%`),
      ilike(webinarPayments.buyerEmailSnapshot, `%${filters.q}%`),
      ilike(webinarPayments.productNameSnapshot, `%${filters.q}%`),
      ilike(webinarOffers.ecpayItemName, `%${filters.q}%`),
    )] : []),
  ];
}

function baseQuery(userId: string, filters: MemberOrderFilters) {
  return db.select({ payment: webinarPayments, offer: webinarOffers })
    .from(webinarPayments)
    .innerJoin(webinarOffers, eq(webinarPayments.offerId, webinarOffers.id))
    .leftJoin(webinars, eq(webinarOffers.webinarId, webinars.id))
    .where(and(...conditions(userId, filters)));
}

/** Provider and operations code use this helper to retain a safe audit trail. */
export async function appendMemberOrderEvent(tx: any, input: {
  paymentId: string;
  type: string;
  actorUserId?: string | null;
  reason?: string | null;
  details?: Record<string, string | number | boolean | null>;
}) {
  await tx.insert(memberOrderEvents).values({
    paymentId: input.paymentId,
    eventType: input.type,
    actorUserId: input.actorUserId || null,
    reason: input.reason || null,
    details: input.details || {},
  });
}

async function requireActiveMember(req: SessionRequest, res: any): Promise<string | undefined> {
  const userId = req.session?.userId;
  if (!userId) {
    res.status(401).json({ message: "Unauthorized" });
    return undefined;
  }
  const [user] = await db.select({ id: users.id, isActive: users.isActive })
    .from(users).where(eq(users.id, userId)).limit(1);
  if (!user?.isActive) {
    res.status(403).json({ message: "Forbidden" });
    return undefined;
  }
  return user.id;
}

function csvCell(value: unknown) {
  let text = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, "\"\"")}"`;
}

export function registerMemberOrderRoutes(app: Express) {
  app.get("/api/member/orders/product-filters", async (req: SessionRequest, res) => {
    try {
      const userId = await requireActiveMember(req, res);
      if (!userId) return;
      const rows = await db.select({ id: webinarOffers.id, name: webinarOffers.ecpayItemName })
        .from(webinarOffers)
        .leftJoin(webinars, eq(webinarOffers.webinarId, webinars.id))
        .where(sql`COALESCE(${webinarOffers.userId}, ${webinars.userId}) = ${userId}`)
        .orderBy(webinarOffers.ecpayItemName, webinarOffers.id)
        .limit(501);
      res.json({
        items: rows.slice(0, 500).map(row => ({
          id: row.id,
          name: row.name,
          nameSource: row.name ? "legacy_live" : "legacy_missing",
        })),
        truncated: rows.length > 500,
      });
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.get("/api/member/orders/summary", async (req: SessionRequest, res) => {
    try {
      const userId = await requireActiveMember(req, res);
      if (!userId) return;
      const filters = memberOrderFiltersSchema.parse(req.query);
      const rows = await db.select({
        currency: webinarPayments.currency,
        pending: sql<number>`count(*) filter (where ${webinarPayments.status} = 'pending')`,
        paid: sql<number>`count(*) filter (where ${webinarPayments.status} = 'paid')`,
        failed: sql<number>`count(*) filter (where ${webinarPayments.status} = 'failed')`,
        partiallyRefunded: sql<number>`count(*) filter (where ${webinarPayments.status} = 'partially_refunded')`,
        refunded: sql<number>`count(*) filter (where ${webinarPayments.status} = 'refunded')`,
        gross: sql<number>`coalesce(sum(case when ${webinarPayments.status} in ('paid', 'partially_refunded', 'refunded') then ${webinarPayments.amountMinor} else 0 end), 0)`,
        refundedMinor: sql<number>`coalesce(sum(case when ${webinarPayments.status} in ('paid', 'partially_refunded', 'refunded') then least(greatest(${webinarPayments.refundedMinor}, 0), ${webinarPayments.amountMinor}) else 0 end), 0)`,
      }).from(webinarPayments)
        .innerJoin(webinarOffers, eq(webinarPayments.offerId, webinarOffers.id))
        .leftJoin(webinars, eq(webinarOffers.webinarId, webinars.id))
        .where(and(...conditions(userId, filters)))
        .groupBy(webinarPayments.currency)
        .orderBy(webinarPayments.currency);
      res.json({ currencies: rows.map(row => {
        const gross = Number(row.gross);
        const refunds = Number(row.refundedMinor);
        return {
          currency: row.currency,
          counts: {
            pending: Number(row.pending), paid: Number(row.paid), failed: Number(row.failed),
            partially_refunded: Number(row.partiallyRefunded), refunded: Number(row.refunded),
          },
          paidGrossMinor: gross,
          refundedMinor: refunds,
          netMinor: gross - refunds,
        };
      }) });
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.get("/api/member/orders/export.csv", async (req: SessionRequest, res) => {
    try {
      const userId = await requireActiveMember(req, res);
      if (!userId) return;
      const filters = memberOrderFiltersSchema.parse(req.query);
      const rows = await baseQuery(userId, filters)
        .orderBy(desc(webinarPayments.createdAt), desc(webinarPayments.id)).limit(MAX_EXPORT_ROWS + 1);
      const emitted = rows.slice(0, MAX_EXPORT_ROWS);
      const header = ["id", "createdAt", "purchasedAt", "paymentStatus", "fulfillmentStatus", "productName", "buyerName", "buyerEmail", "amountMinor", "refundedMinor", "netMinor", "currency", "provider", "providerReference"];
      const body = emitted.map(row => {
        const dto = orderDto(row);
        return [
          dto.id, dto.createdAt, dto.purchasedAt, dto.paymentStatus, dto.fulfillmentStatus,
          dto.product.name, dto.buyer.name, dto.buyer.email, dto.money.amountMinor,
          dto.money.refundedMinor, dto.money.netMinor, dto.money.currency,
          dto.receipt.provider, dto.receipt.providerReference,
        ].map(csvCell).join(",");
      });
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", "attachment; filename=\"member-orders.csv\"");
      res.setHeader("X-Export-Truncated", String(rows.length > MAX_EXPORT_ROWS));
      res.setHeader("X-Export-Row-Count", String(emitted.length));
      res.send([header.map(csvCell).join(","), ...body].join("\r\n"));
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.get("/api/member/orders", async (req: SessionRequest, res) => {
    try {
      const userId = await requireActiveMember(req, res);
      if (!userId) return;
      const query = memberOrderListQuerySchema.parse(req.query);
      const { page, pageSize, ...filters } = query;
      const [rows, totalRows] = await Promise.all([
        baseQuery(userId, filters).orderBy(desc(webinarPayments.createdAt), desc(webinarPayments.id))
          .limit(pageSize).offset((page - 1) * pageSize),
        db.select({ count: sql<number>`count(*)` }).from(webinarPayments)
          .innerJoin(webinarOffers, eq(webinarPayments.offerId, webinarOffers.id))
          .leftJoin(webinars, eq(webinarOffers.webinarId, webinars.id))
          .where(and(...conditions(userId, filters))),
      ]);
      res.json({ items: rows.map(row => orderDto(row)), page, pageSize, total: Number(totalRows[0]?.count || 0) });
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.get("/api/member/orders/:id", async (req: SessionRequest, res) => {
    try {
      const userId = await requireActiveMember(req, res);
      if (!userId) return;
      const [row] = await db.select({ payment: webinarPayments, offer: webinarOffers })
        .from(webinarPayments)
        .innerJoin(webinarOffers, eq(webinarPayments.offerId, webinarOffers.id))
        .leftJoin(webinars, eq(webinarOffers.webinarId, webinars.id))
        .where(and(ownerSql(userId), eq(webinarPayments.id, String(req.params.id))))
        .limit(1);
      if (!row) return res.status(404).json({ message: "Order not found" });
      const events = await db.select().from(memberOrderEvents)
        .where(eq(memberOrderEvents.paymentId, row.payment.id))
        .orderBy(memberOrderEvents.occurredAt, memberOrderEvents.id);
      res.json({
        ...orderDto(row, true),
        events: events.map(event => ({
          id: event.id,
          type: event.eventType,
          occurredAt: iso(event.occurredAt)!,
          actor: event.actorUserId ? "member" : "provider",
          reason: event.reason,
          details: event.details,
        })),
      });
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.patch("/api/member/orders/:id", async (req: SessionRequest, res) => {
    try {
      const userId = await requireActiveMember(req, res);
      if (!userId) return;
      const input = updateMemberOrderSchema.parse(req.body);
      const response = await db.transaction(async tx => {
        // Hold the payment row through validation and the versioned update.
        // Authenticated callbacks use the same row lock, so a refund/payment
        // transition cannot race a stale fulfillment completion.
        await tx.execute(sql`
          SELECT 1
          FROM webinar_payments payment
          LEFT JOIN webinar_offers offer ON offer.id = payment.offer_id
          LEFT JOIN webinars webinar ON webinar.id = offer.webinar_id
          WHERE payment.id = ${String(req.params.id)}
            AND COALESCE(payment.user_id, offer.user_id, webinar.user_id) = ${userId}
          FOR UPDATE OF payment
        `);
        const [row] = await tx.select({ payment: webinarPayments, offer: webinarOffers })
          .from(webinarPayments).innerJoin(webinarOffers, eq(webinarPayments.offerId, webinarOffers.id))
          .leftJoin(webinars, eq(webinarOffers.webinarId, webinars.id))
          .where(and(ownerSql(userId), eq(webinarPayments.id, String(req.params.id)))).limit(1);
        if (!row) return { kind: "missing" as const };
        const payment = row.payment;
        if (payment.operationVersion !== input.expectedVersion) return { kind: "conflict" as const };
        if (input.fulfillmentStatus === "completed" && (
          !["paid", "partially_refunded"].includes(payment.status) ||
          payment.amountMinor - Math.min(payment.amountMinor, Math.max(0, payment.refundedMinor)) <= 0
        )) return { kind: "invalid" as const, message: "Completed fulfillment requires a paid order with positive net amount" };
        const [updated] = await tx.update(webinarPayments).set({
          ...(input.internalNote !== undefined ? { internalNote: input.internalNote } : {}),
          ...(input.fulfillmentStatus !== undefined ? { fulfillmentStatus: input.fulfillmentStatus } : {}),
          operationVersion: sql`${webinarPayments.operationVersion} + 1`,
          operationMetadata: { reason: input.reason, changedAt: new Date().toISOString() },
          updatedAt: new Date(),
        }).where(and(
          eq(webinarPayments.id, payment.id),
          eq(webinarPayments.operationVersion, input.expectedVersion),
        )).returning();
        if (!updated) return { kind: "conflict" as const };
        await appendMemberOrderEvent(tx, {
          paymentId: payment.id, type: input.fulfillmentStatus !== undefined ? "fulfillment_changed" : "internal_note_changed",
          actorUserId: userId, reason: input.reason,
          details: {
            internalNoteChanged: input.internalNote !== undefined,
            fulfillmentFrom: input.fulfillmentStatus !== undefined ? payment.fulfillmentStatus : null,
            fulfillmentTo: input.fulfillmentStatus ?? null,
          },
        });
        return { kind: "ok" as const, row: { payment: updated, offer: row.offer } };
      });
      if (response.kind === "missing") return res.status(404).json({ message: "Order not found" });
      if (response.kind === "conflict") return res.status(409).json({ message: "Version conflict", code: "VERSION_CONFLICT" });
      if (response.kind === "invalid") return res.status(409).json({ message: response.message });
      res.json(orderDto(response.row, true));
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });
}