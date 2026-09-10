import { useState, useEffect, useRef, useCallback } from "react";
import { useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { apiRequest } from "@/lib/queryClient";
import { Heart, Send, ExternalLink, Loader2 } from "lucide-react";
import type { Webinar, ChatMessage, CtaButton, ScheduledMessage, FakeUser } from "@shared/schema";
import { WebinarTrackingProvider, type TrackingWebinar } from "@/components/webinar-tracking-provider";
import { fetchWatchState, getWatchToken, type WatchState } from "@/lib/watch-access";
import { isPlaybackPermitted, resolveViewerAccessState } from "@/lib/watch-access-state";
import { ViewerAccessState } from "@/components/viewer-access-state";
import { useAttendanceTracking } from "@/lib/use-attendance-tracking";
import { openOfferCheckout, openTrackedExternalUrl, trackWebinarEvent } from "@/lib/webinar-tracking";

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
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [messageInput, setMessageInput] = useState("");
  const chatEndRef = useRef<HTMLDivElement>(null);

  const [likeCount, setLikeCount] = useState(0);
  const [visibleCtas, setVisibleCtas] = useState<CtaButton[]>([]);
  const [liveCtas, setLiveCtas] = useState<CtaButton[]>([]);

  const wsRef = useRef<WebSocket | null>(null);
  const [viewerCount, setViewerCount] = useState(1);
  const shownMessagesRef = useRef<Set<string>>(new Set());

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

  const connectWebSocket = useCallback(() => {
    if (!id || !nickname || !sessionId) return;
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "join", data: { webinarId: id, nickname, sessionId, watchToken: watchToken || undefined } }));
    };
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      switch (msg.type) {
        case "history":
          setMessages(msg.data?.messages || []);
          if (msg.data?.likeCount) setLikeCount(msg.data.likeCount);
          break;
        case "chat":
          setMessages(prev => [...prev, msg.data]);
          break;
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
      }
    };
    ws.onclose = (event) => {
      if (event.code === 1008 || event.code === 1011) {
        setIsJoined(false);
        return;
      }
      setTimeout(() => connectWebSocket(), 3000);
    };
    wsRef.current = ws;
  }, [id, nickname, sessionId, watchToken]);

  useEffect(() => {
    if (isJoined) connectWebSocket();
    return () => { wsRef.current?.close(); };
  }, [isJoined, connectWebSocket]);

  useEffect(() => {
    if (!isJoined || !effectiveVimeoUrl || !canWatch || watchStateLoading) return;
    const script = document.createElement("script");
    script.src = "https://player.vimeo.com/api/player.js";
    script.onload = () => {
      if (iframeRef.current && (window as any).Vimeo) {
        const player = new (window as any).Vimeo.Player(iframeRef.current);
        playerRef.current = player;
        player.on("timeupdate", (data: { seconds: number; duration?: number }) => {
          setCurrentTime(data.seconds);
          if (data.duration) setVideoDuration(data.duration);
        });
        player.on("play", () => setIsPlaying(true));
        player.on("pause", () => setIsPlaying(false));
        player.on("ended", () => {
          Promise.all([player.getCurrentTime(), player.getDuration()])
            .then(([position, duration]: [number, number]) => {
              trackWebinarEvent(id, "video_progress", {
                positionSeconds: duration || position,
                metadata: { progressPercent: 100 },
              });
            })
            .catch(() => {});
        });
      }
    };
    document.head.appendChild(script);
  }, [isJoined, effectiveVimeoUrl, canWatch, watchStateLoading]);

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
    if (!isPlaying || !scheduledMessages || !fakeUsers) return;
    scheduledMessages.forEach(sm => {
      if (currentTime >= sm.triggerTime && !shownMessagesRef.current.has(sm.id)) {
        shownMessagesRef.current.add(sm.id);
        const fu = fakeUsers.find(f => f.id === sm.fakeUserId);
        setMessages(prev => [...prev, {
          id: `sm_${sm.id}`,
          webinarId: id!,
          sessionId: "system",
          senderName: fu?.name || "觀眾",
          senderType: "scheduled",
          message: sm.message,
          sentAt: new Date(),
          isPrivate: false,
        } as ChatMessage]);
      }
    });
  }, [currentTime, isPlaying, scheduledMessages, fakeUsers, id]);

  useEffect(() => {
    if (!ctas || !isPlaying) return;
    const visible = ctas.filter(cta => {
      const start = cta.startTime || 0;
      const end = cta.endTime || start + 300;
      return currentTime >= start && currentTime <= end;
    });
    setVisibleCtas(visible);
  }, [currentTime, ctas, isPlaying]);

  useEffect(() => {
    if (!id) return;
    visibleCtas.forEach((cta) => trackWebinarEvent(id, "cta_view", { ctaId: cta.id }));
    liveCtas.forEach((cta) => trackWebinarEvent(id, "cta_view", { ctaId: cta.id }));
  }, [id, visibleCtas, liveCtas]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMessage = () => {
    if (!messageInput.trim() || !wsRef.current) return;
    wsRef.current.send(JSON.stringify({
      type: "chat",
      data: { webinarId: id, message: messageInput.trim(), senderName: nickname, sessionId, senderType: "viewer" },
    }));
    setMessageInput("");
  };

  const sendLike = () => {
    wsRef.current?.send(JSON.stringify({ type: "like", data: { webinarId: id, sessionId } }));
  };

  const getVimeoEmbedUrl = (url: string) => {
    const match = url.match(/vimeo\.com\/(\d+)/);
    return match ? `https://player.vimeo.com/video/${match[1]}?autoplay=1` : url;
  };

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
    if (!canWatch || !effectiveVimeoUrl) {
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
            onKeyDown={(e) => {
              if (e.key === "Enter" && nicknameInput.trim()) {
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
      <div className="relative bg-black">
        <div className="relative w-full" style={{ paddingBottom: "56.25%" }}>
          {canWatch && effectiveVimeoUrl ? (
            <iframe
              ref={iframeRef}
              src={getVimeoEmbedUrl(effectiveVimeoUrl!)}
              className="absolute inset-0 w-full h-full"
              allow="autoplay; fullscreen; picture-in-picture"
              allowFullScreen
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
        </div>
        {[...visibleCtas, ...liveCtas].map(cta => (
          <div key={cta.id} className="absolute bottom-2 left-1/2 transform -translate-x-1/2 z-10">
            <Button
              size="sm"
              onClick={() => {
                if (cta.offerId && id) void openOfferCheckout(id, cta.id, { sessionId });
                else if (cta.url) openTrackedExternalUrl(
                  id,
                  cta.url,
                  { ctaId: cta.id },
                );
              }}
            >
                <ExternalLink className="h-3 w-3 mr-1" />
                {cta.text}
            </Button>
          </div>
        ))}
      </div>

      <div className="flex-1 flex flex-col min-h-0 border-t">
        <div className="flex items-center justify-between gap-2 px-3 py-2 border-b bg-card">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="outline" className="text-xs">{viewerCount} 人觀看</Badge>
          </div>
          <Button variant="ghost" size="sm" onClick={sendLike} data-testid="button-embed-like">
            <Heart className="h-3 w-3 mr-1 text-red-500" />
            {likeCount}
          </Button>
        </div>

        <ScrollArea className="flex-1">
          <div className="p-3 space-y-2">
            {messages.map((msg, i) => (
              <div key={msg.id || i} className="text-sm">
                <span className="font-medium text-primary mr-1">{msg.senderName}</span>
                <span className="text-foreground">{msg.message}</span>
              </div>
            ))}
            <div ref={chatEndRef} />
          </div>
        </ScrollArea>

        <div className="flex gap-2 p-2 border-t">
          <Input
            placeholder="輸入訊息..."
            value={messageInput}
            onChange={(e) => setMessageInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") sendMessage(); }}
            className="flex-1"
            data-testid="input-embed-chat"
          />
          <Button size="icon" onClick={sendMessage} data-testid="button-embed-send">
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
