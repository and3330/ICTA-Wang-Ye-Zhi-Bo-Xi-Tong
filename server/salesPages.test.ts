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
});

test("slugs normalize globally and update requires a positive optimistic version", () => {
  assert.equal(normalizeSalesPageSlug("  Launch Élite 2026! "), "launch-elite-2026");
  const created = createSalesPageSchema.parse({
    offerId: "7780bedb-f243-4f24-98ef-d97d0107ca42",
    slug: " Launch Élite 2026! ",
    title: "Launch",
  });
  assert.equal(created.slug, "launch-elite-2026");
  assert.equal(updateSalesPageSchema.safeParse({ title: "Changed" }).success, false);
  assert.equal(updateSalesPageSchema.safeParse({ version: 0, title: "Changed" }).success, false);
  assert.equal(updateSalesPageSchema.safeParse({ version: 2, title: "Changed" }).success, true);
});