import { z } from "zod";

export const landingVideoProviderSchema = z.enum(["youtube", "vimeo"]);
export type LandingVideoProvider = z.infer<typeof landingVideoProviderSchema>;
export type CanonicalLandingVideo = { provider: LandingVideoProvider; videoId: string };

const youtubeVideoIdSchema = z.string().regex(/^[A-Za-z0-9_-]{11}$/);
const vimeoVideoIdSchema = z.string().regex(/^[0-9]{1,20}$/);

export const canonicalLandingVideoSchema = z.object({
  provider: landingVideoProviderSchema,
  videoId: z.string(),
}).strict().superRefine((value, ctx) => {
  const schema = value.provider === "youtube" ? youtubeVideoIdSchema : vimeoVideoIdSchema;
  if (!schema.safeParse(value.videoId).success) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["videoId"], message: "Invalid canonical video ID" });
  }
});

/**
 * Converts an allowlisted, user-pasted HTTPS video URL to the small data-only
 * representation stored in landing page blocks.
 */
export function parseLandingVideoUrl(input: string): CanonicalLandingVideo {
  const value = z.string().trim().min(1).max(2048).parse(input);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Invalid video URL");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) {
    throw new Error("Video URL must be an HTTPS URL without credentials or a custom port");
  }

  const hostname = url.hostname.toLowerCase();
  let candidate: CanonicalLandingVideo | undefined;
  if (hostname === "youtu.be") {
    const match = url.pathname.match(/^\/([A-Za-z0-9_-]{11})\/?$/);
    if (match) candidate = { provider: "youtube", videoId: match[1] };
  } else if (hostname === "youtube.com" || hostname === "www.youtube.com") {
    const watchId = url.pathname === "/watch" ? url.searchParams.get("v") : null;
    const pathMatch = url.pathname.match(/^\/(?:shorts|embed)\/([A-Za-z0-9_-]{11})\/?$/);
    const videoId = watchId || pathMatch?.[1];
    if (videoId) candidate = { provider: "youtube", videoId };
  } else if (hostname === "youtube-nocookie.com" || hostname === "www.youtube-nocookie.com") {
    const match = url.pathname.match(/^\/embed\/([A-Za-z0-9_-]{11})\/?$/);
    if (match) candidate = { provider: "youtube", videoId: match[1] };
  } else if (hostname === "vimeo.com" || hostname === "www.vimeo.com") {
    const match = url.pathname.match(/^\/([0-9]{1,20})\/?$/);
    if (match) candidate = { provider: "vimeo", videoId: match[1] };
  } else if (hostname === "player.vimeo.com") {
    const match = url.pathname.match(/^\/video\/([0-9]{1,20})\/?$/);
    if (match) candidate = { provider: "vimeo", videoId: match[1] };
  }

  const parsed = canonicalLandingVideoSchema.safeParse(candidate);
  if (!parsed.success) throw new Error("Unsupported YouTube or Vimeo video URL");
  return parsed.data;
}

export const canonicalizeLandingVideoUrl = parseLandingVideoUrl;

export type WebinarLandingRichNode = {
  type: string;
  attrs?: unknown;
  content?: WebinarLandingRichNode[];
  text?: string;
  marks?: unknown[];
};

type BaseLandingBlock = { id: string; enabled: boolean };
export type WebinarLandingBlock =
  | (BaseLandingBlock & { type: "hero"; enabled: true; headline: string; subheadline?: string; imageUrl?: string; ctaLabel: string })
  | (BaseLandingBlock & { type: "intro"; headline: string; content: string })
  | (BaseLandingBlock & { type: "audience" | "agenda"; headline: string; items: string[] })
  | (BaseLandingBlock & { type: "instructor"; headline: string; name: string; bio: string; imageUrl?: string })
  | (BaseLandingBlock & { type: "faq"; items: Array<{ question: string; answer: string }> })
  | (BaseLandingBlock & { type: "countdown"; headline: string })
  | (BaseLandingBlock & { type: "cta"; headline: string; ctaLabel: string })
  | (BaseLandingBlock & { type: "richText"; body: WebinarLandingRichNode })
  | (BaseLandingBlock & { type: "stickyCta"; headline: string; ctaLabel: string; countdownMode: "webinarStart"; targetAt?: never })
  | (BaseLandingBlock & { type: "stickyCta"; headline: string; ctaLabel: string; countdownMode: "fixed"; targetAt: string })
  | (BaseLandingBlock & { type: "video"; provider: LandingVideoProvider; videoId: string; headline?: string });