import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { ChatMessage, Poll } from "@shared/schema";
import type { ActivePoll } from "@/components/viewer-interactions";
import { DEFAULT_POLL_SECONDS } from "@/lib/timed-interactions";

type ChatPoll = { active: ActivePoll; results: Record<number, number> | null };

export function useChatPolls(
  webinarId: string | undefined,
  polls: Poll[] | undefined,
  currentTime: number,
  isPlaying: boolean,
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>,
) {
  const [chatPolls, setChatPolls] = useState<Record<string, ChatPoll>>({});
  const shown = useRef(new Set<string>());
  const showPoll = useCallback((poll: Poll, seconds: number) => {
    if (!webinarId || !poll.id || shown.current.has(poll.id)) return;
    shown.current.add(poll.id);
    if (!Number.isFinite(seconds) || seconds <= 0) return;
    const key = `scheduled_poll_${poll.id}`;
    setChatPolls(prev => ({ ...prev, [key]: { active: { poll, seconds }, results: null } }));
    setMessages(prev => [...prev, {
      id: key, webinarId, sessionId: null, senderName: "小幫手",
      senderType: "poll", message: poll.question, sentAt: new Date(), isPrivate: true,
    } as ChatMessage]);
  }, [webinarId, setMessages]);

  useEffect(() => {
    if (!isPlaying || !polls || !Number.isFinite(currentTime)) return;
    for (const poll of polls) {
      if (currentTime >= poll.triggerTime) {
        showPoll(poll, poll.triggerTime + (poll.duration || DEFAULT_POLL_SECONDS) - currentTime);
      }
    }
  }, [polls, currentTime, isPlaying, showPoll]);

  const setPollResults = useCallback((pollId: string, results: Record<number, number>) => {
    const key = `scheduled_poll_${pollId}`;
    setChatPolls(prev => prev[key] ? {
      ...prev, [key]: { ...prev[key], results },
    } : prev);
  }, []);
  return { chatPolls, showPoll, setPollResults };
}
