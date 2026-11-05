import test from "node:test";
import assert from "node:assert/strict";
import type { ScheduledMessage, Tip } from "@shared/schema";
import { collectScheduledChat, collectTipChat } from "./scheduled-chat";
import { insertScheduledMessageSchema } from "@shared/schema";

const item = (id: string, triggerTime: number, messageType = "assistant"): ScheduledMessage => ({
  id, webinarId: "room", triggerTime, messageType, fakeUserId: null,
  message: `課程資料 ${id}\nhttps://example.com/${id}`,
});

test("materials wait for playing and specified video position, not wall time", () => {
  const shown = new Set<string>();
  const rows = [item("a", 60)];
  assert.deepEqual(collectScheduledChat(rows, 59, true, shown, "room"), []);
  assert.deepEqual(collectScheduledChat(rows, 60, false, shown, "room"), []);
  assert.equal(shown.size, 0);
  const due = collectScheduledChat(rows, 60, true, shown, "room");
  assert.equal(due.length, 1);
  assert.equal(due[0].senderName, "小幫手");
  assert.equal(due[0].senderType, "assistant");
  assert.equal(due[0].isPrivate, true);
  assert.equal(due[0].message, rows[0].message);
});

test("all due tips become chat entries even after their former overlay duration", () => {
  const tips = [
    { id: "one", webinarId: "room", title: "一", content: "重點一", triggerTime: 10, duration: 1 },
    { id: "two", webinarId: "room", title: "二", content: "重點二", triggerTime: 10, duration: 1 },
  ] as Tip[];
  const shown = new Set<string>();
  assert.equal(collectTipChat(tips, 100, false, shown, "room").length, 0);
  const messages = collectTipChat(tips, 100, true, shown, "room");
  assert.equal(messages.length, 2);
  assert.equal(messages[0].message, "一\n重點一");
  assert.equal(messages[0].senderType, "assistant");
  assert.equal(collectTipChat(tips, 100, true, shown, "room").length, 0);
  assert.equal(collectTipChat(tips, 100, true, new Set(), "room").length, 2);
});

test("seeking catches up chronologically without duplicate sends on rewind or updates", () => {
  const shown = new Set<string>();
  const rows = [item("late", 90), item("start", 0), item("early", 30)];
  assert.deepEqual(collectScheduledChat(rows, 90, true, shown, "room").map(m => m.id),
    ["scheduled_start", "scheduled_early", "scheduled_late"]);
  assert.deepEqual(collectScheduledChat(rows, 0, true, shown, "room"), []);
  assert.deepEqual(collectScheduledChat(rows, 100, true, shown, "room"), []);
});

test("each viewer has independent delivery and no AI or fake audience dependency", () => {
  const a = new Set<string>();
  const b = new Set<string>();
  const rows = [item("a", 60)];
  assert.equal(collectScheduledChat(rows, 60, true, a, "room").length, 1);
  assert.equal(collectScheduledChat(rows, 59, true, b, "room").length, 0);
  assert.equal(collectScheduledChat(rows, 60, true, b, "room").length, 1);
  assert.equal(collectScheduledChat(rows, NaN, true, new Set(), "room").length, 0);
});

test("legacy audience messages keep their identity and are not relabeled as assistant", () => {
  const message = { ...item("fake", 1, "chat"), fakeUserId: "fake-1" };
  const shown = new Set<string>();
  assert.equal(collectScheduledChat([message], 1, true, shown, "room").length, 0);
  assert.equal(shown.size, 0);
});

test("API schema rejects malformed or impersonated assistant schedules", () => {
  const base = { webinarId: "room", triggerTime: 60, message: "資料", messageType: "assistant" };
  assert.equal(insertScheduledMessageSchema.parse(base).messageType, "assistant");
  for (const patch of [{ triggerTime: -1 }, { triggerTime: 1.5 }, { triggerTime: 86401 }, { message: " " }, { message: "x".repeat(2001) }, { fakeUserId: "fake-1" }, { messageType: "host" }]) {
    assert.equal(insertScheduledMessageSchema.safeParse({ ...base, ...patch }).success, false);
  }
  assert.equal(insertScheduledMessageSchema.parse({ webinarId: "room", message: "舊訊息", triggerTime: 5 }).messageType, "chat");
});
