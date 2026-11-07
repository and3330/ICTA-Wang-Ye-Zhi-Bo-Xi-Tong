import type { ChatMessage } from "@shared/schema";

export interface ViewerConversation {
  sessionId: string;
  nickname: string;
  messages: ChatMessage[];
  lastActivity: Date;
}

function addMessage(sessions: Map<string, ViewerConversation>, message: ChatMessage) {
  if (!message.sessionId) return; // Broadcasts never become private transcripts.
  const existing = sessions.get(message.sessionId);
  if (message.id && existing?.messages.some(item => item.id === message.id)) return;
  const sentAt = new Date(message.sentAt || Date.now());
  sessions.set(message.sessionId, {
    sessionId: message.sessionId,
    nickname: message.senderType === "viewer" ? message.senderName : existing?.nickname || "觀眾",
    messages: [...(existing?.messages || []), message],
    lastActivity: existing && existing.lastActivity > sentAt ? existing.lastActivity : sentAt,
  });
}

export function groupViewerConversations(messages: ChatMessage[]) {
  const sessions = new Map<string, ViewerConversation>();
  messages.forEach(message => addMessage(sessions, message));
  return sessions;
}

export function appendViewerConversation(sessions: Map<string, ViewerConversation>, message: ChatMessage) {
  if (!message.sessionId) return sessions;
  const next = new Map(sessions);
  addMessage(next, message);
  return next;
}
