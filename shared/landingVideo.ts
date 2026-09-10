import { parseLandingVideoUrl } from "./webinarLanding";

export type LandingVideoProvider = "youtube" | "vimeo";

export type LandingVideo = { provider: LandingVideoProvider; videoId: string };

/** Accepts a creator's pasted watch/share URL, or an already-normalized id. */
export function parseLandingVideo(value: string, preferred?: LandingVideoProvider): LandingVideo | null {
  const input = value.trim();
  if (!input) return null;
  try {
    const parsed = parseLandingVideoUrl(input);
    if (parsed.provider !== "bunny") return { provider: parsed.provider, videoId: parsed.videoId };
  } catch { /* Allow a normalized id while an existing block is being edited. */ }
  if (/^[A-Za-z0-9_-]{11}$/.test(input) && preferred === "youtube") return { provider: "youtube", videoId: input };
  if (/^\d{1,20}$/.test(input) && preferred === "vimeo") return { provider: "vimeo", videoId: input };
  return null;
}

export function landingVideoEmbedUrl(provider: LandingVideoProvider, videoId: string) {
  return provider === "youtube"
    ? `https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}?rel=0`
    : `https://player.vimeo.com/video/${encodeURIComponent(videoId)}?dnt=1`;
}