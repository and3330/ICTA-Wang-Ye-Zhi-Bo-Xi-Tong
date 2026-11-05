import { AiThinkingIndicator, useAiThinking } from "@/components/ai-thinking";
import { useState, useEffect, useRef } from "react";
import { collectScheduledChat, collectTipChat } from "@/lib/scheduled-chat";
import { ChatMaterialText } from "@/components/chat-material-text";
import { useParams } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Heart, Send, Users, Loader2, ExternalLink, X, Star, Play, MessageCircleQuestion } from "lucide-react";
import type { Webinar, ChatMessage, CtaButton, Poll, ScheduledMessage, Tip, FakeUser, FeedbackSurvey } from "@shared/schema";
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
import { ViewerQaDialog, ViewerSurveyDialog } from "@/components/viewer-interactions";
import { ChatPollCard } from "@/components/chat-poll-card";
import { useChatPolls } from "@/hooks/use-chat-polls";
import { DEFAULT_POLL_SECONDS } from "@/lib/timed-interactions";
import { ViewerVolumeControl } from "@/components/viewer-volume";
import { viewerCheckoutError } from "@/lib/viewer-messages";

interface WebSocketMessage {
  type: string;
  data: any;
}

export default function WebinarRoom() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  
  const [nickname, setNickname] = useState("");
  const [isJoined, setIsJoined] = useState(false);
  const [nicknameInput, setNicknameInput] = useState("");
  
  const [sessionId] = useState(() => {
    const storageKey = `webinar_session_${id}`;
    let storedSession = localStorage.getItem(storageKey);
    if (!storedSession) {
      storedSession = `session_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
      localStorage.setItem(storageKey, storedSession);
    }
    return storedSession;
  });
  
  const [currentTime, setCurrentTime] = useState(0);
  const [videoDuration, setVideoDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [videoEnded, setVideoEnded] = useState(false);
  const playerRef = useRef<any>(null);
  const [playerReady, setPlayerReady] = useState(false);
  
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [aiThinking, setAiThinking] = useAiThinking();
  const [messageInput, setMessageInput] = useState("");
  const chatEndRef = useRef<HTMLDivElement>(null);
  
  const [likeCount, setLikeCount] = useState(0);
  const [showLikeAnimation, setShowLikeAnimation] = useState(false);
  
  const [visibleCtas, setVisibleCtas] = useState<CtaButton[]>([]);
  const [liveCtas, setLiveCtas] = useState<CtaButton[]>([]);
  const [checkoutCtaId, setCheckoutCtaId] = useState<string | null>(null);
  
  const [showQa, setShowQa] = useState(false);
  
  const wsRef = useRef<WebSocket | null>(null);
  const [chatConnected, setChatConnected] = useState(true);
  const [viewerCount, setViewerCount] = useState(1);
  
  const shownMessagesRef = useRef<Set<string>>(new Set());
  

  const [floatingHearts, setFloatingHearts] = useState<{ id: number; x: number }[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  
  const [showSurvey, setShowSurvey] = useState(false);
  const [surveySubmitted, setSurveySubmitted] = useState(false);

  const [waitingForStart, setWaitingForStart] = useState(false);
  const [countdown, setCountdown] = useState("");

  const progressSaveRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const currentTimeRef = useRef(0);
  const saveProgressMutationRef = useRef<(data: { viewerSessionId: string; lastPosition: number; totalWatched: number }) => void>(() => {});

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

  const { data: ctas } = useQuery<CtaButton[]>({
    queryKey: ["/api/webinars", id, "ctas"],
    enabled: !!id && isJoined,
  });
  
  const { data: scheduledMessages } = useQuery<ScheduledMessage[]>({
    queryKey: ["/api/webinars", id, "scheduled-messages"],
    enabled: !!id && isJoined,
  });
  
  const { data: fakeUsers } = useQuery<FakeUser[]>({
    queryKey: ["/api/webinars", id, "fake-users"],
    enabled: !!id && isJoined,
  });
  
  const { data: tips } = useQuery<Tip[]>({
    queryKey: ["/api/webinars", id, "tips"],
    enabled: !!id && isJoined,
  });

  const { data: polls } = useQuery<Poll[]>({
    queryKey: ["/api/webinars", id, "polls"],
    enabled: !!id && isJoined,
  });

  const { data: feedbackSurvey } = useQuery<FeedbackSurvey>({
    queryKey: ["/api/webinars", id, "feedback-survey"],
    enabled: !!id && isJoined,
  });


  const saveProgressMutation = useMutation({
    mutationFn: async (data: { viewerSessionId: string; lastPosition: number; totalWatched: number }) => {
      // Only registered viewers have progress; without a token there is nothing to save.
      if (!watchToken) return null;
      return apiRequest("POST", `/api/webinars/${id}/progress`, { ...data, watchToken });
    },
  });
  currentTimeRef.current = currentTime;
  saveProgressMutationRef.current = saveProgressMutation.mutate;
  useAttendanceTracking({
    registrationId: watchState?.registrationId,
    watchToken,
    enabled: isJoined && canWatch,
    currentPosition: currentTime,
  });

  // A viewer who came from the registration email already gave a name.
  useEffect(() => {
    if (watchState?.viewerName) setNicknameInput((current) => current || watchState.viewerName!);
  }, [watchState?.viewerName]);

  const isOnDemand = webinar?.scheduleMode && typeof webinar.scheduleMode === 'object' && (webinar.scheduleMode as any).onDemand;
  const isJustInTime = webinar?.scheduleMode && typeof webinar.scheduleMode === 'object' && (webinar.scheduleMode as any).justInTime;

  useEffect(() => {
    if (!webinar || !isJoined || !watchToken) return;

    const checkTime = () => {
      const now = new Date();
      const scheduledStart = watchState?.waitUntil || watchState?.selectedSession;
      // A watch-state without a selected/wait session represents immediate
      // on-demand access. Never substitute the webinar's future fixed start.
      if (canWatch && !scheduledStart) {
        setWaitingForStart(false);
        setCountdown("");
        return;
      }
      const start = new Date(scheduledStart || webinar.startTime);
      const diff = start.getTime() - now.getTime();
      
      if (diff <= 0) {
        setWaitingForStart(!canWatch);
        setCountdown("");
        return;
      }
      
      setWaitingForStart(true);
      
      const days = Math.floor(diff / (1000 * 60 * 60 * 24));
      const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((diff % (1000 * 60)) / 1000);
      
      if (days > 0) {
        setCountdown(`${days} 天 ${hours} 時 ${minutes} 分 ${seconds} 秒`);
      } else if (hours > 0) {
        setCountdown(`${hours} 時 ${minutes} 分 ${seconds} 秒`);
      } else {
        setCountdown(`${minutes} 分 ${seconds} 秒`);
      }
    };

    checkTime();
    const interval = setInterval(checkTime, 1000);
    return () => clearInterval(interval);
  }, [webinar, isJoined, watchToken, watchState, canWatch]);

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
    const onPageHide = () => {
      trackWebinarEvent(
        id,
        "dropoff",
        { positionSeconds: currentTime, metadata: { reason: "navigate" } },
        { beacon: true },
      );
    };
    window.addEventListener("pagehide", onPageHide);
    return () => window.removeEventListener("pagehide", onPageHide);
  }, [id, isJoined, currentTime]);

  useEffect(() => {
    if (!isJoined || !isPlaying) return;

    progressSaveRef.current = setInterval(() => {
      const latestPosition = currentTimeRef.current;
      saveProgressMutationRef.current({
        viewerSessionId: sessionId,
        lastPosition: latestPosition,
        totalWatched: latestPosition,
      });
    }, 30000);

    return () => {
      if (progressSaveRef.current) clearInterval(progressSaveRef.current);
    };
  }, [isJoined, isPlaying, sessionId]);

  useEffect(() => {
    if (!ctas) return;
    const visible = ctas.filter((cta) => {
      const isAfterStart = currentTime >= cta.startTime;
      const isBeforeEnd = !cta.endTime || currentTime <= cta.endTime;
      return isAfterStart && isBeforeEnd;
    });
    setVisibleCtas(visible);
  }, [currentTime, ctas]);

  useEffect(() => {
    if (!id) return;
    visibleCtas.forEach((cta) => trackWebinarEvent(id, "cta_view", { ctaId: cta.id }));
    liveCtas.forEach((cta) => trackWebinarEvent(id, "cta_view", { ctaId: cta.id }));
  }, [id, visibleCtas, liveCtas]);
  
  useEffect(() => {
    if (!scheduledMessages || !id) return;
    const due = collectScheduledChat(scheduledMessages, currentTime, isPlaying, shownMessagesRef.current, id, fakeUsers);
    if (due.length) setMessages(prev => [...prev, ...due]);
  }, [currentTime, scheduledMessages, fakeUsers, isPlaying, id]);
  
  useEffect(() => {
    if (!tips || !id) return;
    const due = collectTipChat(tips, currentTime, isPlaying, shownMessagesRef.current, id);
    if (due.length) setMessages(prev => [...prev, ...due]);
  }, [tips, currentTime, isPlaying, id]);
  const { chatPolls, showPoll, setPollResults } = useChatPolls(id, polls, currentTime, isPlaying, setMessages);

  useEffect(() => {
    if (!isJoined || !id || !sessionId) return;

    let disposed = false;
    let attempt = 0;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const handleMessage = (event: MessageEvent) => {
      const msg: WebSocketMessage = JSON.parse(event.data);
      
      switch (msg.type) {
        case "aiThinking":
          setAiThinking(!!msg.data?.active);
          break;
        case "chat":
          setMessages((prev) => {
            const incoming = msg.data;
            if (incoming?.id && prev.some((m) => m.id === incoming.id)) return prev;
            return [...prev, incoming];
          });
          break;
        case "like":
          setLikeCount(msg.data.count);
          setShowLikeAnimation(true);
          setTimeout(() => setShowLikeAnimation(false), 300);
          break;
        case "viewerCount":
          setViewerCount(msg.data.count);
          break;
        case "poll":
          // Pushed by the host from the control room.
          showPoll(msg.data, msg.data.duration || DEFAULT_POLL_SECONDS);
          break;
        case "pollResults":
          setPollResults(msg.data.pollId, msg.data.results);
          break;
        case "scheduledMessage":
          setMessages((prev) => [...prev, msg.data]);
          break;
        case "liveCta": {
          const cta = { ...msg.data, startTime: 0, endTime: null } as CtaButton;
          setLiveCtas((prev) => [...prev.filter((c) => c.id !== cta.id), cta]);
          if (msg.data.expiresAt) {
            const ms = msg.data.expiresAt - Date.now();
            if (ms > 0) setTimeout(() => setLiveCtas((prev) => prev.filter((c) => c.id !== cta.id)), ms);
          }
          break;
        }
        case "liveTip": {
          const tip = msg.data as Tip;
          const due = collectTipChat([tip], tip.triggerTime, true, shownMessagesRef.current, id!);
          if (due.length) setMessages(prev => [...prev, ...due]);
          break;
        }
        case "history":
          // History arrives on every (re)join. Keep the timed fake-audience
          // messages that only exist in this browser, and drop optimistic
          // copies of messages the server has now confirmed.
          setMessages((prev) => {
            const history: ChatMessage[] = msg.data.messages || [];
            const historyIds = new Set(history.map((m) => m.id));
            const localOnly = prev.filter((m) => {
              const localId = String(m.id);
              if (historyIds.has(m.id)) return false;
              if (localId.startsWith("scheduled_")) return true;
              if (localId.startsWith("local-")) {
                return !history.some((h) => h.senderType === "viewer" && h.message === m.message);
              }
              return false;
            });
            return [...history, ...localOnly].sort(
              (a, b) => new Date(a.sentAt ?? 0).getTime() - new Date(b.sentAt ?? 0).getTime(),
            );
          });
          setLikeCount(msg.data.likeCount || 0);
          break;
        case "error": {
          const code = msg.data?.code;
          if (code === "chat_rejected") {
            // The server did not save it: remove the newest optimistic copy.
            setMessages((prev) => {
              const index = prev.map((m) => String(m.id).startsWith("local-")).lastIndexOf(true);
              return index === -1 ? prev : [...prev.slice(0, index), ...prev.slice(index + 1)];
            });
          }
          toast({
            title: code === "ai_busy" ? "AI 助教" : code === "join_failed" ? "無法加入聊天室" : "訊息沒有送出",
            description: code === "join_failed"
              ? "請重新整理頁面，或從報名信裡的連結重新進入。"
              : msg.data?.message || "請稍後再試。",
            variant: code === "ai_busy" ? "default" : "destructive",
          });
          break;
        }
        case "sessionConfirmed":
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
        socket.send(JSON.stringify({
          type: "join",
          data: { webinarId: id, sessionId, nickname, watchToken: watchToken || undefined }
        }));
      };
      socket.onmessage = handleMessage;
      socket.onclose = (event) => {
        if (wsRef.current === socket) wsRef.current = null;
        if (disposed) return;
        // 1008/1011: access expired or could not be verified; reconnecting
        // would only be refused again.
        if (event.code === 1008 || event.code === 1011) {
          setIsJoined(false);
          return;
        }
        // Network drops, a phone suspending the tab and server redeploys all
        // land here: retry with backoff so chat, AI replies and host pushes
        // resume without a page reload.
        setChatConnected(false);
        const delay = Math.min(30_000, 1_000 * 2 ** attempt);
        attempt += 1;
        retryTimer = setTimeout(connect, delay);
      };
    };

    // Coming back to the tab or regaining network should not wait out the backoff.
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
      if (currentTime > 0) {
        saveProgressMutation.mutate({
          viewerSessionId: sessionId,
          lastPosition: currentTime,
          totalWatched: currentTime,
        });
      }
      const socket = wsRef.current;
      wsRef.current = null;
      socket?.close();
    };
  }, [isJoined, id, nickname, sessionId, watchToken]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, aiThinking]);

  const handleJoin = () => {
    if (nicknameInput.trim().length < 2) {
      toast({
        title: "請輸入暱稱",
        description: "暱稱至少需要 2 個字",
        variant: "destructive",
      });
      return;
    }
    setNickname(nicknameInput.trim());
    setIsJoined(true);
    trackWebinarEvent(id, "webinar_enter");
  };

  const sendMessage = () => {
    const text = messageInput.trim();
    if (!text) return;
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      // Keep the typed text so the viewer can resend once chat is back.
      toast({ title: "聊天室重新連線中", description: "連上後再按一次送出就可以了。" });
      return;
    }
    wsRef.current.send(JSON.stringify({
      type: "chat",
      data: {
        webinarId: id,
        sessionId,
        senderName: nickname,
        message: text,
        senderType: "viewer"
      }
    }));
    const optimistic = {
      id: `local-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      webinarId: id || "",
      sessionId,
      senderName: nickname,
      senderType: "viewer",
      message: text,
      sentAt: new Date(),
      isPrivate: false,
    } as ChatMessage;
    setMessages((prev) => [...prev, optimistic]);
    setMessageInput("");
  };

  const sendLike = () => {
    if (!wsRef.current) return;
    wsRef.current.send(JSON.stringify({
      type: "like",
      data: { webinarId: id, sessionId }
    }));
    const heartId = Date.now();
    const x = 20 + Math.random() * 60;
    setFloatingHearts(prev => [...prev, { id: heartId, x }]);
    setTimeout(() => {
      setFloatingHearts(prev => prev.filter(h => h.id !== heartId));
    }, 1500);
  };

  const submitVote = (pollId: string, optionIndex: number) => {
    const socket = wsRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    socket.send(JSON.stringify({
      type: "vote",
      data: { pollId, optionIndex, sessionId },
    }));
    return true;
  };


  const extractVimeoId = (url: string) => {
    const trimmed = url.trim();
    if (/^\d+$/.test(trimmed)) return trimmed;
    const patterns = [
      /(?:player\.)?vimeo\.com\/video\/(\d+)/,
      /vimeo\.com\/channels\/[^/]+\/(\d+)/,
      /vimeo\.com\/groups\/[^/]+\/videos\/(\d+)/,
      /vimeo\.com\/ondemand\/[^/]+\/(\d+)/,
      /vimeo\.com\/(\d+)/,
    ];
    for (const pattern of patterns) {
      const match = trimmed.match(pattern);
      if (match) return match[1];
    }
    return trimmed;
  };

  const extractVimeoHash = (url: string) => {
    const trimmed = url.trim();
    const queryMatch = trimmed.match(/[?&]h=([a-zA-Z0-9]+)/);
    if (queryMatch) return queryMatch[1];
    const pathMatch = trimmed.match(/vimeo\.com\/(?:video\/)?\d+\/([a-zA-Z0-9]+)/);
    return pathMatch ? pathMatch[1] : null;
  };

  const playbackSource: PlaybackSource | undefined = effectivePlayback || (effectiveVimeoUrl ? {
    provider: "vimeo",
    url: `https://player.vimeo.com/video/${extractVimeoId(effectiveVimeoUrl)}?${extractVimeoHash(effectiveVimeoUrl) ? `h=${extractVimeoHash(effectiveVimeoUrl)}&` : ""}autoplay=0&title=0&byline=0&portrait=0&controls=0`,
  } : undefined);

  // The "live" position is the time since this viewer started watching this
  // session. The key is scoped to the selected session so a viewer coming back
  // for a later session (or a replay days later) starts again instead of being
  // thrown to the last seconds of the video.
  const liveStartKey = `liveStart_${id}_${sessionId}_${watchState?.selectedSession || watchState?.waitUntil || "on-demand"}`;

  const handlePlayerReady = (player: any) => {
    playerRef.current = player;
    setPlayerReady(true);
    try {
      localStorage.removeItem(`liveStart_${id}_${sessionId}`); // pre-fix key, never expired
      const startedAt = Number(localStorage.getItem(liveStartKey) || 0);
      if (!startedAt) return; // first visit: the clock starts on first play
      const elapsed = Math.floor((Date.now() - startedAt) / 1000);
      if (elapsed <= 1) return;
      Promise.resolve(player.getDuration()).then((duration: number) => {
        if (duration > 0 && elapsed >= duration - 2) {
          // The earlier viewing already finished; watch again from the start.
          localStorage.removeItem(liveStartKey);
          return;
        }
        return player.setCurrentTime(elapsed);
      }).catch(() => {});
    } catch {}
  };

  const handlePlayerPlay = () => {
    setIsPlaying(true);
    try {
      if (!localStorage.getItem(liveStartKey)) {
        localStorage.setItem(liveStartKey, String(Date.now() - currentTimeRef.current * 1000));
      }
    } catch {}
  };

  const formatStartTime = (date: Date | string) => {
    return new Date(date).toLocaleString("zh-TW", {
      month: "long", day: "numeric", hour: "2-digit", minute: "2-digit",
      timeZone: webinar?.timezone || "Asia/Taipei",
    });
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (!webinar) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Card className="max-w-md">
          <CardContent className="pt-6">
            <p className="text-center text-muted-foreground">找不到此直播間</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const brandSettings = webinar.brandSettings as { logo?: string; primaryColor?: string; secondaryColor?: string; backgroundColor?: string } | null;
  const brandGradient = brandSettings?.primaryColor && brandSettings?.secondaryColor
    ? { background: `linear-gradient(135deg, ${brandSettings.primaryColor} 0%, ${brandSettings.secondaryColor} 100%)` }
    : undefined;
  const tracking = webinar as Webinar & TrackingWebinar;
  const trackingProvider = (
    <WebinarTrackingProvider
      webinarId={id}
      metaPixelId={tracking.metaPixelId}
      gtmContainerId={tracking.gtmContainerId}
    />
  );

  if (!isJoined) {
    if (!canWatch || !hasPlayback) {
      return (
        <div className="min-h-screen flex items-center justify-center p-4" style={brandGradient || {}}>
          {trackingProvider}
          <ViewerAccessState
            kind={accessKind}
            title={webinar.title}
            startsAt={watchState?.waitUntil || watchState?.selectedSession || webinar.startTime}
            timezone={webinar.timezone}
            onRetry={() => void refetchWatchState()}
            onRegister={accessKind === "unavailable" ? () => window.location.assign(`/register/${id}`) : undefined}
          />
        </div>
      );
    }
    return (
      <div className="min-h-screen flex items-center justify-center p-4" style={brandGradient || { background: "linear-gradient(135deg, #4338ca 0%, #7e22ce 50%, #be185d 100%)" }}>
        {trackingProvider}
        <Card className="max-w-md w-full">
          <CardContent className="pt-6">
            {brandSettings?.logo && (
              <div className="flex justify-center mb-4">
                <img src={brandSettings.logo} alt="Logo" className="max-h-12 object-contain" />
              </div>
            )}
            <h2 className="text-xl font-bold text-center mb-2">{webinar.title}</h2>
            {!isOnDemand && (
              <p className="text-center text-sm text-muted-foreground mb-1">
                {formatStartTime(webinar.startTime)}
              </p>
            )}
            {isOnDemand && (
              <p className="text-center text-sm text-muted-foreground mb-1">
                隨時可觀看
              </p>
            )}
            {isJustInTime && (
              <p className="text-center text-sm text-muted-foreground mb-1">
                進入後即刻開始
              </p>
            )}
            <p className="text-center text-muted-foreground mb-6">
              {watchState?.viewerName ? "確認聊天室顯示的名字，就可以進場" : "請輸入您的暱稱加入直播"}
            </p>
            <div className="space-y-4">
              <Input
                placeholder="輸入暱稱"
                value={nicknameInput}
                onChange={(e) => setNicknameInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && handleJoin()}
                autoFocus
                data-testid="input-nickname"
              />
              <Button onClick={handleJoin} className="w-full" data-testid="button-join">
                進入直播間
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!canWatch || waitingForStart) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4" style={brandGradient || { background: "linear-gradient(135deg, #4338ca 0%, #7e22ce 50%, #be185d 100%)" }}>
        {trackingProvider}
        <ViewerAccessState
          kind={waitingForStart && accessKind === "verified" ? "upcoming" : accessKind}
          title={webinar.title}
          startsAt={watchState?.waitUntil || watchState?.selectedSession || webinar.startTime}
          timezone={webinar.timezone}
          onRetry={() => void refetchWatchState()}
          onRegister={accessKind === "unavailable" ? () => window.location.assign(`/register/${id}`) : undefined}
        />
      </div>
    );
  }

  const brandAccentStyle = brandSettings?.primaryColor ? { borderColor: brandSettings.primaryColor } : {};
  return (
    <div className="min-h-screen bg-background">
      {trackingProvider}
      {brandSettings?.logo && (
        <div className="h-10 flex items-center px-4 border-b" style={brandAccentStyle}>
          <img src={brandSettings.logo} alt="Logo" className="max-h-6 object-contain" data-testid="brand-logo" />
          <span className="ml-3 text-sm font-medium truncate">{webinar.title}</span>
        </div>
      )}
      <div className={`flex flex-col lg:flex-row ${brandSettings?.logo ? "h-[calc(100dvh-2.5rem)]" : "h-[100dvh]"}`}>
        <FullscreenVideo className="relative bg-black w-full aspect-video lg:aspect-auto lg:flex-1 lg:h-full lg:min-h-0" enabled={!!playbackSource}>
          <div className="relative w-full h-full">
            {playbackSource && <ProviderPlayer
              source={playbackSource}
              renewSource={effectivePlayback?.provider === "bunny" ? async () => {
                const result = await refetchWatchState();
                if (!result.data?.playback) throw new Error("403: 播放授權已失效");
                return result.data.playback;
              } : undefined}
              className="absolute inset-0 w-full h-full"
              onReady={handlePlayerReady}
              onTimeUpdate={(seconds, duration) => { setCurrentTime(Math.floor(seconds)); if (duration) setVideoDuration(duration); }}
              onPlay={handlePlayerPlay}
              onPause={() => setIsPlaying(false)}
              onEnded={() => {
                setVideoEnded(true);
                setIsPlaying(false);
                trackWebinarEvent(id, "video_progress", { positionSeconds: videoDuration || currentTime, metadata: { progressPercent: 100 } });
                if (feedbackSurvey?.isActive && !surveySubmitted) setShowSurvey(true);
              }}
            />}
            {isPlaying ? (
              <div
                className="absolute inset-0 cursor-default"
                style={{ zIndex: 5, pointerEvents: "auto" }}
                data-testid="video-overlay-block"
              />
            ) : (
              <button
                type="button"
                disabled={!playerReady}
                onClick={() => {
                  const player = playerRef.current;
                  if (!player) return;
                  // Start within the click gesture, before asynchronous volume
                  // calls can lose browser playback permission.
                  void player.play().then(() => {
                    void player.setMuted(false).catch(() => {});
                    void player.setVolume(1).catch(() => {});
                  }).catch(() => {
                    toast({ title: "影片無法播放", description: "請再次點擊播放；若仍失敗，請確認影片的嵌入權限或稍後重試。", variant: "destructive" });
                  });
                }}
                className="absolute inset-0 flex items-center justify-center bg-black/40 hover:bg-black/30 transition-colors group"
                style={{ zIndex: 5 }}
                data-testid="button-play-video"
                aria-label={playerReady ? "播放影片" : "播放器載入中"}
              >
                <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-full bg-white/95 group-hover:bg-white flex items-center justify-center shadow-2xl transition-all group-hover:scale-110">
                  {playerReady ? <Play className="w-10 h-10 sm:w-12 sm:h-12 text-slate-900 fill-slate-900 ml-1" /> : <span className="text-sm text-slate-900">載入中</span>}
                </div>
              </button>
            )}
            
            {(visibleCtas.length > 0 || liveCtas.length > 0) && (
              <div className="absolute bottom-2 sm:bottom-4 left-2 sm:left-4 right-2 sm:right-4 flex flex-col gap-1.5 sm:gap-2 z-10">
                {[...visibleCtas, ...liveCtas].map((cta) => (
                  <Button
                    key={cta.id}
                    asChild={!!cta.url && !cta.offerId}
                    variant={cta.style === "primary" ? "default" : cta.style === "danger" ? "destructive" : "secondary"}
                    className="w-full sm:w-auto animate-[pulse_1s_ease-in-out_3]"
                    onClick={(event) => {
                      if (cta.offerId && id) {
                        // A verified registration is resolved by the server from the viewing
                        // context. Unregistered checkout must collect buyer contact first.
                        if (!watchState?.registrationId) {
                          setCheckoutCtaId(cta.id);
                          return;
                        }
                        void openOfferCheckout(id, cta.id, { sessionId, registrationId: watchState.registrationId, watchToken: watchToken || undefined }).catch((error) => {
                          toast({ title: viewerCheckoutError(error), variant: "destructive" });
                        });
                      } else if (cta.url) {
                        void openTrackedExternalUrl(
                          id,
                          cta.url,
                          { ctaId: cta.id, watchToken: watchToken || undefined },
                          { preventDefault: () => event.preventDefault() },
                        );
                      }
                    }}
                    data-testid={`cta-button-${cta.id}`}
                  >
                    {cta.url && !cta.offerId
                      ? <a href={cta.url} target="_blank" rel="noopener noreferrer"><ExternalLink className="w-4 h-4 mr-2" />{cta.text}</a>
                      : <><ExternalLink className="w-4 h-4 mr-2" />{cta.text}</>}
                  </Button>
                ))}
              </div>
            )}

            <div className="absolute top-3 left-3 z-10 flex items-center gap-2">
              <Badge variant="secondary" className="bg-black/60 text-white border-0 backdrop-blur-sm">
                <div className="w-2 h-2 rounded-full bg-red-500 mr-1.5 animate-pulse" />
                LIVE
              </Badge>
              {playerReady && <ViewerVolumeControl playerRef={playerRef} />}
            </div>
            

            {videoEnded && (() => {
              const replay = webinar.replaySettings as { headline?: string; message?: string; ctaText?: string; ctaUrl?: string } | null;
              return (
                <div className="absolute inset-0 bg-black/70 flex items-center justify-center z-20 p-4">
                  <div className="text-center text-white max-w-md">
                    <h3 className="text-xl font-bold mb-2" data-testid="text-replay-headline">
                      {replay?.headline || "直播已結束"}
                    </h3>
                    <p className="text-white/70 mb-4" data-testid="text-replay-message">
                      {replay?.message || "感謝您的觀看"}
                    </p>
                    {replay?.ctaText && replay?.ctaUrl && (
                      <Button
                        onClick={() => { void openTrackedExternalUrl(id, replay.ctaUrl!); }}
                        className="mb-3 w-full"
                        data-testid="button-replay-cta"
                      >
                        {replay.ctaText}
                      </Button>
                    )}
                    {feedbackSurvey && feedbackSurvey.isActive && !surveySubmitted && (
                      <Button onClick={() => setShowSurvey(true)} variant="secondary" data-testid="button-open-survey">
                        <Star className="w-4 h-4 mr-2" />
                        填寫回饋問卷
                      </Button>
                    )}
                  </div>
                </div>
              );
            })()}
          </div>
        </FullscreenVideo>


        <div className="w-full lg:w-[380px] flex flex-col border-l bg-background flex-1 lg:flex-none lg:h-full min-h-0 relative">
          <div className="px-4 py-3 border-b flex items-center justify-between gap-2 bg-card">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-sm">即時聊天</span>
              <Badge variant="secondary" className="text-[10px]">
                <Users className="w-3 h-3 mr-1" />
                {viewerCount}
              </Badge>
            </div>
            <div className="flex items-center gap-1">
              {watchToken && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowQa(true)}
                  className="gap-1.5"
                  data-testid="button-open-qa"
                >
                  <MessageCircleQuestion className="w-4 h-4" />
                  <span className="text-xs">提問</span>
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={sendLike}
                className="gap-1.5 relative"
                data-testid="button-like"
              >
                <Heart className={`w-4 h-4 transition-colors duration-200 ${showLikeAnimation ? "fill-red-500 text-red-500" : likeCount > 0 ? "fill-red-500 text-red-500" : ""}`} />
                <span className="text-xs font-medium tabular-nums">{likeCount}</span>
              </Button>
            </div>
          </div>

          {floatingHearts.length > 0 && (
            <div className="absolute bottom-20 right-4 w-12 h-32 pointer-events-none z-30">
              {floatingHearts.map((heart) => (
                <div
                  key={heart.id}
                  className="absolute animate-float-up"
                  style={{ left: `${heart.x}%` }}
                >
                  <Heart className="w-5 h-5 fill-red-500 text-red-500 opacity-80" />
                </div>
              ))}
            </div>
          )}

          <ScrollArea className="flex-1">
            <div className="px-3 py-3">
              {messages.length === 0 && (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-3">
                    <Send className="w-5 h-5 text-muted-foreground" />
                  </div>
                  <p className="text-sm text-muted-foreground">歡迎來到聊天室</p>
                  <p className="text-xs text-muted-foreground/60 mt-1">在下方輸入訊息開始互動</p>
                </div>
              )}
              {messages.map((msg, index) => {
                const chatPoll = chatPolls[msg.id];
                if (chatPoll) return <ChatPollCard key={msg.id} active={chatPoll.active} results={chatPoll.results} onVote={option => submitVote(chatPoll.active.poll.id, option)} />;
                const isMe = msg.senderName === nickname && msg.senderType === "viewer";
                const isAssistant = msg.senderType === "assistant";
                const isHost = msg.senderType === "host" || isAssistant;
                const isScheduled = msg.senderType === "scheduled";
                const initial = msg.senderName?.charAt(0)?.toUpperCase() || "?";

                return (
                  <div
                    key={msg.id || index}
                    className={`flex items-end gap-1.5 mb-2 ${isMe ? "flex-row-reverse" : ""}`}
                    data-testid={`chat-message-${index}`}
                  >
                    {!isMe && (
                      <Avatar className={`w-6 h-6 flex-shrink-0 ${
                        isHost ? "bg-red-500 text-white" : isScheduled ? "bg-blue-500 text-white" : "bg-muted text-muted-foreground"
                      }`}>
                        <AvatarFallback className={`text-[10px] font-semibold ${
                          isHost ? "bg-red-500 text-white" : isScheduled ? "bg-blue-500 text-white" : "bg-muted text-muted-foreground"
                        }`}>
                          {initial}
                        </AvatarFallback>
                      </Avatar>
                    )}
                    <div className={`max-w-[75%] ${isMe ? "items-end" : "items-start"} flex flex-col`}>
                      {!isMe && (
                        <span className={`text-[10px] font-medium mb-0.5 px-2 leading-none ${
                          isHost ? "text-red-500" : isScheduled ? "text-blue-500" : "text-muted-foreground"
                        }`}>
                          {msg.senderName}
                          {isAssistant ? " ・定時資料" : isHost ? " ・主辦" : ""}
                        </span>
                      )}
                      <div className={`inline-block px-3 py-2 text-[13px] leading-relaxed break-words ${
                        isMe
                          ? "bg-primary text-primary-foreground rounded-2xl rounded-br-sm"
                          : isHost
                          ? "bg-red-500/10 dark:bg-red-500/20 text-foreground rounded-2xl rounded-bl-sm"
                          : "bg-muted text-foreground rounded-2xl rounded-bl-sm"
                      }`}>
                        {isAssistant ? <ChatMaterialText text={msg.message} /> : msg.message}
                      </div>
                    </div>
                  </div>
                );
              })}
              {aiThinking && <AiThinkingIndicator className="px-1 py-1" />}
              <div ref={chatEndRef} />
            </div>
          </ScrollArea>

          <div className="border-t bg-card p-3">
            {!chatConnected && (
              <div
                className="flex items-center gap-2 text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 rounded-md px-2 py-1.5 mb-2"
                role="status"
                data-testid="chat-reconnecting"
              >
                <Loader2 className="w-3 h-3 animate-spin" />
                <span>聊天室連線中斷，正在重新連線…</span>
              </div>
            )}
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2 px-1">
              <span className="truncate">{nickname}</span>
              <span className="ml-auto flex-shrink-0 opacity-70">Enter 送出</span>
            </div>
            <div className="flex gap-2 items-center">
              <Input
                ref={inputRef}
                placeholder="說些什麼..."
                value={messageInput}
                onChange={(e) => setMessageInput(e.target.value)}
                onKeyDown={(e) => {
                  // isComposing: Enter that picks a Chinese IME candidate must not send.
                  if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    sendMessage();
                  }
                }}
                className="flex-1 rounded-full bg-muted border-0 focus-visible:ring-1 focus-visible:ring-primary"
                data-testid="input-chat-message"
              />
              <Button
                type="button"
                onClick={sendMessage}
                disabled={!messageInput.trim()}
                className="rounded-full flex-shrink-0 h-10 w-10 p-0"
                data-testid="button-send-message"
                aria-label="送出訊息"
              >
                <Send className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>
      </div>
      <CheckoutBuyerDialog
        open={!!checkoutCtaId}
        onOpenChange={open => !open && setCheckoutCtaId(null)}
        onContinue={async (buyer: CheckoutBuyer) => {
          if (!id || !checkoutCtaId) throw new Error("目前無法確認商品，請關閉後再試。");
          await openOfferCheckout(id, checkoutCtaId, { sessionId, buyer }).catch((error) => {
            throw new Error(viewerCheckoutError(error));
          });
        }}
      />


      <ViewerSurveyDialog
        survey={feedbackSurvey}
        open={showSurvey && !surveySubmitted}
        onOpenChange={setShowSurvey}
        watchToken={watchToken}
        onSubmitted={() => {
          setSurveySubmitted(true);
          toast({ title: "感謝您的回饋！" });
        }}
      />

      {id && <ViewerQaDialog webinarId={id} watchToken={watchToken} open={showQa} onOpenChange={setShowQa} />}
    </div>
  );
}
