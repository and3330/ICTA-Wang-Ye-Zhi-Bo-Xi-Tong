import crypto from "node:crypto";

export const MAX_VIDEO_BYTES = 2 * 1024 * 1024 * 1024;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_TOTAL_VIDEO_BYTES = 10 * 1024 * 1024 * 1024;

type Fetch = typeof globalThis.fetch;

export class MediaProviderError extends Error {
  constructor(
    public readonly code: "MEDIA_NOT_CONFIGURED" | "MEDIA_PROVIDER_UNAVAILABLE" | "MEDIA_PROVIDER_REJECTED",
    message: string,
    public readonly httpStatus?: number,
  ) {
    super(message);
  }
}

export type BunnyMediaConfig = {
  streamApiKey?: string;
  streamLibraryId?: string;
  streamTokenKey?: string;
  storageAccessKey?: string;
  storageZone?: string;
  storageHost: string;
  cdnBaseUrl?: string;
};

function validLibraryId(value: string | undefined): value is string {
  return Boolean(value && /^\d+$/.test(value));
}

function validateStorageHost(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (normalized !== "storage.bunnycdn.com" && !/^[a-z]{2}\.storage\.bunnycdn\.com$/.test(normalized)) {
    throw new MediaProviderError("MEDIA_NOT_CONFIGURED", "Media storage host is invalid");
  }
  return normalized;
}

function validateCdnBaseUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) throw new Error();
    return url.toString().replace(/\/+$/, "");
  } catch {
    throw new MediaProviderError("MEDIA_NOT_CONFIGURED", "Media CDN URL is invalid");
  }
}

export function readBunnyMediaConfig(env: NodeJS.ProcessEnv = process.env): BunnyMediaConfig {
  return {
    streamApiKey: env.BUNNY_STREAM_API_KEY,
    streamLibraryId: env.BUNNY_STREAM_LIBRARY_ID,
    // A configured key does not enable Bunny's library-side authentication.
    // Only enable playback after a real signed/unsigned embed check succeeds.
    streamTokenKey: env.BUNNY_STREAM_PLAYBACK_VERIFIED === "true"
      ? env.BUNNY_STREAM_TOKEN_KEY
      : undefined,
    storageAccessKey: env.BUNNY_STORAGE_ACCESS_KEY,
    storageZone: env.BUNNY_STORAGE_ZONE,
    storageHost: env.BUNNY_STORAGE_HOST || "storage.bunnycdn.com",
    cdnBaseUrl: env.BUNNY_CDN_BASE_URL,
  };
}

export type BunnyVideo = {
  guid: string;
  status: number;
  length?: number;
  storageSize?: number;
  thumbnailFileName?: string;
};

export class BunnyMediaClient {
  constructor(
    private readonly config: BunnyMediaConfig = readBunnyMediaConfig(),
    private readonly fetchImpl: Fetch = globalThis.fetch,
  ) {}

  streamEnabled() {
    return Boolean(this.config.streamApiKey && validLibraryId(this.config.streamLibraryId));
  }

  imageEnabled() {
    if (!this.config.storageAccessKey || !this.config.storageZone || !this.config.cdnBaseUrl) return false;
    try {
      validateStorageHost(this.config.storageHost);
      validateCdnBaseUrl(this.config.cdnBaseUrl);
      return /^[A-Za-z0-9_-]+$/.test(this.config.storageZone);
    } catch {
      return false;
    }
  }

  playbackEnabled() {
    return this.streamEnabled() && Boolean(this.config.streamTokenKey);
  }

  private streamCredentials() {
    if (!this.streamEnabled()) throw new MediaProviderError("MEDIA_NOT_CONFIGURED", "Video uploads are unavailable");
    return { apiKey: this.config.streamApiKey!, libraryId: this.config.streamLibraryId! };
  }

  private storageCredentials() {
    if (!this.imageEnabled()) throw new MediaProviderError("MEDIA_NOT_CONFIGURED", "Image uploads are unavailable");
    const zone = this.config.storageZone!;
    if (!/^[A-Za-z0-9_-]+$/.test(zone)) throw new MediaProviderError("MEDIA_NOT_CONFIGURED", "Media storage zone is invalid");
    return {
      accessKey: this.config.storageAccessKey!,
      zone,
      host: validateStorageHost(this.config.storageHost),
      cdnBaseUrl: validateCdnBaseUrl(this.config.cdnBaseUrl)!,
    };
  }

  private async request(url: string, init: RequestInit, attempts = 1): Promise<Response> {
    let lastError: unknown;
    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        const response = await this.fetchImpl(url, { ...init, signal: AbortSignal.timeout(8_000) });
        if (response.ok) return response;
        if (response.status >= 500 && attempt + 1 < attempts) continue;
        throw new MediaProviderError(
          response.status >= 500 ? "MEDIA_PROVIDER_UNAVAILABLE" : "MEDIA_PROVIDER_REJECTED",
          "Media provider rejected the request",
          response.status,
        );
      } catch (error) {
        lastError = error;
        if (error instanceof MediaProviderError && error.code === "MEDIA_PROVIDER_REJECTED") throw error;
      }
    }
    if (lastError instanceof MediaProviderError) throw lastError;
    throw new MediaProviderError("MEDIA_PROVIDER_UNAVAILABLE", "Media provider is temporarily unavailable");
  }

  async createVideo(title: string): Promise<BunnyVideo> {
    const { apiKey, libraryId } = this.streamCredentials();
    const response = await this.request(`https://video.bunnycdn.com/library/${libraryId}/videos`, {
      method: "POST",
      headers: { AccessKey: apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
    const video = await response.json() as BunnyVideo;
    if (!validVideoResponse(video)) {
      throw new MediaProviderError("MEDIA_PROVIDER_UNAVAILABLE", "Media provider returned an invalid response");
    }
    return video;
  }

  async getVideo(videoId: string): Promise<BunnyVideo> {
    const { apiKey, libraryId } = this.streamCredentials();
    const response = await this.request(`https://video.bunnycdn.com/library/${libraryId}/videos/${encodeURIComponent(videoId)}`, {
      method: "GET",
      headers: { AccessKey: apiKey },
    }, 3);
    const video = await response.json() as BunnyVideo;
    if (!validVideoResponse(video) || video.guid.toLowerCase() !== videoId.toLowerCase()) {
      throw new MediaProviderError("MEDIA_PROVIDER_UNAVAILABLE", "Media provider returned an invalid response");
    }
    return video;
  }

  async deleteVideo(videoId: string): Promise<void> {
    const { apiKey, libraryId } = this.streamCredentials();
    try {
      await this.request(`https://video.bunnycdn.com/library/${libraryId}/videos/${encodeURIComponent(videoId)}`, {
        method: "DELETE",
        headers: { AccessKey: apiKey },
      });
    } catch (error) {
      if (!(error instanceof MediaProviderError && error.httpStatus === 404)) throw error;
    }
  }

  createUploadAuthorization(videoId: string, now = Date.now()) {
    const { apiKey, libraryId } = this.streamCredentials();
    const expiresAt = new Date(now + 15 * 60_000);
    const expire = Math.floor(expiresAt.getTime() / 1000).toString();
    const signature = crypto.createHash("sha256").update(`${libraryId}${apiKey}${expire}${videoId}`).digest("hex");
    return {
      endpoint: "https://video.bunnycdn.com/tusupload",
      headers: { AuthorizationSignature: signature, AuthorizationExpire: expire, VideoId: videoId, LibraryId: libraryId },
      expiresAt: expiresAt.toISOString(),
    };
  }

  playback(videoId: string, now = Date.now()) {
    const { libraryId } = this.streamCredentials();
    if (!this.config.streamTokenKey) {
      throw new MediaProviderError("MEDIA_NOT_CONFIGURED", "Secure video playback is unavailable");
    }
    const expiration = Math.floor((now + 5 * 60_000) / 1000);
    const token = crypto.createHash("sha256")
      .update(`${this.config.streamTokenKey}${videoId}${expiration}`)
      .digest("hex");
    return {
      provider: "bunny" as const,
      embedUrl: `https://iframe.mediadelivery.net/embed/${libraryId}/${encodeURIComponent(videoId)}?token=${token}&expires=${expiration}`,
      videoId,
      libraryId,
      // This is the expiry of the server-issued embed URL. Raw CDN/HLS
      // file protection is a separate Bunny security setting.
      expiresAt: new Date(now + 5 * 60_000).toISOString(),
    };
  }

  async putImage(key: string, contents: Buffer, contentType: string): Promise<string> {
    const { accessKey, zone, host, cdnBaseUrl } = this.storageCredentials();
    const encoded = key.split("/").map(encodeURIComponent).join("/");
    await this.request(`https://${host}/${encodeURIComponent(zone)}/${encoded}`, {
      method: "PUT",
      headers: { AccessKey: accessKey, "Content-Type": contentType },
      body: contents,
    });
    return `${cdnBaseUrl}/${encoded}`;
  }

  async getImage(key: string): Promise<Buffer | null> {
    const { accessKey, zone, host } = this.storageCredentials();
    const encoded = key.split("/").map(encodeURIComponent).join("/");
    try {
      const response = await this.request(`https://${host}/${encodeURIComponent(zone)}/${encoded}`, {
        method: "GET",
        headers: { AccessKey: accessKey },
      }, 3);
      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      if (error instanceof MediaProviderError && error.httpStatus === 404) return null;
      throw error;
    }
  }

  async deleteImage(key: string): Promise<void> {
    const { accessKey, zone, host } = this.storageCredentials();
    const encoded = key.split("/").map(encodeURIComponent).join("/");
    try {
      await this.request(`https://${host}/${encodeURIComponent(zone)}/${encoded}`, {
        method: "DELETE",
        headers: { AccessKey: accessKey },
      });
    } catch (error) {
      if (!(error instanceof MediaProviderError && error.httpStatus === 404)) throw error;
    }
  }
}

function validVideoResponse(value: unknown): value is BunnyVideo {
  if (!value || typeof value !== "object") return false;
  const video = value as Partial<BunnyVideo>;
  if (typeof video.guid !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(video.guid)) return false;
  if (!Number.isInteger(video.status) || video.status! < 0 || video.status! > 20) return false;
  if (video.length !== undefined && (!Number.isFinite(video.length) || video.length < 0)) return false;
  if (video.storageSize !== undefined && (!Number.isFinite(video.storageSize) || video.storageSize < 0)) return false;
  return true;
}

export function bunnyVideoStatus(status: number): "uploading" | "processing" | "ready" | "failed" {
  if (status === 4) return "ready";
  if (status === 5 || status === 6) return "failed";
  if (status === 0) return "uploading";
  return "processing";
}

let injectedClient: BunnyMediaClient | undefined;
export function setBunnyMediaClientForTests(client: BunnyMediaClient | undefined) {
  injectedClient = client;
}
export function getBunnyMediaClient() {
  return injectedClient ?? new BunnyMediaClient();
}