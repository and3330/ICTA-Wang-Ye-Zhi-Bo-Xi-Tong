import type { CtaButton } from "@shared/schema";

export function formatFunnelCtaLabel(ctaKey: unknown): string {
  if (typeof ctaKey !== "string" || ctaKey.trim().length === 0) return "即時 CTA";
  const key = ctaKey.trim();
  return `即時 CTA · ${key.slice(-8)}`;
}

export function resolveFunnelCtaLabel(
  ctaKey: unknown,
  candidates: Array<Pick<CtaButton, "ctaKey" | "text">> = [],
): string {
  if (typeof ctaKey === "string" && ctaKey.trim()) {
    const match = candidates.find((candidate) => candidate.ctaKey === ctaKey);
    if (match?.text) return match.text;
  }
  return formatFunnelCtaLabel(ctaKey);
}