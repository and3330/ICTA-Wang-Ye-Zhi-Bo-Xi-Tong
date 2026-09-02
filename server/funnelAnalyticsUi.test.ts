import assert from "node:assert/strict";
import test from "node:test";
import {
  formatFunnelCtaLabel,
  resolveFunnelCtaLabel,
} from "../client/src/lib/funnel-analytics";

test("CTA analytics labels handle persisted, live, and missing keys safely", () => {
  const persistedKey = "persisted_cta_key";
  const liveKey = "signed_live_cta_12345678";

  assert.equal(
    resolveFunnelCtaLabel(persistedKey, [{ ctaKey: persistedKey, text: "立即購買" }]),
    "立即購買",
  );
  assert.equal(resolveFunnelCtaLabel(liveKey), "即時 CTA · 12345678");
  assert.equal(formatFunnelCtaLabel(undefined), "即時 CTA");
  assert.equal(formatFunnelCtaLabel(""), "即時 CTA");
});