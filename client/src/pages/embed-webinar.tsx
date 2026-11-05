import { useState, useEffect, useRef } from "react";
import { collectScheduledChat } from "@/lib/scheduled-chat";
import { ChatMaterialText } from "@/components/chat-material-text";
import { useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { apiRequest } from "@/lib/queryClient";
import { Heart, Send, ExternalLink, Loader2, Play, Info, X, Star, MessageCircleQuestion } from "lucide-react";
import type { Webinar, ChatMessage, CtaButton, ScheduledMessage, FakeUser, Tip, Poll, FeedbackSurvey } from "@shared/schema";
import { WebinarTrackingProvider, type TrackingWebinar } from "@/components/webinar-tracking-provider";
import { fetchWatchState, getWatchToken, type WatchState } from "@/lib/watch-access";
import { isPlaybackPermitted, resolveViewerAccessState } from "@/lib/watch-access-state";
import { ViewerAccessState } from "@/components/viewer-access-state";
import { useAttendanceTracking } from "@/lib/use-attendance-tracking";
import { openOfferCheckout, openTrackedExternalUrl, trackWebinarEvent } from "@/lib/webinar-tracking";
import { ProviderPlayer } from "@/components/provider-player";
import { FullscreenVideo } from "@/components/fullscreen-video";
import type { PlaybackSource } from "@/lib/media";
import { CheckoutBuyerDialog, type CheckoutBuyer } from "@/components/checkout-buyer-dialog";
import { useTimedItems, ViewerPollDialog, ViewerQaDialog, ViewerSurveyDialog, type ActivePoll } from "@/components/viewer-interactions";
import { DEFAULT_POLL_SECONDS, DEFAULT_TIP_SECONDS } from "@/lib/timed-interactions";
import { ViewerVolumeControl } from "@/components/viewer-volume";
import { viewerCheckoutError } from "@/lib/viewer-messages";

export default function EmbedWebinar() {
  const { id } = useParams<{ id: string }>();

  const [nickname, setNickname] = useState("");
  const [isJoined, setIsJoined] = useState(false);
  const [nicknameInput, setNicknameInput] = useState("");

  const [sessionId] = useState(() => {
    const storageKey = `webinar_embed_session_${id}`;
    let stored = localStorage.getItem(storageKey);
    if (!stored) {
      stored = `embed_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
      localStorage.setItem(storageKey, stored);
    }
    return stored;
  });

  const [currentTime, setCurrentTime] = useState(0);
  const [videoDuration, setVideoDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const playerRef = useRef<any>(null);
  const [playerReady, setPlayerReady] = useState(false);
  const [playError, setPlayError] = useState("");

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [messageInput, setMessageInput] = useState("");
  const chatEndRef = useRef<HTMLDivElement>(null);

  const [likeCount, setLikeCount] = useState(0);
  const [visibleCtas, setVisibleCtas] = useState<CtaButton[]>([]);
  const [liveCtas, setLiveCtas] = useState<CtaButton[]>([]);
  const [checkoutCtaId, setCheckoutCtaId] = useState<string | null>(null);
  const [checkoutError, setCheckoutError] = useState("");

  const wsRef = useRef<WebSocket | null>(null);
  const [chatConnected, setChatConnected] = useState(true);
  const [chatNotice, setChatNotice] = useState("");
  const [viewerCount, setViewerCount] = useState(1);
  const shownMessagesRef = useRef<Set<string>>(new Set());

  const [visibleTip, setVisibleTip] = useState<Tip | null>(null);
  const [activePoll, setActivePoll] = useState<ActivePoll | null>(null);
  const [pollResults, setPollResults] = useState<Record<number, number> | null>(null);
  const [videoEnded, setVideoEnded] = useState(false);
  const [showSurvey, setShowSurvey] = useState(false);
  const [surveySubmitted, setSurveySubmitted] = useState(false);
  const [showQa, setShowQa] = useState(false);

  const { data: webinar, isLoading } = useQuery<Webinar>({
    queryKey: ["/api/webinars", id],
    enabled: !!id,
  });
  const watchToken = getWatchToken(id);
  const { data: watchState, isLoading: watchStateLoading, isError: watchStateError, refetch: refetchWatchState } = useQuery<WatchState>({
    queryKey: ["/api/webinars", id, "watch-state", watchToken],
    queryFn: () => fetchWatchState(id!, watchToken!),
    enabled: !!id && !!watchToken,
    refetchInterval: isJoined ? 30_000 : 5_000,
    retry: false,
  });
  const accessKind = resolveViewerAccessState({
    hasToken: !!watchToken,
    watchState,
    isInitialLoading: watchStateLoading,
    verificationFailed: watchStateError,
    fallbackVideoUrl: webinar?.vimeoUrl,
    scheduledStart: webinar?.startTime,
  });
  const canWatch = isPlaybackPermitted(accessKind);
  const effectiveVimeoUrl = canWatch ? (watchToken ? watchState?.vimeoUrl : webinar?.vimeoUrl) : undefined;
  const effectivePlayback = canWatch && watchToken ? watchState?.playback : undefined;
  const hasPlayback = !!(effectivePlayback?.url || effectivePlayback?.embedUrl || effectiveVimeoUrl);
  useEffect(() => {
    if (watchState?.viewerName) setNicknameInput(current => current || watchState.viewerName!);
  }, [watchState?.viewerName]);
  useAttendanceTracking({
    registrationId: watchState?.registrationId,
    watchToken,
    enabled: isJoined && canWatch,
    currentPosition: currentTime,
  });

  const { data: ctas } = useQuery<CtaButton[]>({
    queryKey: ["/api/webinars", id, "ctas"],
    enabled: !!id,
  });

  const { data: scheduledMessages } = useQuery<ScheduledMessage[]>({
    queryKey: ["/api/webinars", id, "scheduled-messages"],
    enabled: !!id,
  });

  const { data: fakeUsers } = useQuery<FakeUser[]>({
    queryKey: ["/api/webinars", id, "fake-users"],
    enabled: !!id,
  });

  const { data: tips } = useQuery<Tip[]>({
    queryKey: ["/api/webinars", id, "tips"],
    enabled: !!id && isJoined,
  });

  const { data: polls } = useQuery<Poll[]>({
    queryKey: ["/api/webinars", id, "polls"],
    enabled: !!id && isJoined,
  });

  const { data: feedbackSurvey } = useQuery<FeedbackSurvey | null>({
    queryKey: ["/api/webinars", id, "feedback-survey"],
    enabled: !!id && isJoined,
  });

  const showTip = (tip: Tip, seconds: number) => {
    setVisibleTip(tip);
    setTimeout(() => setVisibleTip(current => (current?.id === tip.id ? null : current)), seconds * 1000);
  };
  useTimedItems(tips, currentTime, isPlaying, DEFAULT_TIP_SECONDS, showTip);
  useTimedItems(polls, currentTime, isPlaying, DEFAULT_POLL_SECONDS, (poll, seconds) => {
    setActivePoll({ poll, seconds });
    setPollResults(null);
  });

  useEffect(() => {
    if (!isJoined || !id || !nickname || !sessionId) return;
    let disposed = false;
    let attempt = 0;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const handleMessage = (event: MessageEvent) => {
      const msg = JSON.parse(event.data);
      switch (msg.type) {
        case "history":
          // Sent on every (re)join: keep the timed audience messages that only
          // exist in this frame and drop optimistic copies the server confirmed.
          setMessages(prev => {
            const history: ChatMessage[] = msg.data?.messages || [];
            const historyIds = new Set(history.map(m => m.id));
            const localOnly = prev.filter(m => {
              const localId = String(m.id);
              if (historyIds.has(m.id)) return false;
              if (localId.startsWith("sm_") || localId.startsWith("scheduled_")) return true;
              if (localId.startsWith("local-")) {
                return !history.some(h => h.senderType === "viewer" && h.message === m.message);
              }
              return false;
            });
            return [...history, ...localOnly].sort(
              (a, b) => new Date(a.sentAt ?? 0).getTime() - new Date(b.sentAt ?? 0).getTime(),
            );
          });
          if (msg.data?.likeCount) setLikeCount(msg.data.likeCount);
          break;
        case "chat":
          setMessages(prev => (msg.data?.id && prev.some(m => m.id === msg.data.id) ? prev : [...prev, msg.data]));
          break;
        case "error": {
          const code = msg.data?.code;
          if (code === "chat_rejected") {
            setMessages(prev => {
              const index = prev.map(m => String(m.id).startsWith("local-")).lastIndexOf(true);
              return index === -1 ? prev : [...prev.slice(0, index), ...prev.slice(index + 1)];
            });
          }
          setChatNotice(code === "join_failed"
            ? "無法加入聊天室，請重新整理頁面。"
            : msg.data?.message || "訊息沒有送出，請稍後再試。");
          break;
        }
        case "like":
          setLikeCount(msg.data.count);
          break;
        case "viewerCount":
          setViewerCount(msg.data.count);
          break;
        case "liveCta": {
          const cta = { ...msg.data, startTime: 0, endTime: null } as CtaButton;
          setLiveCtas(prev => [...prev.filter(c => c.id !== cta.id), cta]);
          if (msg.data.expiresAt) {
            const ms = msg.data.expiresAt - Date.now();
            if (ms > 0) setTimeout(() => setLiveCtas(prev => prev.filter(c => c.id !== cta.id)), ms);
          }
          break;
        }
        case "liveTip":
          showTip(msg.data as Tip, msg.data.duration || DEFAULT_TIP_SECONDS);
          break;
        case "poll":
          setActivePoll({ poll: msg.data, seconds: msg.data.duration || DEFAULT_POLL_SECONDS });
          setPollResults(null);
          break;
        case "pollResults":
          setPollResults(msg.data.results);
          break;
      }
    };

    const connect = () => {
      if (disposed) return;
      retryTimer = null;
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const socket = new WebSocket(`${protocol}//${window.location.host}/ws`);
      wsRef.current = socket;
      socket.onopen = () => {
        attempt = 0;
        setChatConnected(true);
        socket.send(JSON.stringify({ type: "join", data: { webinarId: id, nickname, sessionId, watchToken: watchToken || undefined } }));
      };
      socket.onmessage = handleMessage;
      socket.onclose = (event) => {
        if (wsRef.current === socket) wsRef.current = null;
        // Closing on unmount must not schedule a reconnect, or every
        // re-render leaves another socket behind.
        if (disposed) return;
        if (event.code === 1008 || event.code === 1011) {
          setIsJoined(false);
          return;
        }
        setChatConnected(false);
        const delay = Math.min(30_000, 1_000 * 2 ** attempt);
        attempt += 1;
        retryTimer = setTimeout(connect, delay);
      };
    };

    const reconnectNow = () => {
      if (disposed || !retryTimer || document.visibilityState !== "visible") return;
      clearTimeout(retryTimer);
      connect();
    };
    document.addEventListener("visibilitychange", reconnectNow);
    window.addEventListener("online", reconnectNow);
    connect();

    return () => {
      disposed = true;
      if (retryTimer) clearTimeout(retryTimer);
      document.removeEventListener("visibilitychange", reconnectNow);
      window.removeEventListener("online", reconnectNow);
      const socket = wsRef.current;
      wsRef.current = null;
      socket?.close();
    };
  }, [isJoined, id, nickname, sessionId, watchToken]);

  useEffect(() => {
    if (canWatch) return;
    setIsPlaying(false);
    const player = playerRef.current;
    if (player) player.pause().catch(() => {});
  }, [canWatch]);

  useEffect(() => {
    if (!id || !isJoined || !videoDuration) return;
    const percent = (currentTime / videoDuration) * 100;
    ([25, 50, 75, 100] as const).forEach((checkpoint) => {
      if (percent >= checkpoint) {
        trackWebinarEvent(id, "video_progress", {
          positionSeconds: currentTime,
          metadata: { progressPercent: checkpoint },
        });
      }
    });
  }, [id, isJoined, currentTime, videoDuration]);

  useEffect(() => {
    if (!id || !isJoined) return;
    const onPageHide = () => trackWebinarEvent(
      id,
      "dropoff",
      { positionSeconds: currentTime, metadata: { reason: "navigate" } },
      { beacon: true },
    );
    window.addEventListener("pagehide", onPageHide);
    return () => window.removeEventListener("pagehide", onPageHide);
  }, [id, isJoined, currentTime]);

  useEffect(() => {
    if (!scheduledMessages || !id) return;
    const due = collectScheduledChat(scheduledMessages, currentTime, isPlaying, shownMessagesRef.current, id, fakeUsers);
    if (due.length) setMessages(prev => [...prev, ...due]);
  }, [currentTime, isPlaying, scheduledMessages, fakeUsers, id]);

  // Same rule as the main room: a CTA without an end time stays to the end.
  useEffect(() => {
    if (!ctas) return;
    setVisibleCtas(ctas.filter(cta => currentTime >= (cta.startTime || 0) && (!cta.endTime || currentTime <= cta.endTime)));
  }, [currentTime, ctas]);

  useEffect(() => {
    if (!id) return;
    visibleCtas.forEach((cta) => trackWebinarEvent(id, "cta_view", { ctaId: cta.id }));
    liveCtas.forEach((cta) => trackWebinarEvent(id, "cta_view", { ctaId: cta.id }));
  }, [id, visibleCtas, liveCtas]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMessage = () => {
    const text = messageInput.trim();
    if (!text) return;
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      // Keep the typed text so it can be resent once chat is back.
      setChatNotice("聊天室重新連線中，連上後再送出一次。");
      return;
    }
    wsRef.current.send(JSON.stringify({
      type: "chat",
      data: { webinarId: id, message: text, senderName: nickname, sessionId, senderType: "viewer" },
    }));
    // The server does not echo a viewer's own message back to the sender, so
    // show it locally; a later history or rejection reconciles it.
    setMessages(prev => [...prev, {
      id: `local-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      webinarId: id || "",
      sessionId,
      senderName: nickname,
      senderType: "viewer",
      message: text,
      sentAt: new Date(),
      isPrivate: false,
    } as ChatMessage]);
    setChatNotice("");
    setMessageInput("");
  };

  const sendLike = () => {
    wsRef.current?.send(JSON.stringify({ type: "like", data: { webinarId: id, sessionId } }));
  };

  const submitVote = (optionIndex: number) => {
    const socket = wsRef.current;
    if (!activePoll || !socket || socket.readyState !== WebSocket.OPEN) return false;
    socket.send(JSON.stringify({ type: "vote", data: { pollId: activePoll.poll.id, optionIndex, sessionId } }));
    return true;
  };

  const getVimeoEmbedUrl = (url: string) => {
    const match = url.match(/vimeo\.com\/(\d+)/);
    return match ? `https://player.vimeo.com/video/${match[1]}?autoplay=1` : url;
  };
  const playbackSource: PlaybackSource | undefined = effectivePlayback || (effectiveVimeoUrl ? {
    provider: "vimeo",
    url: getVimeoEmbedUrl(effectiveVimeoUrl),
  } : undefined);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!webinar) {
    return (
      <div className="flex items-center justify-center h-screen">
        <p className="text-muted-foreground text-sm">找不到此直播</p>
      </div>
    );
  }

  const tracking = webinar as Webinar & TrackingWebinar;
  const trackingProvider = (
    <WebinarTrackingProvider webinarId={id} metaPixelId={tracking.metaPixelId} gtmContainerId={tracking.gtmContainerId} />
  );

  if (!isJoined) {
    if (!canWatch || !hasPlayback) {
      return (
        <div className="flex min-h-[100dvh] items-center justify-center p-4">
          {trackingProvider}
          <ViewerAccessState
            kind={accessKind}
            title={webinar.title}
            startsAt={watchState?.waitUntil || watchState?.selectedSession || webinar.startTime}
            timezone={webinar.timezone}
            compact
            onRetry={() => void refetchWatchState()}
            onRegister={accessKind === "unavailable" ? () => window.location.assign(`/register/${id}`) : undefined}
          />
        </div>
      );
    }
    return (
      <div className="flex items-center justify-center h-screen p-4">
        {trackingProvider}
        <div className="text-center space-y-3 w-full max-w-xs">
          <h3 className="font-bold text-base">{webinar.title}</h3>
          <Input
            placeholder="請輸入您的暱稱"
            value={nicknameInput}
            onChange={(e) => setNicknameInput(e.target.value)}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing && nicknameInput.trim()) {
                setNickname(nicknameInput.trim());
                setIsJoined(true);
                trackWebinarEvent(id, "webinar_enter");
              }
            }}
            data-testid="input-embed-nickname"
          />
          <Button
            className="w-full"
            disabled={!nicknameInput.trim()}
            onClick={() => {
              setNickname(nicknameInput.trim());
              setIsJoined(true);
              trackWebinarEvent(id, "webinar_enter");
            }}
            data-testid="button-embed-join"
          >
            加入直播
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-[100dvh] flex-col">
      {trackingProvider}
      <FullscreenVideo className="relative bg-black" enabled={canWatch && !!playbackSource}>
        <div className="relative w-full h-full aspect-video">
          {canWatch && playbackSource ? (
            <ProviderPlayer
              source={playbackSource}
              renewSource={effectivePlayback?.provider === "bunny" ? async () => {
                const result = await refetchWatchState();
                if (!result.data?.playback) throw new Error("403: 播放授權已失效");
                return result.data.playback;
              } : undefined}
              className="absolute inset-0 w-full h-full"
              testId="embed-video-player"
              onReady={(player) => { playerRef.current = player; setPlayerReady(true); }}
              onTimeUpdate={(seconds, duration) => { setCurrentTime(seconds); if (duration) setVideoDuration(duration); }}
              onPlay={() => { setIsPlaying(true); setPlayError(""); }}
              onPause={() => setIsPlaying(false)}
              onEnded={() => {
                setIsPlaying(false);
                setVideoEnded(true);
                trackWebinarEvent(id, "video_progress", { positionSeconds: videoDuration || currentTime, metadata: { progressPercent: 100 } });
                if (feedbackSurvey?.isActive && !surveySubmitted) setShowSurvey(true);
              }}
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center bg-muted p-4">
              <ViewerAccessState
                kind={accessKind}
                title={webinar.title}
                startsAt={watchState?.waitUntil || watchState?.selectedSession || webinar.startTime}
                timezone={webinar.timezone}
                compact
                onRetry={() => void refetchWatchState()}
              />
            </div>
          )}
          {canWatch && playbackSource && !isPlaying && (
            <button
              type="button"
              disabled={!playerReady}
              aria-label={playerReady ? "播放影片" : "播放器載入中"}
              data-testid="button-embed-play-video"
              className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/40 text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
              style={{ zIndex: 5 }}
              onClick={() => {
                const player = playerRef.current;
                if (!player) return;
                setPlayError("");
                void player.play().then(() => {
                  void player.setMuted(false).catch(() => {});
                  void player.setVolume(1).catch(() => {});
                }).catch(() => setPlayError("影片無法播放，請再次點擊；若仍失敗，請確認影片嵌入權限。"));
              }}
            >
              {playerReady ? <Play className="h-16 w-16" /> : <Loader2 className="h-10 w-10 animate-spin" />}
              {playError && <span role="alert" className="max-w-sm px-4 text-sm">{playError}</span>}
            </button>
          )}
          {canWatch && playerReady && <ViewerVolumeControl playerRef={playerRef} className="absolute top-2 left-2 z-10" />}
        </div>
        {visibleTip && (
          <div className="absolute top-2 right-2 z-20 max-w-[70%] rounded-md bg-background/95 p-2 shadow-lg" data-testid="embed-tip-card">
            <div className="flex items-start gap-2">
              <Info className="h-4 w-4 flex-shrink-0 text-primary mt-0.5" />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium">{visibleTip.title}</p>
                {visibleTip.content && <p className="text-[11px] text-muted-foreground mt-0.5 break-words">{visibleTip.content}</p>}
              </div>
              <button type="button" aria-label="關閉提示" onClick={() => setVisibleTip(null)} className="text-muted-foreground">
                <X className="h-3 w-3" />
              </button>
            </div>
          </div>
        )}
        {(visibleCtas.length > 0 || liveCtas.length > 0) && (
        <div className="absolute bottom-2 left-2 right-2 z-10 flex flex-col items-center gap-1.5">
        {[...visibleCtas, ...liveCtas].map(cta => (
            <Button
              key={cta.id}
              size="sm"
              variant={cta.style === "danger" ? "destructive" : cta.style === "secondary" ? "secondary" : "default"}
              data-testid={`embed-cta-${cta.id}`}
              onClick={() => {
                if (cta.offerId && id) {
                  if (!watchState?.registrationId) {
                    setCheckoutCtaId(cta.id);
                    return;
                  }
                  void openOfferCheckout(id, cta.id, {
                    sessionId,
                    registrationId: watchState.registrationId,
                    watchToken: watchToken || undefined,
                  }).catch(error => setCheckoutError(viewerCheckoutError(error)));
                }
                else if (cta.url) void openTrackedExternalUrl(
                  id,
                  cta.url,
                  { ctaId: cta.id, watchToken: watchToken || undefined },
                );
              }}
            >
                <ExternalLink className="h-3 w-3 mr-1" />
                {cta.text}
            </Button>
        ))}
        </div>
        )}
      </FullscreenVideo>

      <div className="flex-1 flex flex-col min-h-0 border-t">
        <div className="flex items-center justify-between gap-2 px-3 py-2 border-b bg-card">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="outline" className="text-xs">{viewerCount} 人觀看</Badge>
          </div>
          <div className="flex items-center gap-1">
            {videoEnded && feedbackSurvey?.isActive && !surveySubmitted && (
              <Button variant="ghost" size="sm" onClick={() => setShowSurvey(true)} data-testid="button-embed-open-survey">
                <Star className="h-3 w-3 mr-1" />
                問卷
              </Button>
            )}
            {watchToken && (
              <Button variant="ghost" size="sm" onClick={() => setShowQa(true)} data-testid="button-embed-open-qa">
                <MessageCircleQuestion className="h-3 w-3 mr-1" />
                提問
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={sendLike} data-testid="button-embed-like">
              <Heart className="h-3 w-3 mr-1 text-red-500" />
              {likeCount}
            </Button>
          </div>
        </div>

        <ScrollArea className="flex-1">
          <div className="p-3 space-y-2">
            {messages.map((msg, i) => (
              <div key={msg.id || i} className="text-sm">
                <span className="font-medium text-primary mr-1">{msg.senderName}</span>
                <span className="text-foreground">{msg.senderType === "assistant" ? <ChatMaterialText text={msg.message} /> : msg.message}</span>
              </div>
            ))}
            <div ref={chatEndRef} />
          </div>
        </ScrollArea>

        {(!chatConnected || chatNotice) && (
          <div
            className="flex items-center gap-2 text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 px-2 py-1.5 border-t"
            role="status"
            data-testid="chat-notice"
          >
            {!chatConnected && <Loader2 className="w-3 h-3 animate-spin flex-shrink-0" />}
            <span>{!chatConnected ? "聊天室連線中斷，正在重新連線…" : chatNotice}</span>
          </div>
        )}
        <div className="flex gap-2 p-2 border-t">
          <Input
            placeholder="輸入訊息..."
            value={messageInput}
            onChange={(e) => setMessageInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) sendMessage(); }}
            className="flex-1"
            data-testid="input-embed-chat"
          />
          <Button size="icon" onClick={sendMessage} data-testid="button-embed-send">
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>
      <CheckoutBuyerDialog
        open={!!checkoutCtaId}
        onOpenChange={open => !open && setCheckoutCtaId(null)}
        onContinue={async (buyer: CheckoutBuyer) => {
          if (!id || !checkoutCtaId) throw new Error("目前無法確認商品，請關閉後再試。");
          await openOfferCheckout(id, checkoutCtaId, { sessionId, buyer }).catch(error => {
            throw new Error(viewerCheckoutError(error));
          });
        }}
      />
      {checkoutError && <p className="border-t p-3 text-sm text-destructive" role="alert">{checkoutError}</p>}
      <ViewerPollDialog
        active={activePoll}
        results={pollResults}
        onVote={submitVote}
        onClose={() => { setActivePoll(null); setPollResults(null); }}
      />
      <ViewerSurveyDialog
        survey={feedbackSurvey}
        open={showSurvey && !surveySubmitted}
        onOpenChange={setShowSurvey}
        watchToken={watchToken}
        onSubmitted={() => setSurveySubmitted(true)}
      />
      {id && <ViewerQaDialog webinarId={id} watchToken={watchToken} open={showQa} onOpenChange={setShowQa} />}
    </div>
  );
}
