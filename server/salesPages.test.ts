import assert from "node:assert/strict";
import test from "node:test";
import {
  createSalesPageSchema,
  normalizeSalesPageSlug,
  salesPageBlocksSchema,
  salesPageCanPublish,
  salesPageImageUrlSchema,
  updateSalesPageSchema,
  checkoutSettingsSchema,
  validatePublishableBlocks,
} from "./salesPages";
import {
  createSalesPageTemplate,
  salesPageVideoEmbedUrl,
  type SalesPageTemplate,
  type SalesPageTemplateBlock,
} from "../shared/salesPageTemplates";

const offerBlock = {
  id: "offer-main",
  type: "offer" as const,
  enabled: true,
  headline: "Join today",
  buttonLabel: "Buy now",
};

test("sales page blocks are strict, bounded, and have stable unique IDs", () => {
  assert.equal(salesPageBlocksSchema.safeParse([offerBlock]).success, true);
  assert.equal(salesPageBlocksSchema.safeParse([{ ...offerBlock, unexpected: true }]).success, false);
  assert.equal(salesPageBlocksSchema.safeParse([offerBlock, { ...offerBlock }]).success, false);
  assert.equal(salesPageBlocksSchema.safeParse(Array.from({ length: 31 }, (_, index) => ({
    ...offerBlock, id: `offer-${index}`, enabled: false,
  }))).success, false);
  assert.equal(salesPageBlocksSchema.safeParse([{
    id: "html", type: "richText", enabled: true, content: "<script>alert(1)</script>",
  }]).success, false);
});

test("checkout settings normalize blank success URL and reject unsafe navigation", () => {
  const blank = checkoutSettingsSchema.parse({ successButtonUrl: "" });
  assert.equal(blank.successButtonUrl, undefined);
  assert.equal(checkoutSettingsSchema.safeParse({ successButtonUrl: "/members" }).success, true);
  assert.equal(checkoutSettingsSchema.safeParse({ successButtonUrl: "https://example.com/member" }).success, true);
  assert.equal(checkoutSettingsSchema.safeParse({ successButtonUrl: "//evil.example" }).success, false);
  assert.equal(checkoutSettingsSchema.safeParse({ successButtonUrl: "javascript:alert(1)" }).success, false);
});

test("sales page image URLs allow only HTTPS and safe same-origin uploads", () => {
  assert.equal(salesPageImageUrlSchema.safeParse("https://cdn.example.com/image.png").success, true);
  assert.equal(salesPageImageUrlSchema.safeParse("/uploads/member-image.webp").success, true);
  assert.equal(salesPageImageUrlSchema.safeParse("http://example.com/image.png").success, false);
  assert.equal(salesPageImageUrlSchema.safeParse("/uploads/../secret").success, false);
  assert.equal(salesPageImageUrlSchema.safeParse("javascript:alert(1)").success, false);
});

test("ecommerce offer galleries are bounded, safe, and contain no client-forged amount", () => {
  const ecommerceOffer = {
    ...offerBlock,
    layout: "ecommerce" as const,
    images: [{ url: "https://cdn.example.com/product.webp", alt: "Product front" }],
    summary: "A concise product summary",
    features: ["Lifetime access"],
  };
  assert.equal(salesPageBlocksSchema.safeParse([ecommerceOffer]).success, true);
  assert.equal(salesPageBlocksSchema.safeParse([{
    ...ecommerceOffer,
    images: Array.from({ length: 9 }, (_, index) => ({ url: `https://cdn.example.com/${index}.webp`, alt: `${index}` })),
  }]).success, false);
  assert.equal(salesPageBlocksSchema.safeParse([{
    ...ecommerceOffer,
    images: [{ url: "javascript:alert(1)", alt: "Unsafe" }],
  }]).success, false);
  assert.equal(salesPageBlocksSchema.safeParse([{ ...ecommerceOffer, amountMinor: 1 }]).success, false);
  assert.equal(salesPageBlocksSchema.safeParse([{ ...ecommerceOffer, paymentProvider: "forged" }]).success, false);
});

test("video URLs canonicalize only known HTTPS hosts and retain Vimeo unlisted hashes", () => {
  assert.equal(
    salesPageVideoEmbedUrl("https://youtu.be/dQw4w9WgXcQ?t=5"),
    "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
  );
  assert.equal(
    salesPageVideoEmbedUrl("https://vimeo.com/123456789/aBcD123"),
    "https://player.vimeo.com/video/123456789?h=aBcD123",
  );
  assert.equal(
    salesPageVideoEmbedUrl("https://player.vimeo.com/video/123456789?h=aBcD123"),
    "https://player.vimeo.com/video/123456789?h=aBcD123",
  );
  for (const unsafe of [
    "javascript:alert(1)",
    "http://youtube.com/watch?v=dQw4w9WgXcQ",
    "https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ",
    "https://user:pass@youtube.com/watch?v=dQw4w9WgXcQ",
    "https://example.com/video/123456789",
  ]) assert.equal(salesPageVideoEmbedUrl(unsafe), null);

  assert.equal(salesPageBlocksSchema.safeParse([{
    id: "video_main", enabled: true, type: "video",
    url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", title: "Product tour",
  }]).success, true);
  assert.equal(salesPageBlocksSchema.safeParse([{
    id: "video_main", enabled: true, type: "video",
    url: "https://evil.example/video", title: "Product tour",
  }]).success, false);
});

test("testimonials are strict and bounded without generated endorsements", () => {
  const block = {
    id: "testimonials_main", enabled: true, type: "testimonials" as const,
    headline: "What customers say",
    items: [{ name: "A customer", quote: "Their own review", role: "Member" }],
  };
  assert.equal(salesPageBlocksSchema.safeParse([block]).success, true);
  assert.equal(salesPageBlocksSchema.safeParse([{ ...block, items: [] }]).success, false);
  assert.equal(salesPageBlocksSchema.safeParse([{
    ...block,
    items: Array.from({ length: 9 }, (_, index) => ({ name: `${index}`, quote: "Review" })),
  }]).success, false);
  assert.equal(createSalesPageTemplate("ecommerce").some(item => item.type === "testimonials"), false);
});

test("publishing is webinar-independent but requires an active offer and one enabled offer block", () => {
  assert.equal(validatePublishableBlocks([offerBlock]).length, 1);
  assert.throws(() => validatePublishableBlocks([]), /exactly one enabled offer block/);
  assert.throws(() => validatePublishableBlocks([offerBlock, { ...offerBlock, id: "offer-second" }]), /exactly one/);
  assert.equal(salesPageCanPublish({ publishStatus: "draft" }, { active: true }, [offerBlock]).ok, true);
  assert.deepEqual(
    salesPageCanPublish({ publishStatus: "published" }, { active: false }, [offerBlock]),
    { ok: false, message: "Offer is inactive" },
  );
  assert.equal(salesPageCanPublish({ publishStatus: "published" }, { active: true }, [offerBlock]).ok, true);
  assert.throws(
    () => validatePublishableBlocks([{ ...offerBlock, enabled: false }]),
    /exactly one enabled offer block/,
  );
  assert.equal(validatePublishableBlocks([
    offerBlock,
    { ...offerBlock, id: "offer-disabled", enabled: false },
  ]).length, 2);
});

test("slugs normalize globally and update requires a positive optimistic version", () => {
  assert.equal(normalizeSalesPageSlug("  Launch Élite 2026! "), "launch-elite-2026");
  const created = createSalesPageSchema.parse({
    offerId: "7780bedb-f243-4f24-98ef-d97d0107ca42",
    slug: " Launch Élite 2026! ",
    title: "Launch",
  });
  assert.equal(created.slug, "launch-elite-2026");
  assert.equal(created.template, "ecommerce");
  assert.equal(created.blocks[0]?.type, "offer");
  assert.equal(created.blocks[0]?.type === "offer" && created.blocks[0].layout, "ecommerce");

  const free = createSalesPageSchema.parse({
    offerId: "7780bedb-f243-4f24-98ef-d97d0107ca42",
    slug: "free-template",
    title: "My Product",
    template: "free",
  });
  assert.deepEqual(free.blocks, createSalesPageTemplate("free", { name: "My Product" }));
  assert.deepEqual(free.blocks.map(block => block.type), ["hero", "benefits", "offer", "faq"]);

  const explicit: SalesPageTemplateBlock[] = [{
    id: "legacy_offer",
    enabled: false,
    type: "offer",
    headline: "Legacy offer",
    priceLabel: "",
    buttonLabel: "Learn more",
  }];
  const explicitCreated = createSalesPageSchema.parse({
    offerId: "7780bedb-f243-4f24-98ef-d97d0107ca42",
    slug: "explicit-empty",
    title: "Explicit",
    template: "free" satisfies SalesPageTemplate,
    blocks: explicit,
  });
  assert.deepEqual(explicitCreated.blocks, explicit);
  assert.equal(JSON.stringify(explicitCreated.blocks), JSON.stringify(explicit));

  const explicitEmpty = createSalesPageSchema.parse({
    offerId: "7780bedb-f243-4f24-98ef-d97d0107ca42",
    slug: "explicit-empty",
    title: "Explicit empty",
    blocks: [],
  });
  assert.deepEqual(explicitEmpty.blocks, []);
  assert.equal(updateSalesPageSchema.safeParse({ title: "Changed" }).success, false);
  assert.equal(updateSalesPageSchema.safeParse({ version: 0, title: "Changed" }).success, false);
  assert.equal(updateSalesPageSchema.safeParse({ version: 2, title: "Changed" }).success, true);
});