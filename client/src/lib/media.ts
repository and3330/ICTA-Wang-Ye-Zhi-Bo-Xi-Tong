export type MediaAsset = {
  id: string;
  kind: "video" | "image";
  provider: "bunny_stream" | "bunny_storage" | "legacy";
  name: string;
  status: "uploading" | "processing" | "ready" | "failed";
  sizeBytes: number;
  durationSeconds?: number;
  url?: string;
  thumbnailUrl?: string;
  createdAt: string;
};

export type MediaConfig = {
  videoEnabled: boolean;
  imageEnabled: boolean;
  maxVideoBytes: number;
  maxImageBytes: number;
  maxTotalVideoBytes: number;
  playbackEnabled?: boolean;
};

export type PlaybackSource = {
  provider: "vimeo" | "bunny";
  url?: string;
  embedUrl?: string;
  videoId?: string;
  libraryId?: string;
  expiresAt?: string;
  assetId?: string;
};

export const formatBytes = (bytes: number) => {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const power = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** power).toFixed(power > 1 ? 1 : 0)} ${units[power]}`;
};
