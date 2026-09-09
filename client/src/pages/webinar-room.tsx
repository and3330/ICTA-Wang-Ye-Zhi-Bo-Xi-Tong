import { useState, useEffect, useRef } from "react";
import { useParams, Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Heart, Send, Users, Loader2, ExternalLink, X, Info, Star, Clock, Play } from "lucide-react";
import type { Webinar, ChatMessage, CtaButton, Poll, ScheduledMessage, Tip, FakeUser, FeedbackSurvey } from "@shared/schema";
import { WebinarTrackingProvider, type TrackingWebinar } from "@/components/webinar-tracking-provider";
import { fetchWatchState, getWatchToken, type WatchState } from "@/lib/watch-access";
import { useAttendanceTracking } from "@/lib/use-attendance-tracking";
import { openOfferCheckout, openTrackedExternalUrl, trackWebinarEvent } from "@/lib/webinar-tracking";

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
  const iframeRef = useRef<HTMLIFrameElement>(null);
  
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [messageInput, setMessageInput] = useState("");
  const chatEndRef = useRef<HTMLDivElement>(null);
  
  const [likeCount, setLikeCount] = useState(0);
  const [showLikeAnimation, setShowLikeAnimation] = useState(false);
  
  const [visibleCtas, setVisibleCtas] = useState<CtaButton[]>([]);
  const [liveCtas, setLiveCtas] = useState<CtaButton[]>([]);
  
  const [activePoll, setActivePoll] = useState<Poll | null>(null);
  const [selectedOption, setSelectedOption] = useState<number | null>(null);
  const [hasVoted, setHasVoted] = useState(false);
  const [pollResults, setPollResults] = useState<Record<number, number>>({});
  
  const wsRef = useRef<WebSocket | null>(null);
  const [viewerCount, setViewerCount] = useState(1);
  
  const shownMessagesRef = useRef<Set<string>>(new Set());
  
  const [visibleTip, setVisibleTip] = useState<Tip | null>(null);
  const shownTipsRef = useRef<Set<string>>(new Set());

  const [floatingHearts, setFloatingHearts] = useState<{ id: number; x: number }[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  
  const [showSurvey, setShowSurvey] = useState(false);
  const [surveyResponses, setSurveyResponses] = useState<Record<string, any>>({});
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
  const { data: watchState, isLoading: watchStateLoading } = useQuery<WatchState>({
    queryKey: ["/api/webinars", id, "watch-state", watchToken],
    queryFn: () => fetchWatchState(id!, watchToken!),
    enabled: !!id && !!watchToken,
    refetchInterval: isJoined ? 30_000 : 5_000,
    retry: false,
  });
  const effectiveVimeoUrl = watchToken ? watchState?.vimeoUrl : webinar?.vimeoUrl;
  const canWatch = watchToken ? !!watchState?.canWatch : !!webinar?.vimeoUrl;

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

  const { data: feedbackSurvey } = useQuery<FeedbackSurvey>({
    queryKey: ["/api/webinars", id, "feedback-survey"],
    enabled: !!id && isJoined,
  });

  const { data: savedProgress } = useQuery<{ lastPosition: number; totalWatched: number }>({
    queryKey: ["/api/webinars", id, "progress", sessionId],
    enabled: !!id && isJoined,
  });

  const submitSurveyMutation = useMutation({
    mutationFn: async (data: { surveyId: string; responses: Record<string, any> }) => {
      return apiRequest("POST", "/api/feedback-responses", { ...data, watchToken });
    },
    onSuccess: () => {
      setSurveySubmitted(true);
      toast({ title: "感謝您的回饋！" });
    },
  });

  const saveProgressMutation = useMutation({
    mutationFn: async (data: { viewerSessionId: string; lastPosition: number; totalWatched: number }) => {
      return apiRequest("POST", `/api/webinars/${id}/progress`, data);
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
    if (!effectiveVimeoUrl || !isJoined || waitingForStart || !canWatch || watchStateLoading) return;

    const script = document.createElement("script");
    script.src = "https://player.vimeo.com/api/player.js";
    script.async = true;
    document.body.appendChild(script);

    script.onload = () => {
      if (iframeRef.current && (window as any).Vimeo) {
        const player = new (window as any).Vimeo.Player(iframeRef.current);
        playerRef.current = player;

        // Simulated-live: seek to where the show would be NOW based on the viewer's
        // first-join time. Leaving & returning lands at the live-equivalent position
        // (the show kept "airing" while they were away), not back at the start.
        try {
          const startKey = `liveStart_${id}_${sessionId}`;
          let startedAt = Number(localStorage.getItem(startKey) || 0);
          if (!startedAt) {
            startedAt = Date.now();
            localStorage.setItem(startKey, String(startedAt));
          }
          const elapsed = Math.floor((Date.now() - startedAt) / 1000);
          if (elapsed > 1) {
            player.getDuration().then((dur: number) => {
              const target = dur > 0 ? Math.min(elapsed, Math.max(0, dur - 2)) : elapsed;
              player.setCurrentTime(target).catch(() => {});
            }).catch(() => {
              player.setCurrentTime(elapsed).catch(() => {});
            });
          }
        } catch {}

        player.on("timeupdate", (data: { seconds: number; duration?: number }) => {
          setCurrentTime(Math.floor(data.seconds));
          if (data.duration) setVideoDuration(data.duration);
        });

        player.on("play", () => setIsPlaying(true));
        player.on("pause", () => setIsPlaying(false));
        player.on("ended", () => {
          setVideoEnded(true);
          setIsPlaying(false);
          Promise.all([player.getCurrentTime(), player.getDuration()])
            .then(([position, duration]: [number, number]) => {
              trackWebinarEvent(id, "video_progress", {
                positionSeconds: duration || position,
                metadata: { progressPercent: 100 },
              });
            })
            .catch(() => {});
          if (feedbackSurvey && feedbackSurvey.isActive && !surveySubmitted) {
            setShowSurvey(true);
          }
        });
      }
    };

    return () => {
      if (script.parentNode) {
        script.parentNode.removeChild(script);
      }
    };
  }, [effectiveVimeoUrl, isJoined, waitingForStart, savedProgress, canWatch, watchStateLoading]);

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
    liveCtas.forEach((cta) => trackWebinarEvent(id, "cta_view", { ctaKey: cta.id }));
  }, [id, visibleCtas, liveCtas]);
  
  useEffect(() => {
    if (!scheduledMessages || !fakeUsers || !isPlaying) return;
    
    scheduledMessages.forEach((msg) => {
      const msgKey = `msg_${msg.id}`;
      if (currentTime >= msg.triggerTime && !shownMessagesRef.current.has(msgKey)) {
        shownMessagesRef.current.add(msgKey);
        const fakeUser = fakeUsers.find(u => u.id === msg.fakeUserId);
        const senderName = fakeUser?.name || "觀眾";
        const chatMsg: ChatMessage = {
          id: `scheduled_${msg.id}_${Date.now()}`,
          webinarId: id!,
          sessionId: null,
          senderName,
          message: msg.message,
          senderType: "scheduled",
          sentAt: new Date(),
          isPrivate: false
        };
        setMessages((prev) => [...prev, chatMsg]);
      }
    });
  }, [currentTime, scheduledMessages, fakeUsers, isPlaying, id]);
  
  useEffect(() => {
    if (!tips || !isPlaying) return;
    
    tips.forEach((tip) => {
      const tipKey = `tip_${tip.id}`;
      if (currentTime >= tip.triggerTime && !shownTipsRef.current.has(tipKey)) {
        shownTipsRef.current.add(tipKey);
        setVisibleTip(tip);
        setTimeout(() => {
          setVisibleTip((current) => current?.id === tip.id ? null : current);
        }, (tip.duration || 10) * 1000);
      }
    });
  }, [currentTime, tips, isPlaying]);

  useEffect(() => {
    if (!isJoined || !id || !sessionId) return;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({
        type: "join",
        data: { webinarId: id, sessionId, nickname, watchToken: watchToken || undefined }
      }));
    };

    ws.onmessage = (event) => {
      const msg: WebSocketMessage = JSON.parse(event.data);
      
      switch (msg.type) {
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
          setActivePoll(msg.data);
          setHasVoted(false);
          setSelectedOption(null);
          setPollResults({});
          break;
        case "pollResults":
          setPollResults(msg.data.results);
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
          setVisibleTip(tip);
          setTimeout(() => {
            setVisibleTip((current) => (current?.id === tip.id ? null : current));
          }, (msg.data.duration || 10) * 1000);
          break;
        }
        case "history":
          setMessages(msg.data.messages || []);
          setLikeCount(msg.data.likeCount || 0);
          break;
        case "sessionConfirmed":
          break;
      }
    };

    ws.onclose = (event) => {
      if (event.code === 1008 || event.code === 1011) setIsJoined(false);
    };

    return () => {
      if (currentTime > 0) {
        saveProgressMutation.mutate({
          viewerSessionId: sessionId,
          lastPosition: currentTime,
          totalWatched: currentTime,
        });
      }
      ws.close();
    };
  }, [isJoined, id, nickname, sessionId, watchToken]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

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
    if (!text || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
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

  const submitVote = () => {
    if (selectedOption === null || !wsRef.current || !activePoll) return;
    wsRef.current.send(JSON.stringify({
      type: "vote",
      data: {
        pollId: activePoll.id,
        optionIndex: selectedOption,
        sessionId
      }
    }));
    setHasVoted(true);
  };

  const dismissPoll = () => {
    setActivePoll(null);
    setHasVoted(false);
    setPollResults({});
    setSelectedOption(null);
  };

  const handleSurveySubmit = () => {
    if (!feedbackSurvey) return;
    submitSurveyMutation.mutate({
      surveyId: feedbackSurvey.id,
      responses: surveyResponses,
    });
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
    if (!canWatch || !effectiveVimeoUrl) {
      return (
        <div className="min-h-screen flex items-center justify-center p-4" style={brandGradient || {}}>
          {trackingProvider}
          <Card className="max-w-md w-full"><CardContent className="pt-6 text-center space-y-4">
            <h2 className="text-xl font-bold">{webinar.title}</h2>
            <p className="text-muted-foreground">請先完成報名並選擇場次，再進入觀看。</p>
            <Link href={`/register/${id}`} className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">前往報名</Link>
          </CardContent></Card>
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
            <p className="text-center text-muted-foreground mb-6">請輸入您的暱稱加入直播</p>
            <div className="space-y-4">
              <Input
                placeholder="輸入暱稱"
                value={nicknameInput}
                onChange={(e) => setNicknameInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleJoin()}
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

  if (waitingForStart || (watchToken && (watchStateLoading || !canWatch))) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4" style={brandGradient || { background: "linear-gradient(135deg, #4338ca 0%, #7e22ce 50%, #be185d 100%)" }}>
        {trackingProvider}
        <Card className="max-w-lg w-full">
          <CardContent className="pt-8 pb-8 text-center">
            {brandSettings?.logo && (
              <div className="flex justify-center mb-4">
                <img src={brandSettings.logo} alt="Logo" className="max-h-12 object-contain" />
              </div>
            )}
            <div className="w-20 h-20 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-6">
              <Clock className="h-10 w-10 text-primary" />
            </div>
            <h2 className="text-2xl font-bold mb-2">{webinar.title}</h2>
            <p className="text-muted-foreground mb-6">直播即將開始，請稍候</p>
            <div className="bg-muted rounded-lg p-6 mb-4">
              <p className="text-sm text-muted-foreground mb-2">倒數計時</p>
              <p className="text-3xl font-bold font-mono" data-testid="text-countdown">{countdown}</p>
            </div>
            <p className="text-sm text-muted-foreground">
              開始時間：{formatStartTime(watchState?.waitUntil || watchState?.selectedSession || webinar.startTime)}（{webinar.timezone || "Asia/Taipei"}）
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const surveyQuestions = feedbackSurvey?.questions as { id: string; type: string; question: string; options?: string[]; required: boolean }[] || [];

  const brandAccentStyle = brandSettings?.primaryColor ? { borderColor: brandSettings.primaryColor } : {};
  const autoplayParam = "0";

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
        <div className="relative bg-black w-full aspect-video lg:aspect-auto lg:flex-1 lg:h-full lg:min-h-0">
          <div className="relative w-full h-full">
            <iframe
              ref={iframeRef}
              src={`https://player.vimeo.com/video/${extractVimeoId(effectiveVimeoUrl!)}?${extractVimeoHash(effectiveVimeoUrl!) ? `h=${extractVimeoHash(effectiveVimeoUrl!)}&` : ""}autoplay=${autoplayParam}&title=0&byline=0&portrait=0&controls=0`}
              className="absolute inset-0 w-full h-full"
              allow="autoplay; fullscreen; picture-in-picture"
              allowFullScreen
              data-testid="video-player"
            />
            {isPlaying ? (
              <div
                className="absolute inset-0 cursor-default"
                style={{ zIndex: 5, pointerEvents: "auto" }}
                data-testid="video-overlay-block"
              />
            ) : (
              <button
                type="button"
                onClick={async () => {
                  const player = playerRef.current;
                  if (!player) return;
                  try {
                    await player.setMuted(false);
                    await player.setVolume(1);
                  } catch {}
                  player.play().catch(() => {});
                }}
                className="absolute inset-0 flex items-center justify-center bg-black/40 hover:bg-black/30 transition-colors group"
                style={{ zIndex: 5 }}
                data-testid="button-play-video"
                aria-label="播放影片"
              >
                <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-full bg-white/95 group-hover:bg-white flex items-center justify-center shadow-2xl transition-all group-hover:scale-110">
                  <Play className="w-10 h-10 sm:w-12 sm:h-12 text-slate-900 fill-slate-900 ml-1" />
                </div>
              </button>
            )}
            
            {(visibleCtas.length > 0 || liveCtas.length > 0) && (
              <div className="absolute bottom-2 sm:bottom-4 left-2 sm:left-4 right-2 sm:right-4 flex flex-col gap-1.5 sm:gap-2 z-10">
                {[...visibleCtas, ...liveCtas].map((cta) => (
                  <Button
                    key={cta.id}
                    variant={cta.style === "primary" ? "default" : cta.style === "danger" ? "destructive" : "secondary"}
                    className="w-full sm:w-auto animate-pulse"
                    onClick={() => {
                      if (cta.offerId && id) {
                        void openOfferCheckout(id, cta.id, { sessionId }).catch((error) => {
                          toast({ title: error.message || "Unable to start checkout", variant: "destructive" });
                        });
                      } else if (cta.url) {
                        openTrackedExternalUrl(
                          id,
                          cta.url,
                          liveCtas.some((live) => live.id === cta.id) ? { ctaKey: cta.id } : { ctaId: cta.id },
                        );
                      }
                    }}
                    data-testid={`cta-button-${cta.id}`}
                  >
                    <ExternalLink className="w-4 h-4 mr-2" />
                    {cta.text}
                  </Button>
                ))}
              </div>
            )}

            <div className="absolute top-3 left-3 z-10">
              <Badge variant="secondary" className="bg-black/60 text-white border-0 backdrop-blur-sm">
                <div className="w-2 h-2 rounded-full bg-red-500 mr-1.5 animate-pulse" />
                LIVE
              </Badge>
            </div>
            
            {visibleTip && (
              <div className="hidden lg:block absolute top-4 right-4 z-20 max-w-xs animate-in slide-in-from-right duration-300" data-testid="tip-card-desktop">
                <Card className="bg-white/95 dark:bg-card/95 backdrop-blur shadow-lg">
                  <CardContent className="p-3">
                    <div className="flex items-start gap-2">
                      <Info className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
                      <div className="flex-1">
                        <h4 className="font-medium text-sm">{visibleTip.title}</h4>
                        <p className="text-xs text-muted-foreground mt-1">{visibleTip.content}</p>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setVisibleTip(null)}
                        data-testid="button-close-tip"
                      >
                        <X className="w-4 h-4" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}

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
                        onClick={() => openTrackedExternalUrl(id, replay.ctaUrl!)}
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
        </div>

        {visibleTip && (
          <div className="lg:hidden px-3 py-2 border-b bg-background animate-in slide-in-from-top duration-300" data-testid="tip-card-mobile">
            <Card className="bg-primary/5 border-primary/20">
              <CardContent className="p-3">
                <div className="flex items-start gap-2">
                  <Info className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <h4 className="font-medium text-sm">{visibleTip.title}</h4>
                    <p className="text-xs text-muted-foreground mt-1 break-words">{visibleTip.content}</p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 flex-shrink-0"
                    onClick={() => setVisibleTip(null)}
                    data-testid="button-close-tip-mobile"
                  >
                    <X className="w-4 h-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

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
                const isMe = msg.senderName === nickname && msg.senderType === "viewer";
                const isHost = msg.senderType === "host";
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
                          {isHost && " ・主辦"}
                        </span>
                      )}
                      <div className={`inline-block px-3 py-2 text-[13px] leading-relaxed break-words ${
                        isMe
                          ? "bg-primary text-primary-foreground rounded-2xl rounded-br-sm"
                          : isHost
                          ? "bg-red-500/10 dark:bg-red-500/20 text-foreground rounded-2xl rounded-bl-sm"
                          : "bg-muted text-foreground rounded-2xl rounded-bl-sm"
                      }`}>
                        {msg.message}
                      </div>
                    </div>
                  </div>
                );
              })}
              <div ref={chatEndRef} />
            </div>
          </ScrollArea>

          <div className="border-t bg-card p-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2 px-1">
              <span className="truncate">{nickname}</span>
              <span className="ml-auto flex-shrink-0 opacity-70">Shift + Enter 送出</span>
            </div>
            <div className="flex gap-2 items-center">
              <Input
                ref={inputRef}
                placeholder="說些什麼..."
                value={messageInput}
                onChange={(e) => setMessageInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && e.shiftKey && !e.nativeEvent.isComposing) {
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

      <Dialog open={!!activePoll && !hasVoted} onOpenChange={() => {}}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>投票</DialogTitle>
            <DialogDescription>{activePoll?.question}</DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <RadioGroup
              value={selectedOption?.toString()}
              onValueChange={(v) => setSelectedOption(parseInt(v))}
            >
              {(activePoll?.options as string[] || []).map((option, index) => (
                <div key={index} className="flex items-center space-x-2">
                  <RadioGroupItem value={index.toString()} id={`option-${index}`} />
                  <Label htmlFor={`option-${index}`}>{option}</Label>
                </div>
              ))}
            </RadioGroup>
          </div>
          <Button
            onClick={submitVote}
            disabled={selectedOption === null}
            className="w-full"
            data-testid="button-submit-vote"
          >
            提交投票
          </Button>
        </DialogContent>
      </Dialog>

      <Dialog open={hasVoted && Object.keys(pollResults).length > 0} onOpenChange={(o) => { if (!o) dismissPoll(); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>投票結果</DialogTitle>
          </DialogHeader>
          <div className="py-4 space-y-3">
            {(activePoll?.options as string[] || []).map((option, index) => {
              const votes = pollResults[index] || 0;
              const total = Object.values(pollResults).reduce((a, b) => a + b, 0);
              const percentage = total > 0 ? Math.round((votes / total) * 100) : 0;
              
              return (
                <div key={index}>
                  <div className="flex justify-between text-sm mb-1">
                    <span>{option}</span>
                    <span>{percentage}%</span>
                  </div>
                  <div className="h-2 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary transition-all"
                      style={{ width: `${percentage}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
          <Button onClick={dismissPoll} variant="outline" className="w-full">
            關閉
          </Button>
        </DialogContent>
      </Dialog>

      <Dialog open={showSurvey && !surveySubmitted} onOpenChange={setShowSurvey}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{feedbackSurvey?.title || "回饋問卷"}</DialogTitle>
            <DialogDescription>請花一點時間分享您的想法</DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-4 max-h-[60vh] overflow-y-auto">
            {surveyQuestions.map((q) => (
              <div key={q.id} className="space-y-2">
                <Label className="text-sm font-medium">
                  {q.question}
                  {q.required && <span className="text-destructive ml-1">*</span>}
                </Label>
                
                {q.type === "rating" && (
                  <div className="flex gap-1">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <Button
                        key={star}
                        variant="ghost"
                        size="icon"
                        onClick={() => setSurveyResponses(prev => ({ ...prev, [q.id]: star }))}
                        data-testid={`survey-rating-${q.id}-${star}`}
                      >
                        <Star className={`w-6 h-6 ${(surveyResponses[q.id] || 0) >= star ? "fill-yellow-400 text-yellow-400" : "text-muted-foreground"}`} />
                      </Button>
                    ))}
                  </div>
                )}
                
                {q.type === "text" && (
                  <Textarea
                    placeholder="請輸入您的回答..."
                    value={surveyResponses[q.id] || ""}
                    onChange={(e) => setSurveyResponses(prev => ({ ...prev, [q.id]: e.target.value }))}
                    data-testid={`survey-text-${q.id}`}
                  />
                )}
                
                {q.type === "multiChoice" && q.options && (
                  <RadioGroup
                    value={surveyResponses[q.id] || ""}
                    onValueChange={(v) => setSurveyResponses(prev => ({ ...prev, [q.id]: v }))}
                  >
                    {q.options.map((opt, i) => (
                      <div key={i} className="flex items-center space-x-2">
                        <RadioGroupItem value={opt} id={`survey-${q.id}-${i}`} />
                        <Label htmlFor={`survey-${q.id}-${i}`}>{opt}</Label>
                      </div>
                    ))}
                  </RadioGroup>
                )}
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setShowSurvey(false)} className="flex-1">
              稍後再說
            </Button>
            <Button
              onClick={handleSurveySubmit}
              disabled={submitSurveyMutation.isPending}
              className="flex-1"
              data-testid="button-submit-survey"
            >
              {submitSurveyMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              提交回饋
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
