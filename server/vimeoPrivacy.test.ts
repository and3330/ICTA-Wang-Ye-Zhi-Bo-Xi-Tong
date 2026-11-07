import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ProviderPlayer, normalizeVimeoEmbedUrl } from "../client/src/components/provider-player";

for (const input of [
  "https://vimeo.com/123456789/ExampleUnlistedHash",
  "https://player.vimeo.com/video/123456789?h=ExampleUnlistedHash",
]) {
  test(`Vimeo ${input.includes("/video/") ? "embed" : "share"} URL retains the unlisted hash`, () => {
    const url = new URL(normalizeVimeoEmbedUrl(input));
    assert.equal(url.origin, "https://player.vimeo.com");
    assert.equal(url.pathname, "/video/123456789");
    assert.equal(url.searchParams.get("h"), "ExampleUnlistedHash");
    assert.equal(url.searchParams.get("playsinline"), "1");
    assert.equal(url.searchParams.get("autoplay"), "0");
  });
}

test("Vimeo iframe sends origin-only referrer without exposing the room URL or watch parameters", () => {
  const html = renderToStaticMarkup(createElement(ProviderPlayer, {
    source: { provider: "vimeo", url: "https://vimeo.com/123456789/ExampleUnlistedHash" },
  }));
  assert.match(html, /referrerPolicy="origin"/i);
  assert.match(html, /h=ExampleUnlistedHash/);
  assert.match(html, /allow="autoplay; fullscreen; picture-in-picture"/);
});

test("Vimeo policy does not change Bunny iframe referrer behavior", () => {
  const html = renderToStaticMarkup(createElement(ProviderPlayer, {
    source: { provider: "bunny", url: "", embedUrl: "https://iframe.mediadelivery.net/embed/1/fixture" },
  }));
  assert.doesNotMatch(html, /referrerPolicy=/i);
});

test("Vimeo URL validation still rejects non-Vimeo, unsafe protocols and lookalike domains", () => {
  for (const value of ["https://vimeo.com.evil.test/12345", "http://vimeo.com/12345",
    "javascript:alert(1)", "https://example.test/12345"]) {
    assert.equal(normalizeVimeoEmbedUrl(value), "");
  }
});
