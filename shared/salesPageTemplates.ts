export type SalesPageTemplateName = "ecommerce" | "free";
export type SalesPageTemplate = SalesPageTemplateName;

type SalesPageBlockBase = {
  id: string;
  enabled: boolean;
};

export type SalesPageBlock =
  | (SalesPageBlockBase & {
      type: "hero";
      headline: string;
      subheadline: string;
      imageUrl?: string;
      ctaLabel: string;
    })
  | (SalesPageBlockBase & { type: "richText"; content: string })
  | (SalesPageBlockBase & { type: "image"; url: string; alt: string; caption?: string })
  | (SalesPageBlockBase & { type: "benefits"; headline: string; items: string[] })
  | (SalesPageBlockBase & {
      type: "offer";
      headline: string;
      priceLabel?: string;
      buttonLabel: string;
      layout?: "standard" | "ecommerce";
      images?: Array<{ url: string; alt: string }>;
      summary?: string;
      features?: string[];
    })
  | (SalesPageBlockBase & {
      type: "video";
      url: string;
      title: string;
    })
  | (SalesPageBlockBase & {
      type: "testimonials";
      headline: string;
      items: Array<{ name: string; quote: string; role?: string }>;
    })
  | (SalesPageBlockBase & {
      type: "faq";
      items: Array<{ question: string; answer: string }>;
    });

export type SalesPageTemplateBlock = SalesPageBlock;

const YOUTUBE_ID = /^[A-Za-z0-9_-]{6,20}$/;
const VIMEO_ID = /^\d{6,12}$/;
const VIMEO_HASH = /^[A-Za-z0-9]+$/;

/**
 * Converts a supported public video URL into a safe iframe URL.
 * Vimeo's `h` value (used by unlisted videos) is deliberately retained.
 */
export function salesPageVideoEmbedUrl(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password) return null;

  const host = url.hostname.toLowerCase();
  let youtubeId: string | null = null;
  if (host === "youtu.be") {
    youtubeId = url.pathname.split("/").filter(Boolean)[0] ?? null;
  } else if (host === "youtube.com" || host === "www.youtube.com" || host === "m.youtube.com" || host === "youtube-nocookie.com" || host === "www.youtube-nocookie.com") {
    const parts = url.pathname.split("/").filter(Boolean);
    if (url.pathname === "/watch") youtubeId = url.searchParams.get("v");
    else if (parts[0] === "embed" || parts[0] === "shorts" || parts[0] === "live") youtubeId = parts[1] ?? null;
  }
  if (youtubeId && YOUTUBE_ID.test(youtubeId)) {
    return `https://www.youtube-nocookie.com/embed/${youtubeId}`;
  }

  if (host !== "vimeo.com" && host !== "www.vimeo.com" && host !== "player.vimeo.com") return null;
  const parts = url.pathname.split("/").filter(Boolean);
  const idIndex = parts[0] === "video" ? 1 : 0;
  const videoId = parts[idIndex];
  if (!videoId || !VIMEO_ID.test(videoId)) return null;
  const pathHash = parts[idIndex + 1];
  const queryHash = url.searchParams.get("h");
  const hash = pathHash && VIMEO_HASH.test(pathHash)
    ? pathHash
    : queryHash && VIMEO_HASH.test(queryHash)
      ? queryHash
      : null;
  return `https://player.vimeo.com/video/${videoId}${hash ? `?h=${hash}` : ""}`;
}

export function createSalesPageTemplate(
  template: SalesPageTemplateName,
  product: { name?: string } = {},
): SalesPageBlock[] {
  const name = product.name?.trim() || "這項商品";
  if (template === "free") {
    return [
      { id: "hero_main", enabled: true, type: "hero", headline: `讓「${name}」帶你走得更遠`, subheadline: "一套專為實作設計的方法，現在就開始建立你的下一步。", ctaLabel: "立即加入" },
      { id: "benefits_main", enabled: true, type: "benefits", headline: "你會帶走的改變", items: ["清楚的行動框架", "可以立即套用的方法", "更篤定的下一步"] },
      { id: "offer_main", enabled: true, type: "offer", headline: "現在加入完整方案", priceLabel: "", buttonLabel: "立即取得" },
      { id: "faq_main", enabled: true, type: "faq", items: [{ question: "這項商品適合我嗎？", answer: "請依本頁內容確認是否符合你的需求；有疑問請先聯絡賣方。" }] },
    ];
  }
  return [
    {
      id: "offer_main",
      enabled: true,
      type: "offer",
      layout: "ecommerce",
      headline: name,
      buttonLabel: "立即取得",
      images: [],
      summary: "在這裡補充商品特色、適用對象與能帶來的價值。",
      features: ["在這裡補充商品特色", "在這裡補充適用對象", "在這裡補充你將獲得的內容"],
    },
    { id: "detail", enabled: true, type: "richText", content: "商品詳情\n\n在這裡完整介紹商品內容、使用方式與適合的情境。" },
    { id: "specs", enabled: true, type: "richText", content: "商品規格\n\n在這裡補充交付方式、內容規格與其他重要資訊。" },
    { id: "faq_main", enabled: true, type: "faq", items: [{ question: "購買前還有問題嗎？", answer: "請依本頁內容確認是否符合你的需求；有疑問請先聯絡賣方。" }] },
  ];
}