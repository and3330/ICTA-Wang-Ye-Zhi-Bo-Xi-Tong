import { useState, useEffect, useRef } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { useAdminLang, type LangAdmin } from "@/hooks/use-lang";
import { 
  ArrowLeft, Send, Users, Heart, MessageSquare, 
  Loader2, Radio, BarChart, User, MessageCircle, Clock, Languages, X, Search, ArrowDown
} from "lucide-react";
import type { Webinar, ChatMessage, Poll } from "@shared/schema";

/** Same name, same color: makes it easy to follow one viewer down the chat. */
function viewerTone(name: string | null | undefined): string {
  let hash = 0;
  for (const char of name || "?") hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return `control-tone-${hash % 6}`;
}

const t: Record<LangAdmin, Record<string, string>> = {
  "zh-TW": {
    defaultHostName: "主辦人",
    toastBroadcast: "訊息已廣播給所有觀眾",
    toastReply: "已回覆此觀眾",
    toastPollSelected: "投票已發送給選定觀眾",
    toastPollAll: "投票已發送給所有觀眾",
    connected: "已連線",
    connecting: "連線中...",
    headerSubtitle: "即時控制台 - 獨立觀眾視圖",
    viewerCount: "人觀看",
    viewerList: "觀眾列表",
    allMessages: "所有訊息",
    noViewers: "尚無觀眾加入",
    onlineGroup: "在線上",
    offlineGroup: "不在線上",
    offlineHint: "已離線，無法即時回覆",
    messageCount: "則訊息",
    viewerFallback: "觀眾",
    conversation: "的對話",
    allChat: "所有聊天訊息",
    badgeHost: "主辦",
    badgeDummy: "假人",
    badgePrivate: "私訊",
    viewConversation: "回覆",
    sendBroadcast: "廣播",
    sendReply: "回覆",
    backToBroadcast: "改回發送給所有觀眾",
    speakAs: "發言名稱",
    searchViewers: "搜尋觀眾",
    newMessages: "則新訊息",
    tabPoll: "投票",
    displayName: "顯示名稱",
    replyPlaceholder: "回覆此觀眾...",
    broadcastPlaceholder: "廣播給所有觀眾...",
    replyHintPrefix: "只有 ",
    replyHintSuffix: " 會看到此回覆",
    controlPanel: "控制面板",
    quickPoll: "快速投票",
    noPollSettings: "尚無投票設定",
    sendToViewer: "發送給此觀眾",
    sendToAll: "發送給所有人",
    liveStatus: "直播狀態",
    onlineCount: "在線人數",
    interactiveViewers: "互動觀眾",
    likeCount: "按讚數",
    messageTotal: "訊息數",
    notFound: "找不到此直播間",
    studio: "導播台（一鍵推送）",
    studioHint: "邊看影片邊即時推送，立即顯示給所有觀眾",
    videoPreview: "影片預覽",
    quickCta: "快速 CTA 按鈕",
    ctaText: "按鈕文字",
    ctaUrl: "連結網址",
    ctaStyle: "樣式",
    stylePrimary: "主要",
    styleSecondary: "次要",
    styleDanger: "強調",
    durationSec: "顯示秒數（留空＝持續）",
    pushNow: "立即顯示",
    quickTip: "快速小提示卡",
    tipTitle: "標題",
    tipContent: "內容",
    quickChat: "快速假人聊天",
    chatName: "暱稱",
    pickFakeUser: "選假人",
    chatMessage: "訊息內容",
    sendChat: "發送到聊天室",
    toastCtaPushed: "CTA 已顯示給所有觀眾",
    toastTipPushed: "小提示卡已顯示給所有觀眾",
    toastChatPushed: "假人訊息已發送",
    fillRequired: "請填寫必填欄位",
    commandCenter: "直播指揮中心",
    commandHint: "掌握觀眾動態、回覆訊息，並在直播中推送成交內容。",
    audienceHint: "選擇觀眾即可查看並單獨回覆",
    chatHint: "點選觀眾即可切換為私人對話",
    actionsHint: "推送後會立即出現在觀眾畫面",
    broadcastMode: "發送給所有觀眾",
    privateMode: "只回覆",
    emptyMessages: "尚無聊天訊息",
  },
  "zh-CN": {
    defaultHostName: "主办人",
    toastBroadcast: "消息已广播给所有观众",
    toastReply: "已回复此观众",
    toastPollSelected: "投票已发送给选定观众",
    toastPollAll: "投票已发送给所有观众",
    connected: "已连线",
    connecting: "连线中...",
    headerSubtitle: "实时控制台 - 独立观众视图",
    viewerCount: "人观看",
    viewerList: "观众列表",
    allMessages: "所有消息",
    noViewers: "尚无观众加入",
    onlineGroup: "在线上",
    offlineGroup: "不在线上",
    offlineHint: "已离线，无法实时回复",
    messageCount: "则消息",
    viewerFallback: "观众",
    conversation: "的对话",
    allChat: "所有聊天消息",
    badgeHost: "主办",
    badgeDummy: "假人",
    badgePrivate: "私信",
    viewConversation: "回复",
    sendBroadcast: "广播",
    sendReply: "回复",
    backToBroadcast: "改回发送给所有观众",
    speakAs: "发言名称",
    searchViewers: "搜索观众",
    newMessages: "条新消息",
    tabPoll: "投票",
    displayName: "显示名称",
    replyPlaceholder: "回复此观众...",
    broadcastPlaceholder: "广播给所有观众...",
    replyHintPrefix: "只有 ",
    replyHintSuffix: " 会看到此回复",
    controlPanel: "控制面板",
    quickPoll: "快速投票",
    noPollSettings: "尚无投票设定",
    sendToViewer: "发送给此观众",
    sendToAll: "发送给所有人",
    liveStatus: "直播状态",
    onlineCount: "在线人数",
    interactiveViewers: "互动观众",
    likeCount: "点赞数",
    messageTotal: "消息数",
    notFound: "找不到此直播间",
    studio: "导播台（一键推送）",
    studioHint: "边看视频边实时推送，立即显示给所有观众",
    videoPreview: "视频预览",
    quickCta: "快速 CTA 按钮",
    ctaText: "按钮文字",
    ctaUrl: "链接网址",
    ctaStyle: "样式",
    stylePrimary: "主要",
    styleSecondary: "次要",
    styleDanger: "强调",
    durationSec: "显示秒数（留空＝持续）",
    pushNow: "立即显示",
    quickTip: "快速小提示卡",
    tipTitle: "标题",
    tipContent: "内容",
    quickChat: "快速假人聊天",
    chatName: "昵称",
    pickFakeUser: "选假人",
    chatMessage: "消息内容",
    sendChat: "发送到聊天室",
    toastCtaPushed: "CTA 已显示给所有观众",
    toastTipPushed: "小提示卡已显示给所有观众",
    toastChatPushed: "假人消息已发送",
    fillRequired: "请填写必填栏位",
    commandCenter: "直播指挥中心",
    commandHint: "掌握观众动态、回复消息，并在直播中推送成交内容。",
    audienceHint: "选择观众即可查看并单独回复",
    chatHint: "点击观众即可切换为私人对话",
    actionsHint: "推送后会立即出现在观众画面",
    broadcastMode: "发送给所有观众",
    privateMode: "只回复",
    emptyMessages: "尚无聊天消息",
  },
};

interface WebSocketMessage {
  type: string;
  data: any;
}

interface ViewerSession {
  sessionId: string;
  nickname: string;
  messages: ChatMessage[];
  lastActivity: Date;
}

export default function AdminControl() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { lang, setLang } = useAdminLang();
  const s = t[lang];
  
  const [hostName, setHostName] = useState(s.defaultHostName);
  const [hostNameEdited, setHostNameEdited] = useState(false);
  const [messageInput, setMessageInput] = useState("");
  
  const [allMessages, setAllMessages] = useState<ChatMessage[]>([]);
  const [viewerSessions, setViewerSessions] = useState<Map<string, ViewerSession>>(new Map());
  const [onlineSessions, setOnlineSessions] = useState<Map<string, string>>(new Map());
  const [selectedSession, setSelectedSession] = useState<string | null>(null);

  const [ctaTextInput, setCtaTextInput] = useState("");
  const [ctaUrlInput, setCtaUrlInput] = useState("");
  const [ctaTargetType, setCtaTargetType] = useState<"external" | "page" | "offer">("external");
  const [ctaTargetId, setCtaTargetId] = useState("");
  const [ctaStyleInput, setCtaStyleInput] = useState("primary");
  const [ctaDurInput, setCtaDurInput] = useState("");
  const [tipTitleInput, setTipTitleInput] = useState("");
  const [tipContentInput, setTipContentInput] = useState("");
  const [tipDurInput, setTipDurInput] = useState("10");
  const [chatNameInput, setChatNameInput] = useState("");
  const [chatMsgInput, setChatMsgInput] = useState("");
  const [viewerCount, setViewerCount] = useState(0);
  const [likeCount, setLikeCount] = useState(0);
  const [isConnected, setIsConnected] = useState(false);
  const [ctaPending, setCtaPending] = useState(false);
  const pendingCtaId = useRef<string | null>(null);
  const pendingCtaTimer = useRef<number | null>(null);
  const clearPendingCta = () => {
    if (pendingCtaTimer.current !== null) window.clearTimeout(pendingCtaTimer.current);
    pendingCtaTimer.current = null;
    pendingCtaId.current = null;
    setCtaPending(false);
  };
  const studioReady = () => {
    if (isConnected && wsRef.current?.readyState === WebSocket.OPEN) return true;
    toast({ title: "控制台尚未連線或未完成主辦人驗證，請重新整理或重新登入", variant: "destructive" });
    return false;
  };
  
  useEffect(() => {
    if (!hostNameEdited) setHostName(s.defaultHostName);
  }, [lang, s.defaultHostName, hostNameEdited]);

  const wsRef = useRef<WebSocket | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const messageInputRef = useRef<HTMLInputElement>(null);
  // Follow new messages only while the host is at the bottom; reading older
  // messages is never interrupted, and a pill shows how many arrived.
  const stickToBottom = useRef(true);
  const [unseenCount, setUnseenCount] = useState(0);
  const [audienceQuery, setAudienceQuery] = useState("");

  const { data: webinar, isLoading } = useQuery<Webinar>({
    queryKey: ["/api/webinars", id],
    enabled: !!id,
  });

  const { data: polls } = useQuery<Poll[]>({
    queryKey: ["/api/webinars", id, "polls"],
    enabled: !!id,
  });
  const { data: products } = useQuery<Array<{ id: string; name: string; active: boolean }>>({ queryKey: ["/api/products"] });
  const { data: productPages } = useQuery<Array<{ id: string; title: string; status: string }>>({ queryKey: ["/api/product-sales-pages"] });

  const { data: fakeUsers } = useQuery<{ id: string; name: string }[]>({
    queryKey: ["/api/webinars", id, "fake-users"],
    enabled: !!id,
  });

  useEffect(() => {
    if (!id) return;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({
        type: "joinAsHost",
        data: { webinarId: id }
      }));
    };

    ws.onmessage = (event) => {
      const msg: WebSocketMessage = JSON.parse(event.data);
      
      switch (msg.type) {
        case "hostActionResult":
          if (msg.data?.action === "liveCta" && msg.data.requestId === pendingCtaId.current) {
            clearPendingCta();
            toast({
              title: msg.data.success ? s.toastCtaPushed : "推送失敗",
              description: msg.data.success
                ? `已推送給目前連線的觀眾（${msg.data.viewerCount ?? 0} 人）；稍後進場的觀眾不會收到這次即時推送。`
                : msg.data.message || "伺服器未接受這次推送",
              variant: msg.data.success ? "default" : "destructive",
            });
          }
          break;
        case "error":
          clearPendingCta();
          toast({ title: "控制台連線或操作驗證失敗，請重新登入後再試", variant: "destructive" });
          break;
        case "chat": {
          const chatMsg = msg.data as ChatMessage & { sessionId?: string };
          setAllMessages((prev) => {
            if (chatMsg.id && prev.some((m) => m.id === chatMsg.id)) return prev;
            return [...prev, chatMsg];
          });
          
          if (chatMsg.sessionId && (chatMsg.senderType === "viewer" || chatMsg.senderType === "host")) {
            setViewerSessions((prev) => {
              const updated = new Map(prev);
              const existing = updated.get(chatMsg.sessionId!) || {
                sessionId: chatMsg.sessionId!,
                nickname: chatMsg.senderType === "viewer" ? chatMsg.senderName : "觀眾",
                messages: [],
                lastActivity: new Date()
              };
              if (chatMsg.id && existing.messages.some((m) => m.id === chatMsg.id)) {
                return prev;
              }
              existing.messages = [...existing.messages, chatMsg];
              existing.lastActivity = new Date();
              if (chatMsg.senderType === "viewer") {
                existing.nickname = chatMsg.senderName;
              }
              updated.set(chatMsg.sessionId!, existing);
              return updated;
            });
          }
          break;
        }
        case "like":
          setLikeCount(msg.data.count);
          break;
        case "viewerCount":
          setViewerCount(msg.data.count);
          break;
        case "viewerList": {
          const online = (msg.data.online || []) as { sessionId: string; nickname: string }[];
          const map = new Map<string, string>();
          online.forEach((v) => map.set(v.sessionId, v.nickname));
          setOnlineSessions(map);
          break;
        }
        case "history": {
          setIsConnected(true);
          const messages = msg.data.messages || [];
          setAllMessages(messages);
          setLikeCount(msg.data.likeCount || 0);
          
          const sessionsMap = new Map<string, ViewerSession>();
          messages.forEach((m: ChatMessage & { sessionId?: string }) => {
            if (m.sessionId && m.senderType === "viewer") {
              const existing = sessionsMap.get(m.sessionId) || {
                sessionId: m.sessionId,
                nickname: m.senderName,
                messages: [],
                lastActivity: new Date(m.sentAt || Date.now())
              };
              existing.messages.push(m);
              existing.nickname = m.senderName;
              sessionsMap.set(m.sessionId, existing);
            }
          });
          setViewerSessions(sessionsMap);
          break;
        }
      }
    };

    ws.onclose = () => {
      setIsConnected(false);
      if (pendingCtaId.current) {
        clearPendingCta();
        toast({ title: "連線已中斷，無法確認推送結果；請先確認觀眾畫面", variant: "destructive" });
      }
    };
    ws.onerror = () => setIsConnected(false);

    return () => {
      ws.onclose = null;
      clearPendingCta();
      setIsConnected(false);
      ws.close();
    };
  }, [id]);

  const scrollChatToBottom = (smooth = true) => {
    const box = chatScrollRef.current;
    if (!box) return;
    box.scrollTo({ top: box.scrollHeight, behavior: smooth ? "smooth" : "auto" });
    stickToBottom.current = true;
    setUnseenCount(0);
  };

  // Only the chat box scrolls; the page itself never jumps while typing elsewhere.
  const lastMessageCount = useRef(0);
  useEffect(() => {
    const added = Math.max(0, allMessages.length - lastMessageCount.current);
    lastMessageCount.current = allMessages.length;
    if (stickToBottom.current) scrollChatToBottom();
    else if (added) setUnseenCount((count) => count + added);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allMessages, !!webinar]);

  useEffect(() => {
    scrollChatToBottom(false);
    if (selectedSession) messageInputRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSession]);

  const sendBroadcastMessage = () => {
    if (!messageInput.trim() || !wsRef.current) return;
    const text = messageInput.trim();
    
    wsRef.current.send(JSON.stringify({
      type: "chat",
      data: {
        webinarId: id,
        senderName: hostName,
        message: text,
        senderType: "host"
      }
    }));
    
    const localMsg: ChatMessage = {
      id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      webinarId: id!,
      sessionId: null,
      senderName: hostName,
      message: text,
      senderType: "host",
      sentAt: new Date(),
      isPrivate: false,
    };
    setAllMessages((prev) => [...prev, localMsg]);
    
    setMessageInput("");
    toast({ title: s.toastBroadcast });
  };

  const sendReplyToSession = () => {
    if (!messageInput.trim() || !wsRef.current || !selectedSession) return;
    const text = messageInput.trim();
    
    wsRef.current.send(JSON.stringify({
      type: "hostReply",
      data: {
        webinarId: id,
        sessionId: selectedSession,
        senderName: hostName,
        message: text
      }
    }));
    
    const localMsg: ChatMessage & { sessionId: string } = {
      id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      webinarId: id!,
      sessionId: selectedSession,
      senderName: hostName,
      message: text,
      senderType: "host",
      sentAt: new Date(),
      isPrivate: true,
    };
    setAllMessages((prev) => [...prev, localMsg]);
    setViewerSessions((prev) => {
      const updated = new Map(prev);
      const existing = updated.get(selectedSession);
      if (existing) {
        existing.messages = [...existing.messages, localMsg];
        existing.lastActivity = new Date();
        updated.set(selectedSession, existing);
      } else {
        updated.set(selectedSession, {
          sessionId: selectedSession,
          nickname: getSessionNickname(selectedSession),
          messages: [localMsg],
          lastActivity: new Date(),
        });
      }
      return updated;
    });
    
    setMessageInput("");
    toast({ title: s.toastReply });
  };

  const triggerPoll = (poll: Poll) => {
    if (!studioReady() || !wsRef.current) return;
    
    wsRef.current.send(JSON.stringify({
      type: "triggerPoll",
      data: {
        webinarId: id,
        pollId: poll.id,
        sessionId: selectedSession
      }
    }));
    
    toast({ 
      title: selectedSession ? s.toastPollSelected : s.toastPollAll 
    });
  };

  const pushLiveCta = () => {
    if (!studioReady() || ctaPending) return;
    if (!wsRef.current || !ctaTextInput.trim() || (ctaTargetType === "external" ? !ctaUrlInput.trim() : !ctaTargetId)) {
      toast({ title: s.fillRequired, variant: "destructive" });
      return;
    }
    if (ctaTargetType === "external") {
      try {
        const target = new URL(ctaUrlInput.trim());
        if (!["http:", "https:"].includes(target.protocol)) throw new Error("Invalid URL scheme");
      } catch {
        toast({ title: "請填寫完整的 http:// 或 https:// 網址，不能使用 # 或相對路徑", variant: "destructive" });
        return;
      }
    }
    const requestId = crypto.randomUUID();
    pendingCtaId.current = requestId;
    setCtaPending(true);
    pendingCtaTimer.current = window.setTimeout(() => {
      clearPendingCta();
      toast({ title: "未收到推送確認，請先確認觀眾畫面再重試", variant: "destructive" });
    }, 10_000);
    wsRef.current.send(JSON.stringify({
      type: "liveCta",
      data: {
        requestId,
        text: ctaTextInput.trim(),
        url: ctaTargetType === "external" ? ctaUrlInput.trim() : null,
        offerId: ctaTargetType === "offer" ? ctaTargetId : null,
        salesPageId: ctaTargetType === "page" ? ctaTargetId : null,
        style: ctaStyleInput,
        durationSec: ctaDurInput ? Number(ctaDurInput) : undefined,
      },
    }));
  };

  const pushLiveTip = () => {
    if (!studioReady()) return;
    if (!wsRef.current || (!tipTitleInput.trim() && !tipContentInput.trim())) {
      toast({ title: s.fillRequired, variant: "destructive" });
      return;
    }
    wsRef.current.send(JSON.stringify({
      type: "liveTip",
      data: {
        title: tipTitleInput.trim(),
        content: tipContentInput.trim(),
        durationSec: tipDurInput ? Number(tipDurInput) : 10,
      },
    }));
    toast({ title: s.toastTipPushed });
  };

  const pushLiveChat = () => {
    if (!studioReady()) return;
    if (!wsRef.current || !chatMsgInput.trim()) {
      toast({ title: s.fillRequired, variant: "destructive" });
      return;
    }
    wsRef.current.send(JSON.stringify({
      type: "liveChat",
      data: {
        senderName: chatNameInput.trim() || s.viewerFallback,
        message: chatMsgInput.trim(),
      },
    }));
    setChatMsgInput("");
    toast({ title: s.toastChatPushed });
  };

  const getVimeoEmbedUrl = (url: string) => {
    const trimmed = (url || "").trim();
    const idMatch = /^\d+$/.test(trimmed) ? trimmed : trimmed.match(/vimeo\.com\/(?:video\/)?(\d+)/)?.[1];
    return idMatch ? `https://player.vimeo.com/video/${idMatch}` : trimmed;
  };

  const getSessionMessages = () => {
    if (!selectedSession) return [];
    const session = viewerSessions.get(selectedSession);
    return session?.messages || [];
  };

  const getSessionNickname = (sid: string) =>
    viewerSessions.get(sid)?.nickname || onlineSessions.get(sid) || s.viewerFallback;

  const formatTime = (date: Date | string | null) => {
    if (!date) return "";
    const d = new Date(date);
    return d.toLocaleTimeString(lang, { hour: "2-digit", minute: "2-digit" });
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (!webinar) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p>{s.notFound}</p>
      </div>
    );
  }

  const allSessionIds = Array.from(
    new Set<string>([...Array.from(viewerSessions.keys()), ...Array.from(onlineSessions.keys())])
  );
  const viewerRows = allSessionIds.map((sid) => {
    const chat = viewerSessions.get(sid);
    return {
      sessionId: sid,
      nickname: chat?.nickname || onlineSessions.get(sid) || s.viewerFallback,
      messageCount: chat?.messages.length || 0,
      lastActivity: chat?.lastActivity ?? null as Date | null,
      online: onlineSessions.has(sid),
    };
  });
  const sortByActivity = (a: typeof viewerRows[number], b: typeof viewerRows[number]) =>
    (b.lastActivity ? new Date(b.lastActivity).getTime() : 0) -
    (a.lastActivity ? new Date(a.lastActivity).getTime() : 0);
  const audienceNeedle = audienceQuery.trim().toLowerCase();
  const matchesAudience = (r: typeof viewerRows[number]) => !audienceNeedle || r.nickname.toLowerCase().includes(audienceNeedle);
  const onlineRows = viewerRows.filter((r) => r.online && matchesAudience(r)).sort(sortByActivity);
  const offlineRows = viewerRows.filter((r) => !r.online && matchesAudience(r)).sort(sortByActivity);
  const totalViewers = viewerRows.length;

  return (
    <div className="admin-shell admin-control">
      <header className="control-header border-b bg-card/95 backdrop-blur sticky top-0 z-20">
        <div className="container mx-auto px-4 py-3 flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => setLocation(`/admin/webinar/${id}`)} data-testid="button-back">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="control-header-title flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-bold">{webinar.title}</h1>
              <Badge variant={isConnected ? "default" : "secondary"}>
                {isConnected ? s.connected : s.connecting}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground">{s.headerSubtitle}</p>
          </div>
          <div className="control-header-actions flex items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setLang(lang === "zh-TW" ? "zh-CN" : "zh-TW")}
              data-testid="button-control-lang-toggle"
            >
              <Languages className="h-4 w-4 mr-1" />
              {lang === "zh-TW" ? "繁" : "简"}
            </Button>
          </div>
        </div>
      </header>

      <main className="control-main container mx-auto px-4 py-6">
        <section className="control-intro">
          <p className="control-eyebrow"><Radio className="h-3.5 w-3.5" /> {s.liveStatus}</p>
          <div className="control-stats" aria-label={s.liveStatus}>
            <div className="control-stat control-stat-live"><span><Users className="h-4 w-4" />{s.onlineCount}</span><strong>{viewerCount}</strong></div>
            <div className="control-stat"><span><MessageCircle className="h-4 w-4" />{s.interactiveViewers}</span><strong>{viewerSessions.size}</strong></div>
            <div className="control-stat"><span><Heart className="h-4 w-4" />{s.likeCount}</span><strong>{likeCount}</strong></div>
            <div className="control-stat"><span><MessageSquare className="h-4 w-4" />{s.messageTotal}</span><strong>{allMessages.length}</strong></div>
          </div>
        </section>

        <div className="control-grid">
          <Card className="control-audience-card">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Users className="h-4 w-4" />
                {s.viewerList} ({totalViewers})
              </CardTitle>
              <p className="text-xs text-muted-foreground">{s.audienceHint}</p>
            </CardHeader>
            <CardContent>
              {totalViewers > 6 && (
                <div className="control-audience-search">
                  <Search className="h-3.5 w-3.5" aria-hidden />
                  <Input
                    value={audienceQuery}
                    onChange={(e) => setAudienceQuery(e.target.value)}
                    placeholder={s.searchViewers}
                    aria-label={s.searchViewers}
                    data-testid="input-search-viewers"
                  />
                </div>
              )}
              <ScrollArea className="control-audience-scroll">
                <div className="space-y-1">
                  <Button
                    variant={selectedSession === null ? "secondary" : "ghost"}
                    className="w-full justify-start"
                    onClick={() => setSelectedSession(null)}
                    data-testid="button-view-all"
                  >
                    <MessageSquare className="h-4 w-4 mr-2" />
                    {s.allMessages} ({allMessages.length})
                  </Button>
                  
                  {totalViewers === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-4">
                      {s.noViewers}
                    </p>
                  ) : (
                    <>
                      {onlineRows.length > 0 && (
                        <div className="flex items-center gap-1.5 px-1 pt-2 text-xs font-medium text-green-600 dark:text-green-500">
                          <span className="h-2 w-2 rounded-full bg-green-500" />
                          {s.onlineGroup} ({onlineRows.length})
                        </div>
                      )}
                      {onlineRows.map((row) => (
                        <Button
                          key={row.sessionId}
                          variant={selectedSession === row.sessionId ? "secondary" : "ghost"}
                          className="w-full justify-start"
                          onClick={() => setSelectedSession(row.sessionId)}
                          data-testid={`button-session-${row.sessionId}`}
                        >
                          <div className="flex items-center gap-2 w-full">
                            <span className="h-2 w-2 rounded-full bg-green-500 flex-shrink-0" />
                            <div className="flex-1 text-left min-w-0">
                              <div className="font-medium truncate">{row.nickname}</div>
                              <div className="text-xs text-muted-foreground flex items-center gap-1">
                                <MessageCircle className="h-3 w-3" />
                                {row.messageCount} {s.messageCount}
                              </div>
                            </div>
                            {row.lastActivity && (
                              <div className="text-xs text-muted-foreground flex items-center gap-1">
                                <Clock className="h-3 w-3" />
                                {formatTime(row.lastActivity)}
                              </div>
                            )}
                          </div>
                        </Button>
                      ))}

                      {offlineRows.length > 0 && (
                        <div className="flex items-center gap-1.5 px-1 pt-3 text-xs font-medium text-muted-foreground">
                          <span className="h-2 w-2 rounded-full bg-muted-foreground/40" />
                          {s.offlineGroup} ({offlineRows.length})
                        </div>
                      )}
                      {offlineRows.map((row) => (
                        <Button
                          key={row.sessionId}
                          variant={selectedSession === row.sessionId ? "secondary" : "ghost"}
                          className="w-full justify-start opacity-70"
                          onClick={() => setSelectedSession(row.sessionId)}
                          data-testid={`button-session-${row.sessionId}`}
                        >
                          <div className="flex items-center gap-2 w-full">
                            <User className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                            <div className="flex-1 text-left min-w-0">
                              <div className="font-medium truncate">{row.nickname}</div>
                              <div className="text-xs text-muted-foreground flex items-center gap-1">
                                <MessageCircle className="h-3 w-3" />
                                {row.messageCount} {s.messageCount}
                              </div>
                            </div>
                            {row.lastActivity && (
                              <div className="text-xs text-muted-foreground flex items-center gap-1">
                                <Clock className="h-3 w-3" />
                                {formatTime(row.lastActivity)}
                              </div>
                            )}
                          </div>
                        </Button>
                      ))}
                    </>
                  )}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>

          <Card className="control-chat-card">
            <CardHeader className="pb-3">
              <div className="control-card-heading">
                <div>
              <CardTitle className="text-base flex items-center gap-2">
                <MessageSquare className="h-4 w-4" />
                {selectedSession 
                  ? `${getSessionNickname(selectedSession)} ${s.conversation}`
                  : s.allChat
                }
              </CardTitle>
                  <p className="text-xs text-muted-foreground mt-1">{s.chatHint}</p>
                </div>
              </div>
            </CardHeader>
            <CardContent className="control-chat-content">
              <div className="control-chat-wrap">
              <div
                ref={chatScrollRef}
                className="control-chat-scroll pr-2"
                onScroll={(e) => {
                  const box = e.currentTarget;
                  const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 48;
                  stickToBottom.current = atBottom;
                  if (atBottom) setUnseenCount(0);
                }}
                data-testid="control-chat-scroll"
              >
                <div className="space-y-0.5">
                  {(selectedSession ? getSessionMessages() : allMessages).length === 0 && (
                    <div className="control-empty-chat"><MessageSquare className="h-7 w-7" /><p>{s.emptyMessages}</p></div>
                  )}
                  {(selectedSession ? getSessionMessages() : allMessages).map((msg, index) => {
                    const chatMsg = msg as ChatMessage & { sessionId?: string };
                    const kind = msg.senderType === "host" ? "host" : msg.senderType === "scheduled" ? "dummy" : "viewer";
                    const canReply = kind === "viewer" && !!chatMsg.sessionId && !selectedSession;
                    return (
                      <div
                        key={msg.id || index}
                        className={`control-msg control-msg-${kind}`}
                        data-testid={`control-message-${index}`}
                      >
                        <span className={`control-msg-avatar ${kind === "viewer" ? viewerTone(msg.senderName) : ""}`} aria-hidden>
                          {msg.senderName?.trim().charAt(0).toUpperCase() || "?"}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="control-msg-head">
                            <span className="control-msg-name">{msg.senderName}</span>
                            {kind === "host" && <span className="control-tag control-tag-host">{s.badgeHost}</span>}
                            {kind === "dummy" && <span className="control-tag">{s.badgeDummy}</span>}
                            {msg.isPrivate && <span className="control-tag control-tag-private">{s.badgePrivate}</span>}
                            <time className="control-msg-time">{formatTime(msg.sentAt)}</time>
                          </div>
                          <p className="control-msg-text">{msg.message}</p>
                        </div>
                        {canReply && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="control-msg-reply"
                            onClick={() => setSelectedSession(chatMsg.sessionId!)}
                            data-testid={`button-reply-${index}`}
                          >
                            <MessageCircle className="h-3.5 w-3.5" />
                            {s.viewConversation}
                          </Button>
                        )}
                      </div>
                    );
                  })}
                  <div ref={chatEndRef} />
                </div>
              </div>
              {unseenCount > 0 && (
                <button type="button" className="control-new-messages" onClick={() => scrollChatToBottom()} data-testid="button-new-messages">
                  <ArrowDown className="h-3.5 w-3.5" />
                  {unseenCount} {s.newMessages}
                </button>
              )}
              </div>

              <div className="control-composer space-y-2 border-t pt-3">
                <div className="control-compose-meta">
                  {selectedSession ? (
                    <span className="control-target control-target-private">
                      <MessageCircle className="h-3.5 w-3.5 flex-none" />
                      <span className="truncate">{s.privateMode} {getSessionNickname(selectedSession)}</span>
                      <button
                        type="button"
                        onClick={() => setSelectedSession(null)}
                        aria-label={s.backToBroadcast}
                        title={s.backToBroadcast}
                        data-testid="button-clear-reply-target"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </span>
                  ) : (
                    <span className="control-target">
                      <Radio className="h-3.5 w-3.5 flex-none" />
                      <span className="truncate">{s.broadcastMode}</span>
                    </span>
                  )}
                  <Input
                    placeholder={s.displayName}
                    aria-label={s.speakAs}
                    title={s.speakAs}
                    value={hostName}
                    onChange={(e) => { setHostName(e.target.value); setHostNameEdited(true); }}
                    className="control-host-name"
                    data-testid="input-host-name"
                  />
                </div>

                <div className="flex gap-2">
                  <Input
                    ref={messageInputRef}
                    placeholder={selectedSession ? s.replyPlaceholder : s.broadcastPlaceholder}
                    value={messageInput}
                    onChange={(e) => setMessageInput(e.target.value)}
                    disabled={!!selectedSession && !onlineSessions.has(selectedSession)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape" && selectedSession) setSelectedSession(null);
                      // Enter that picks a Chinese IME candidate must not send.
                      if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                        e.preventDefault();
                        selectedSession ? sendReplyToSession() : sendBroadcastMessage();
                      }
                    }}
                    data-testid="input-host-message"
                  />
                  <Button
                    onClick={selectedSession ? sendReplyToSession : sendBroadcastMessage}
                    className="control-send-button"
                    disabled={!messageInput.trim() || (!!selectedSession && !onlineSessions.has(selectedSession))}
                    data-testid="button-send-host-message"
                  >
                    <Send className="h-4 w-4" />
                    <span>{selectedSession ? s.sendReply : s.sendBroadcast}</span>
                  </Button>
                </div>

                {selectedSession && (
                  onlineSessions.has(selectedSession) ? (
                    <p className="text-xs text-muted-foreground">
                      {s.replyHintPrefix}{getSessionNickname(selectedSession)}{s.replyHintSuffix}
                    </p>
                  ) : (
                    <p className="text-xs text-amber-600 dark:text-amber-500">
                      {s.offlineHint}
                    </p>
                  )
                )}
              </div>
            </CardContent>
          </Card>

          <Card className="control-actions-card">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Radio className="h-4 w-4" />
                {s.controlPanel}
              </CardTitle>
              <p className="text-xs text-muted-foreground">{s.actionsHint}</p>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="control-studio border rounded-lg p-3 bg-muted/30">
                  <h4 className="font-medium mb-1">{s.studio}</h4>
                  <p className="text-xs text-muted-foreground mb-3">{s.studioHint}</p>

                  {webinar.vimeoUrl && (
                    <div className="mb-3">
                      <p className="text-xs text-muted-foreground mb-1">{s.videoPreview}</p>
                      <div className="relative w-full rounded overflow-hidden" style={{ paddingBottom: "56.25%" }}>
                        <iframe
                          src={getVimeoEmbedUrl(webinar.vimeoUrl)}
                          className="absolute inset-0 w-full h-full"
                          allow="autoplay; fullscreen; picture-in-picture"
                          allowFullScreen
                          data-testid="iframe-studio-preview"
                        />
                      </div>
                    </div>
                  )}

                  <Tabs defaultValue="cta" className="control-action-tabs">
                    <TabsList className="grid w-full grid-cols-4">
                      <TabsTrigger value="cta">CTA</TabsTrigger>
                      <TabsTrigger value="tip">{s.quickTip}</TabsTrigger>
                      <TabsTrigger value="chat">{s.quickChat}</TabsTrigger>
                      <TabsTrigger value="poll" data-testid="tab-studio-poll">{s.tabPoll}</TabsTrigger>
                    </TabsList>
                  <TabsContent value="cta" className="space-y-2 mt-3">
                    <p className="text-sm font-medium">{s.quickCta}</p>
                    <Input
                      placeholder={s.ctaText}
                      aria-label={s.ctaText}
                      value={ctaTextInput}
                      onChange={(e) => setCtaTextInput(e.target.value)}
                      data-testid="input-studio-cta-text"
                    />
                    <select className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={ctaTargetType} onChange={e => { setCtaTargetType(e.target.value as "external" | "page" | "offer"); setCtaTargetId(""); }}>
                      <option value="external">外部網址</option><option value="page">站內商品頁</option><option value="offer">直接購買</option>
                    </select>
                    {ctaTargetType === "external" ? <Input
                      placeholder={s.ctaUrl}
                      aria-label={s.ctaUrl}
                      value={ctaUrlInput}
                      onChange={(e) => setCtaUrlInput(e.target.value)}
                      data-testid="input-studio-cta-url"
                    /> : <select className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={ctaTargetId} onChange={e => setCtaTargetId(e.target.value)}>
                      <option value="">請選擇目標</option>
                      {ctaTargetType === "page" ? productPages?.filter(page => page.status === "published").map(page => <option key={page.id} value={page.id}>{page.title}</option>) : products?.filter(product => product.active).map(product => <option key={product.id} value={product.id}>{product.name}</option>)}
                    </select>}
                    <div className="flex gap-2">
                      <select
                        className="flex-1 h-9 rounded-md border bg-background px-2 text-sm"
                        value={ctaStyleInput}
                        onChange={(e) => setCtaStyleInput(e.target.value)}
                        data-testid="select-studio-cta-style"
                      >
                        <option value="primary">{s.stylePrimary}</option>
                        <option value="secondary">{s.styleSecondary}</option>
                        <option value="danger">{s.styleDanger}</option>
                      </select>
                      <Input
                        type="number"
                        className="w-28"
                        placeholder={s.durationSec}
                        value={ctaDurInput}
                        onChange={(e) => setCtaDurInput(e.target.value)}
                        data-testid="input-studio-cta-dur"
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">外部網址請填完整 https:// 網址，不能使用 #。即時推送只對目前已進場連線的觀眾生效。</p>
                    <Button size="sm" className="w-full" disabled={!isConnected || ctaPending} onClick={pushLiveCta} data-testid="button-studio-push-cta">
                      <Send className="h-4 w-4 mr-1" />
                      {ctaPending ? "等待推送確認…" : s.pushNow}
                    </Button>
                  </TabsContent>

                  <TabsContent value="tip" className="space-y-2 mt-3">
                    <p className="text-sm font-medium">{s.quickTip}</p>
                    <Input
                      placeholder={s.tipTitle}
                      value={tipTitleInput}
                      onChange={(e) => setTipTitleInput(e.target.value)}
                      data-testid="input-studio-tip-title"
                    />
                    <Input
                      placeholder={s.tipContent}
                      value={tipContentInput}
                      onChange={(e) => setTipContentInput(e.target.value)}
                      data-testid="input-studio-tip-content"
                    />
                    <Input
                      type="number"
                      placeholder={s.durationSec}
                      value={tipDurInput}
                      onChange={(e) => setTipDurInput(e.target.value)}
                      data-testid="input-studio-tip-dur"
                    />
                    <Button size="sm" className="w-full" onClick={pushLiveTip} data-testid="button-studio-push-tip">
                      <Send className="h-4 w-4 mr-1" />
                      {s.pushNow}
                    </Button>
                  </TabsContent>

                  <TabsContent value="chat" className="space-y-2 mt-3">
                    <p className="text-sm font-medium">{s.quickChat}</p>
                    <div className="flex gap-2">
                      <Input
                        placeholder={s.chatName}
                        value={chatNameInput}
                        onChange={(e) => setChatNameInput(e.target.value)}
                        data-testid="input-studio-chat-name"
                      />
                      {fakeUsers && fakeUsers.length > 0 && (
                        <select
                          className="w-28 h-9 rounded-md border bg-background px-2 text-sm"
                          value=""
                          onChange={(e) => e.target.value && setChatNameInput(e.target.value)}
                          data-testid="select-studio-fake-user"
                        >
                          <option value="">{s.pickFakeUser}</option>
                          {fakeUsers.map((fu) => (
                            <option key={fu.id} value={fu.name}>{fu.name}</option>
                          ))}
                        </select>
                      )}
                    </div>
                    <Input
                      placeholder={s.chatMessage}
                      value={chatMsgInput}
                      onChange={(e) => setChatMsgInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) pushLiveChat(); }}
                      data-testid="input-studio-chat-message"
                    />
                    <Button size="sm" className="w-full" onClick={pushLiveChat} data-testid="button-studio-push-chat">
                      <MessageCircle className="h-4 w-4 mr-1" />
                      {s.sendChat}
                    </Button>
                  </TabsContent>
                  <TabsContent value="poll" className="space-y-2 mt-3">
                    <p className="text-sm font-medium">{s.quickPoll}</p>
                  {polls && polls.length > 0 ? (
                    <div className="space-y-2">
                      {polls.map((poll) => (
                        <div key={poll.id} className="p-3 bg-muted rounded-md">
                          <p className="text-sm font-medium mb-2">{poll.question}</p>
                          <div className="flex flex-wrap gap-1 mb-2">
                            {(poll.options as string[]).map((opt, i) => (
                              <Badge key={i} variant="secondary" className="text-xs">{opt}</Badge>
                            ))}
                          </div>
                          <Button
                            size="sm"
                            className="w-full"
                            onClick={() => triggerPoll(poll)}
                            data-testid={`button-trigger-poll-${poll.id}`}
                          >
                            <BarChart className="h-4 w-4 mr-1" />
                            {selectedSession ? s.sendToViewer : s.sendToAll}
                          </Button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">{s.noPollSettings}</p>
                  )}
                  </TabsContent>
                  </Tabs>
                </div>


              </div>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}
