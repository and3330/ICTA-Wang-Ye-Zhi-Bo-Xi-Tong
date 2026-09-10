import type { Express, NextFunction, Request, RequestHandler, Response } from "express";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "./db";
import {
  bunnyVideoStatus,
  getBunnyMediaClient,
  MAX_IMAGE_BYTES,
  MAX_TOTAL_VIDEO_BYTES,
  MAX_VIDEO_BYTES,
  MediaProviderError,
} from "./bunnyMedia";
import { mediaAssets, type MediaAsset } from "@shared/schema";
import type { BunnyMediaClient } from "./bunnyMedia";

const videoInputSchema = z.object({
  name: z.string().trim().min(1).max(200),
  sizeBytes: z.number().int().positive().max(MAX_VIDEO_BYTES),
  contentType: z.enum(["video/mp4", "video/webm", "video/quicktime", "video/x-m4v"]),
}).strict();
const idSchema = z.string().uuid();

function dto(asset: MediaAsset) {
  return {
    id: asset.id,
    kind: asset.kind,
    provider: asset.provider,
    name: asset.name,
    status: asset.status,
    sizeBytes: asset.sizeBytes,
    ...(asset.durationSeconds == null ? {} : { durationSeconds: asset.durationSeconds }),
    ...(asset.url ? { url: asset.url } : {}),
    ...(asset.thumbnailUrl ? { thumbnailUrl: asset.thumbnailUrl } : {}),
    createdAt: asset.createdAt,
  };
}

function providerFailure(error: unknown, res: Response) {
  if (error instanceof MediaProviderError) {
    const status = error.code === "MEDIA_NOT_CONFIGURED" ? 503 : 502;
    return res.status(status).json({ message: error.message, code: error.code });
  }
  return res.status(500).json({ message: "Media operation failed" });
}

async function referenceExists(executor: Pick<typeof db, "execute">, asset: MediaAsset) {
  const references = await executor.execute(sql`
    SELECT 1 FROM webinars
     WHERE video_asset_id = ${asset.id}
        OR (${asset.url}::text IS NOT NULL AND (
          cover_image = ${asset.url} OR position(${asset.url || ""} in COALESCE(brand_settings::text, '')) > 0
        ))
    UNION ALL
    SELECT 1 FROM webinar_landing_pages
     WHERE position(${asset.id} in COALESCE(blocks::text, '')) > 0
        OR position(${asset.id} in COALESCE(published_blocks::text, '')) > 0
        OR (${asset.url}::text IS NOT NULL AND (
          position(${asset.url || ""} in COALESCE(blocks::text, '')) > 0
          OR position(${asset.url || ""} in COALESCE(published_blocks::text, '')) > 0
        ))
    UNION ALL
    SELECT 1 FROM offer_sales_pages
     WHERE ${asset.url}::text IS NOT NULL AND (
       position(${asset.url || ""} in COALESCE(ordered_blocks::text, '')) > 0
       OR position(${asset.url || ""} in COALESCE(published_ordered_blocks::text, '')) > 0
     )
    UNION ALL
    SELECT 1 FROM fake_users WHERE ${asset.url}::text IS NOT NULL AND avatar = ${asset.url}
    LIMIT 1
  `);
  return references.rows.length > 0;
}

export async function deleteOwnedMediaAsset(userId: string, id: string, deleteLegacy?: (asset: MediaAsset) => Promise<void>) {
  const fenced = await db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`media-delete:${id}`}))`);
    await tx.execute(sql`SELECT id FROM media_assets WHERE id = ${id} AND user_id = ${userId} FOR UPDATE`);
    const [asset] = await tx.select().from(mediaAssets)
      .where(and(eq(mediaAssets.id, id), eq(mediaAssets.userId, userId))).limit(1);
    if (!asset) return { outcome: "not_found" as const };
    if (await referenceExists(tx as any, asset)) return { outcome: "referenced" as const };
    const [marked] = await tx.update(mediaAssets).set({ deletingAt: new Date(), updatedAt: new Date() })
      .where(and(eq(mediaAssets.id, id), eq(mediaAssets.userId, userId))).returning();
    return { outcome: "fenced" as const, asset: marked };
  });
  if (fenced.outcome !== "fenced") return fenced;
  const asset = fenced.asset;
  try {
    if (asset.provider === "bunny_stream" && asset.providerId) await getBunnyMediaClient().deleteVideo(asset.providerId);
    if (asset.provider === "bunny_storage" && asset.storageKey) await getBunnyMediaClient().deleteImage(asset.storageKey);
    if (asset.provider === "legacy" && deleteLegacy) await deleteLegacy(asset);
  } catch (error) {
    await db.update(mediaAssets).set({ deletingAt: null, updatedAt: new Date() })
      .where(and(eq(mediaAssets.id, asset.id), eq(mediaAssets.userId, userId)));
    throw error;
  }
  const finalized = await db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`media-delete:${id}`}))`);
    if (await referenceExists(tx as any, asset)) {
      await tx.update(mediaAssets).set({
        deletingAt: null,
        status: "failed",
        errorCode: "PROVIDER_DELETED_DURING_REFERENCE_RACE",
        updatedAt: new Date(),
      }).where(eq(mediaAssets.id, id));
      return { outcome: "referenced" as const };
    }
    if (asset.url) {
      await tx.execute(sql`
        INSERT INTO deleted_media_urls (url, user_id, deleted_at)
        VALUES (${asset.url}, ${userId}, now())
        ON CONFLICT (url) DO NOTHING
      `);
    }
    await tx.execute(sql`DELETE FROM uploaded_assets WHERE user_id = ${userId} AND (
      (${asset.url}::text IS NOT NULL AND url = ${asset.url}) OR
      (${asset.storageKey}::text IS NOT NULL AND storage_key = ${asset.storageKey})
    )`);
    await tx.delete(mediaAssets).where(and(eq(mediaAssets.id, id), eq(mediaAssets.userId, userId)));
    return { outcome: "deleted" as const };
  });
  return finalized;
}

async function ownedAsset(userId: string, id: string) {
  const [asset] = await db.select().from(mediaAssets)
    .where(and(eq(mediaAssets.id, id), eq(mediaAssets.userId, userId))).limit(1);
  return asset;
}

export async function resolveReadyOwnedVideoAsset(userId: string, id: string) {
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) return undefined;
  const [asset] = await db.select().from(mediaAssets).where(and(
    eq(mediaAssets.id, id),
    eq(mediaAssets.userId, userId),
    eq(mediaAssets.kind, "video"),
    eq(mediaAssets.provider, "bunny_stream"),
    eq(mediaAssets.status, "ready"),
    sql`${mediaAssets.deletingAt} IS NULL`,
  )).limit(1);
  return asset;
}

async function syncVideo(asset: MediaAsset, client: BunnyMediaClient) {
  if (!asset.providerId) return asset;
  const remote = await client.getVideo(asset.providerId);
  const status = bunnyVideoStatus(remote.status);
  const providerBytes = Math.ceil(remote.storageSize || 0);
  const reconciliation = await db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`media-video:${asset.userId}`}))`);
    const usage = await tx.execute(sql`
      SELECT COALESCE(SUM(CASE WHEN id = ${asset.id} THEN 0 ELSE size_bytes END), 0)::bigint AS other_used
      FROM media_assets
      WHERE user_id = ${asset.userId} AND kind = 'video' AND status <> 'failed'
    `);
    const otherUsed = Number((usage.rows[0] as { other_used: string }).other_used);
    const { verifiedBytes, overLimit } = reconcileVideoReservation(Number(asset.sizeBytes), providerBytes, otherUsed);
    const [updated] = await tx.update(mediaAssets).set({
      sizeBytes: verifiedBytes,
      status: overLimit ? "processing" : status,
      durationSeconds: !overLimit && status === "ready" && Number.isFinite(remote.length)
        ? Math.max(0, Math.round(remote.length!))
        : asset.durationSeconds,
      errorCode: overLimit ? "VERIFIED_SIZE_LIMIT_EXCEEDED" : status === "failed" ? "PROVIDER_PROCESSING_FAILED" : null,
      updatedAt: new Date(),
    }).where(and(eq(mediaAssets.id, asset.id), eq(mediaAssets.userId, asset.userId))).returning();
    return { asset: updated, overLimit };
  });
  if (!reconciliation.overLimit) return reconciliation.asset;

  try {
    await client.deleteVideo(asset.providerId);
    const failed = await db.transaction(async tx => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`media-video:${asset.userId}`}))`);
      const [updated] = await tx.update(mediaAssets).set({
        status: "failed",
        updatedAt: new Date(),
      }).where(and(eq(mediaAssets.id, asset.id), eq(mediaAssets.userId, asset.userId))).returning();
      return updated;
    });
    return failed;
  } catch {
    // Keep status non-failed and the verified reservation charged while a
    // provider object may still exist.
    return reconciliation.asset;
  }
}

export function reconcileVideoReservation(declaredBytes: number, providerBytes: number, otherUsedBytes: number) {
  const verifiedBytes = Math.max(declaredBytes, providerBytes);
  return {
    verifiedBytes,
    overLimit: verifiedBytes > MAX_VIDEO_BYTES || otherUsedBytes + verifiedBytes > MAX_TOTAL_VIDEO_BYTES,
  };
}

export function registerBunnyMediaRoutes(
  app: Express,
  requireAuth: RequestHandler,
  rateLimit: RequestHandler,
) {
  app.use("/api/media", rateLimit);

  app.get("/api/media/config", requireAuth, (_req, res) => {
    const client = getBunnyMediaClient();
    res.json({
      videoEnabled: client.streamEnabled(),
      imageEnabled: client.imageEnabled(),
      playbackEnabled: client.playbackEnabled(),
      maxVideoBytes: MAX_VIDEO_BYTES,
      maxImageBytes: MAX_IMAGE_BYTES,
      maxTotalVideoBytes: MAX_TOTAL_VIDEO_BYTES,
    });
  });

  app.get("/api/media", requireAuth, async (req, res) => {
    const assets = await db.select().from(mediaAssets)
      .where(eq(mediaAssets.userId, req.session.userId!))
      .orderBy(desc(mediaAssets.createdAt));
    const videoBytes = assets
      .filter(asset => asset.kind === "video" && asset.status !== "failed")
      .reduce((sum, asset) => sum + Number(asset.sizeBytes), 0);
    res.json({ assets: assets.map(dto), usage: { videoBytes, maxVideoBytes: MAX_TOTAL_VIDEO_BYTES } });
  });

  app.post("/api/media/videos", requireAuth, async (req, res) => {
    const parsed = videoInputSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid video upload request" });
    const userId = req.session.userId!;
    const client = getBunnyMediaClient();
    if (!client.streamEnabled()) return res.status(503).json({ message: "Video uploads are unavailable", code: "MEDIA_NOT_CONFIGURED" });

    let reserved: MediaAsset | undefined;
    let remoteId: string | undefined;
    let remoteCleanupSucceeded = false;
    try {
      reserved = await db.transaction(async tx => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`media-video:${userId}`}))`);
        const result = await tx.execute(sql`
          SELECT COALESCE(SUM(size_bytes), 0)::bigint AS used
          FROM media_assets
          WHERE user_id = ${userId} AND kind = 'video' AND status <> 'failed'
        `);
        const used = Number((result.rows[0] as { used: string }).used);
        if (!Number.isSafeInteger(used) || used + parsed.data.sizeBytes > MAX_TOTAL_VIDEO_BYTES) return undefined;
        const [asset] = await tx.insert(mediaAssets).values({
          userId,
          kind: "video",
          provider: "bunny_stream",
          name: parsed.data.name,
          status: "uploading",
          sizeBytes: parsed.data.sizeBytes,
          contentType: parsed.data.contentType,
        }).returning();
        return asset;
      });
      if (!reserved) return res.status(409).json({ message: "Video storage limit exceeded", code: "MEDIA_QUOTA_EXCEEDED" });

      const remote = await client.createVideo(parsed.data.name);
      remoteId = remote.guid;
      try {
        const [asset] = await db.update(mediaAssets).set({
          providerId: remote.guid,
          status: bunnyVideoStatus(remote.status),
          updatedAt: new Date(),
        }).where(and(eq(mediaAssets.id, reserved.id), eq(mediaAssets.userId, userId))).returning();
        const upload = client.createUploadAuthorization(remote.guid);
        return res.status(201).json({ asset: dto(asset), upload });
      } catch (error) {
        try {
          await client.deleteVideo(remote.guid);
          remoteCleanupSucceeded = true;
        } catch {
          // Keep the quota reservation when cleanup is uncertain.
        }
        throw error;
      }
    } catch (error) {
      if (reserved) {
        const safeToRelease = error instanceof MediaProviderError
          ? error.code === "MEDIA_PROVIDER_REJECTED"
          : Boolean(remoteId && remoteCleanupSucceeded);
        await db.update(mediaAssets).set({
          status: safeToRelease ? "failed" : "uploading",
          errorCode: safeToRelease ? "PROVIDER_CREATE_FAILED" : "PROVIDER_CLEANUP_PENDING",
          updatedAt: new Date(),
        }).where(eq(mediaAssets.id, reserved.id));
      }
      return providerFailure(error, res);
    }
  });

  app.get("/api/media/:id", requireAuth, async (req, res) => {
    const id = idSchema.safeParse(req.params.id);
    if (!id.success) return res.status(404).json({ message: "Media asset not found" });
    const asset = await ownedAsset(req.session.userId!, id.data);
    if (!asset) return res.status(404).json({ message: "Media asset not found" });
    res.json(dto(asset));
  });

  const refresh = async (req: Request, res: Response) => {
    const id = idSchema.safeParse(req.params.id);
    if (!id.success) return res.status(404).json({ message: "Media asset not found" });
    const asset = await ownedAsset(req.session.userId!, id.data);
    if (!asset) return res.status(404).json({ message: "Media asset not found" });
    if (asset.provider !== "bunny_stream") return res.json(dto(asset));
    try {
      return res.json(dto(await syncVideo(asset, getBunnyMediaClient())));
    } catch (error) {
      return providerFailure(error, res);
    }
  };
  app.post("/api/media/:id/refresh", requireAuth, refresh);

  app.post("/api/media/:id/upload-authorization", requireAuth, async (req, res) => {
    const id = idSchema.safeParse(req.params.id);
    if (!id.success) return res.status(404).json({ message: "Media asset not found" });
    const asset = await ownedAsset(req.session.userId!, id.data);
    if (!asset || asset.kind !== "video" || asset.provider !== "bunny_stream" || !asset.providerId) {
      return res.status(404).json({ message: "Media asset not found" });
    }
    if (asset.deletingAt || asset.status === "failed" || asset.status === "ready") {
      return res.status(409).json({ message: "Video is not accepting uploads" });
    }
    try {
      // Verify ownership/status against Bunny before issuing a resumable-upload renewal.
      const client = getBunnyMediaClient();
      const synced = await syncVideo(asset, client);
      if (synced.status === "failed" || synced.status === "ready") {
        return res.status(409).json({ message: "Video is not accepting uploads" });
      }
      return res.json({ upload: client.createUploadAuthorization(asset.providerId) });
    } catch (error) {
      return providerFailure(error, res);
    }
  });

  app.get("/api/media/:id/playback", requireAuth, async (req, res) => {
    const id = idSchema.safeParse(req.params.id);
    if (!id.success) return res.status(404).json({ message: "Media asset not found" });
    const asset = await ownedAsset(req.session.userId!, id.data);
    if (!asset || asset.kind !== "video" || asset.provider !== "bunny_stream" || !asset.providerId) {
      return res.status(404).json({ message: "Media asset not found" });
    }
    if (asset.deletingAt || asset.status !== "ready") return res.status(409).json({ message: "Video is not ready" });
    try {
      return res.json(getBunnyMediaClient().playback(asset.providerId));
    } catch (error) {
      return providerFailure(error, res);
    }
  });

  app.delete("/api/media/:id", requireAuth, async (req, res) => {
    const id = idSchema.safeParse(req.params.id);
    if (!id.success) return res.status(404).json({ message: "Media asset not found" });
    const userId = req.session.userId!;
    const asset = await ownedAsset(userId, id.data);
    if (!asset) return res.status(404).json({ message: "Media asset not found" });
    try {
      const result = await deleteOwnedMediaAsset(userId, asset.id);
      if (result.outcome === "referenced") return res.status(409).json({ message: "Media asset is referenced and cannot be deleted" });
      if (result.outcome === "not_found") return res.status(404).json({ message: "Media asset not found" });
      return res.json({ success: true });
    } catch (error) {
      // Metadata is intentionally retained when provider deletion fails.
      return providerFailure(error, res);
    }
  });
}
