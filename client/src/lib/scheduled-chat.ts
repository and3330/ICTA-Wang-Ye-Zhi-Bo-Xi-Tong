import type { ChatMessage, FakeUser, ScheduledMessage, Tip } from "@shared/schema";

/** Timed materials are local to this viewer's playback, never broadcast. */
export function collectScheduledChat(
  items: readonly ScheduledMessage[],
  currentTime: number,
  isPlaying: boolean,
  shown: Set<string>,
  webinarId: string,
  fakeUsers: readonly FakeUser[] = [],
): ChatMessage[] {
  if (!isPlaying || !Number.isFinite(currentTime) || currentTime < 0) return [];
  return [...items].sort((a, b) => a.triggerTime - b.triggerTime).flatMap(item => {
    if (currentTime < item.triggerTime || shown.has(item.id)) return [];
    const assistant = item.messageType === "assistant";
    // Legacy audience messages still await their configured sender data;
    // official materials do not depend on simulated audience or AI replies.
    if (!assistant && item.fakeUserId && !fakeUsers.some(user => user.id === item.fakeUserId)) return [];
    shown.add(item.id);
    return [{
      id: `scheduled_${item.id}`,
      webinarId,
      sessionId: null,
      senderName: assistant ? "小幫手" : (fakeUsers.find(user => user.id === item.fakeUserId)?.name || "觀眾"),
      senderType: assistant ? "assistant" : "scheduled",
      message: item.message,
      sentAt: new Date(),
      isPrivate: assistant,
    } as ChatMessage];
  });
}

/** Tips become durable-in-this-view chat entries, not expiring overlays. */
export function collectTipChat(tips: readonly Tip[], currentTime: number, isPlaying: boolean, shown: Set<string>, webinarId: string): ChatMessage[] {
  return collectScheduledChat(tips.map(tip => ({
    id: `tip_${tip.id}`, webinarId, fakeUserId: null, messageType: "assistant",
    triggerTime: tip.triggerTime, message: [tip.title, tip.content].filter(Boolean).join("\n"),
  })), currentTime, isPlaying, shown, webinarId);
}
