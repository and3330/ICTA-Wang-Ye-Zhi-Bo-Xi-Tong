import type { CSSProperties } from "react";

export type CtaVariant = "default" | "secondary" | "destructive";

const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/** "#abc" -> [170, 187, 204]; null for anything that is not a plain hex color. */
function hexToRgb(color: string): [number, number, number] | null {
  if (!HEX_COLOR.test(color)) return null;
  const hex = color.length === 4 ? color.slice(1).split("").map(c => c + c).join("") : color.slice(1);
  return [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}

/** Black or white, whichever reads better on the given background (WCAG luminance). */
export function readableTextColor(background: string): "#ffffff" | "#111111" {
  const rgb = hexToRgb(background);
  if (!rgb) return "#ffffff";
  const [r, g, b] = rgb.map(v => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  // White text on brand buttons unless the color is genuinely light (yellow, pastel).
  return luminance > 0.4 ? "#111111" : "#ffffff";
}

/**
 * How a CTA button looks over the video, the same in the room and the embed.
 * "secondary" is gray, "danger" red; anything else (including no style) is the
 * main style, painted in the webinar's brand color when one is set.
 */
export function ctaButtonAppearance(
  style: string | null | undefined,
  brandColor?: string | null,
): { variant: CtaVariant; style?: CSSProperties } {
  if (style === "secondary") return { variant: "secondary" };
  if (style === "danger") return { variant: "destructive" };
  const color = brandColor?.trim();
  if (color && hexToRgb(color)) {
    return {
      variant: "default",
      style: { backgroundColor: color, borderColor: color, color: readableTextColor(color) },
    };
  }
  return { variant: "default" };
}
