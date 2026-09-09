import { describe, expect, it } from "vitest";
import { isPlaybackPermitted, resolveViewerAccessState } from "./watch-access-state";

describe("resolveViewerAccessState", () => {
  const now = new Date("2025-01-01T00:00:00.000Z");

  it("treats explicit revocation as a hard stop", () => {
    expect(resolveViewerAccessState({ hasToken: true, watchState: { canWatch: false, accessRevoked: true }, now })).toBe("revoked");
  });

  it("does not permit stale playback after a transient verification failure", () => {
    const state = resolveViewerAccessState({ hasToken: true, watchState: { canWatch: true, vimeoUrl: "https://vimeo.com/12" }, verificationFailed: true, now });
    expect(state).toBe("verification-failed");
    expect(isPlaybackPermitted(state)).toBe(false);
  });

  it("separates future availability from an expired viewing window", () => {
    expect(resolveViewerAccessState({ hasToken: true, watchState: { canWatch: false, waitUntil: "2025-01-02T00:00:00.000Z" }, now })).toBe("upcoming");
    expect(resolveViewerAccessState({ hasToken: true, watchState: { canWatch: false, waitUntil: "2024-12-31T00:00:00.000Z" }, now })).toBe("expired");
  });
});