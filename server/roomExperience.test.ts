import test from "node:test";
import assert from "node:assert/strict";
import { autoplayRoomMuted } from "../client/src/lib/room-autoplay";
import { appendViewerConversation, groupViewerConversations } from "../client/src/lib/viewer-conversations";
import type { ChatMessage } from "@shared/schema";

test("room autoplay mutes before playing", async () => {
  const calls: string[] = [];
  assert.equal(await autoplayRoomMuted({
    setMuted: async value => { calls.push(`mute:${value}`); },
    play: async () => { calls.push("play"); },
  }, () => true), true);
  assert.deepEqual(calls, ["mute:true", "play"]);
});
test("autoplay denial leaves manual retry available without throwing", async () => {
  assert.equal(await autoplayRoomMuted({
    setMuted: async () => {},
    play: async () => { throw new Error("NotAllowedError"); },
  }, () => true), false);
});
test("no autoplay for unavailable, waiting, or revoked access", async () => {
  let allowed = false;
  let plays = 0;
  const player = {
    setMuted: async () => { allowed = false; },
    play: async () => { plays++; },
  };
  assert.equal(await autoplayRoomMuted(player, () => allowed), false);
  allowed = true;
  assert.equal(await autoplayRoomMuted(player, () => allowed), false);
  assert.equal(plays, 0);
});
const message = (id: string, sessionId: string | null, senderType: string, senderName: string) =>
  ({ id, sessionId, senderType, senderName, message: id, sentAt: new Date("2030-01-01") }) as ChatMessage;
test("reloaded private history includes viewer, AI-host and human replies without other viewers/broadcasts", () => {
  const sessions = groupViewerConversations([
    message("question-a", "a", "viewer", "Viewer A"),
    message("ai-a", "a", "host", "AI assistant"),
    message("host-a", "a", "host", "Host"),
    message("question-b", "b", "viewer", "Viewer B"),
    message("broadcast", null, "host", "Host"),
  ]);
  assert.deepEqual(sessions.get("a")?.messages.map(m => m.id), ["question-a", "ai-a", "host-a"]);
  assert.equal(sessions.get("a")?.nickname, "Viewer A");
  assert.equal(sessions.get("b")?.messages.length, 1);
  assert.equal(sessions.size, 2);
});
test("live AI replies are deduplicated and do not mutate prior private histories", () => {
  const before = groupViewerConversations([message("q", "a", "viewer", "Viewer A")]);
  const reply = message("ai", "a", "host", "AI");
  const after = appendViewerConversation(before, reply);
  assert.equal(before.get("a")?.messages.length, 1);
  assert.equal(after.get("a")?.messages.length, 2);
  assert.equal(appendViewerConversation(after, reply).get("a")?.messages.length, 2);
  assert.equal(after.get("a")?.nickname, "Viewer A");
});
