type AnyBlock = { id?: string; type?: string; enabled?: boolean; [key: string]: any };

function heroAsRichText(hero: AnyBlock, index: number): AnyBlock {
  const content: any[] = [];
  if (hero.headline) content.push({ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: String(hero.headline) }] });
  if (hero.subheadline) content.push({ type: "paragraph", content: [{ type: "text", text: String(hero.subheadline) }] });
  if (hero.imageUrl) content.push({ type: "image", attrs: { src: hero.imageUrl } });
  if (hero.ctaLabel) content.push({ type: "paragraph", content: [{ type: "text", text: String(hero.ctaLabel) }] });
  return { id: `${hero.id || "hero"}_legacy_${index}`, type: "richText", enabled: hero.enabled !== false, body: { type: "doc", content } };
}

/** Normalize historical pages without dropping content from duplicate/misordered heroes. */
export function normalizeLandingBlocks(input: AnyBlock[] | undefined, defaultHero: AnyBlock): Array<AnyBlock & { id: string }> {
  const source = (input?.length ? input : []).map(block => {
    if ((block.type === "hero" || block.type === "instructor") && typeof block.imageUrl === "string" && !block.imageUrl.trim()) {
      const { imageUrl: _blank, ...rest } = block;
      return rest;
    }
    return block;
  });
  const heroes = source.filter(block => block.type === "hero");
  const leading = heroes[0] || { ...defaultHero };
  const normalizedHero = { ...leading, id: leading.id || defaultHero.id || "hero", enabled: true };
  const extras = heroes.slice(1).map((hero, i) => heroAsRichText(hero, i));
  return [normalizedHero, ...extras, ...source.filter(block => block.type !== "hero")].map((block, i) => ({ ...block, id: block.id || `${block.type || "block"}_${i}` }));
}

export function applyUploadedImageToBlock<T extends { id: string }>(blocks: T[], destinationBlockId: string, imageUrl: string): { blocks: T[]; applied: boolean } {
  if (!blocks.some(block => block.id === destinationBlockId)) return { blocks, applied: false };
  return {
    blocks: blocks.map(block => block.id === destinationBlockId ? { ...block, imageUrl } : block),
    applied: true,
  };
}