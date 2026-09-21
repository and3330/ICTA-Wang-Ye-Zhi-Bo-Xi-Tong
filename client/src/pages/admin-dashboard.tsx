import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, clearAuthScopedQueryCache, queryClient } from "@/lib/queryClient";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useAdminLang, type LangAdmin } from "@/hooks/use-lang";
import { SellCaseLogo } from "@/components/sellcase-logo";
import { AdminDashboardNavigation } from "@/components/admin-dashboard-navigation";
import { 
  Plus, Video, Calendar, Crown,
  ExternalLink, Loader2, Radio, Copy,
  BarChart3, Users, Pencil, Share2, MessageCircle,
  Eye, Code, Trash2, MoreVertical, Sparkles, ImagePlus, Upload, X, ShoppingBag, FolderOpen, CircleAlert
} from "lucide-react";
import type { EffectiveMemberPlanDto, MemberManualPlanDto } from "@shared/memberManualPlans";
import type { Webinar } from "@shared/schema";
import type { SessionRegistrationCountsDto } from "@shared/sessionRegistrationCounts";
import { NO_CARD_TRIAL_AI_CALL_LIMIT, NO_CARD_TRIAL_DAYS, NO_CARD_TRIAL_MILESTONES, type NoCardTrialState } from "@shared/noCardTrial";
import { MediaPicker, VideoSourcePicker } from "@/components/media-picker";
import { PricingAmount, RegionalPricingNote } from "@/components/regional-pricing";
import { DEFAULT_PRICING_REGION, usePricingRegion } from "@/hooks/use-pricing-region";
import { useMarketingConsent } from "@/components/marketing-consent";
import { flushPlatformConversions, trackPlatformConversion, type PlatformConversion } from "@/lib/platform-conversions";
import { readMarketingConsent } from "@/lib/marketing-consent";

type WebinarStats = Record<string, {
  registered: number;
  attended: number;
  engaged: number;
  onlineCount: number;
  sessionRegistrationCounts?: SessionRegistrationCountsDto | null;
}>;

type NoCardTrialClientStatus = {
  eligibility: NoCardTrialState;
  state: NoCardTrialState;
  startsAt: string | null;
  expiresAt: string | null;
  retentionUntil: string | null;
  remainingAI: number;
  usedAI: number;
  milestones: Array<{ day: number; reached: boolean }>;
};

const t: Record<LangAdmin, {
  validationTitle: string;
  validationVimeoUrl: string;
  validationStartTime: string;
  toastCreateSuccess: string;
  toastCreateSuccessDesc: string;
  toastCreateFail: string;
  toastDuplicateSuccess: string;
  toastDuplicateSuccessDesc: string;
  toastDuplicateFail: string;
  toastDeleteSuccess: string;
  toastDeleteSuccessDesc: string;
  toastDeleteFail: string;
  toastLinkCopied: string;
  toastLinkCopiedDesc: string;
  statusLive: string;
  statusEnded: string;
  statusUpcoming: string;
  logout: string;
  management: string;
  managementDesc: string;
  createWebinar: string;
  createNewWebinar: string;
  createNewWebinarDesc: string;
  labelTitle: string;
  placeholderTitle: string;
  labelDescription: string;
  placeholderDescription: string;
  labelVimeoUrl: string;
  labelStartTime: string;
  labelCoverImage: string;
  cancel: string;
  creating: string;
  create: string;
  statRegistered: string;
  statAttended: string;
  statEngagement: string;
  statOnline: string;
  onlineCount: (n: number) => string;
  actionEdit: string;
  actionControl: string;
  actionShare: string;
  actionMore: string;
  actionPreview: string;
  actionDuplicate: string;
  actionDelete: string;
  deleteConfirmTitle: string;
  deleteConfirmDesc: (title: string) => string;
  deleteCancel: string;
  deleteConfirm: string;
  emptyTitle: string;
  emptyDesc: string;
  subPlanLabel: string;
  subPlanFree: string;
  subPlanMonthly: string;
  subPlanEnterprise: string;
  subWebinarUsage: string;
  subExpires: string;
  subNoExpiry: string;
  subExpired: string;
  subContactUs: string;
  subOf: string;
  subRooms: string;
  superAdminPanel: string;
  subUpgrade: string;
  subPublished: string;
  subDraft: string;
  subPublishLimit: string;
  publishBtn: string;
  unpublishBtn: string;
  upgradeTitle: string;
  upgradeDesc: string;
  upgradeBtn: string;
  manageSubscription: string;
  toastPublishSuccess: string;
  toastPublishSuccessDesc: string;
  toastUnpublishSuccess: string;
  toastUnpublishSuccessDesc: string;
  toastUpgradeNeeded: string;
  toastUpgradeNeededDesc: string;
  publishLimitReached: string;
  publishLimitReachedDesc: string;
  aiPointsTitle: string;
  aiPointsBalance: string;
  aiPointsUnit: string;
  aiPointsUnlimited: string;
  aiPointsHint: string;
  aiPointsRecharge: string;
  rechargeTitle: string;
  rechargeDesc: string;
  rechargeCustom: string;
  rechargeCustomPlaceholder: string;
  rechargeCustomBtn: string;
  rechargePoints: string;
  rechargeSuccess: string;
  rechargeSuccessDesc: string;
  rechargeFail: string;
}> = {
  "zh-TW": {
    validationTitle: "請輸入標題",
    validationVimeoUrl: "請輸入有效的 Vimeo 網址",
    validationStartTime: "請選擇開始時間",
    toastCreateSuccess: "建立成功",
    toastCreateSuccessDesc: "直播間已建立",
    toastCreateFail: "建立失敗",
    toastDuplicateSuccess: "複製成功",
    toastDuplicateSuccessDesc: "直播間已複製",
    toastDuplicateFail: "複製失敗",
    toastDeleteSuccess: "已刪除",
    toastDeleteSuccessDesc: "直播間已成功刪除",
    toastDeleteFail: "刪除失敗",
    toastLinkCopied: "已複製連結",
    toastLinkCopiedDesc: "報名頁連結已複製到剪貼簿",
    statusLive: "直播中",
    statusEnded: "已結束",
    statusUpcoming: "即將開始",
    logout: "登出",
    management: "直播間管理",
    managementDesc: "建立和管理您的線上研討會",
    createWebinar: "建立直播間",
    createNewWebinar: "建立新直播間",
    createNewWebinarDesc: "設定直播間基本資訊",
    labelTitle: "直播標題",
    placeholderTitle: "輸入直播標題",
    labelDescription: "描述（選填）",
    placeholderDescription: "直播簡介",
    labelVimeoUrl: "Vimeo 影片網址",
    labelStartTime: "開始時間",
    labelCoverImage: "封面圖片網址（選填）",
    cancel: "取消",
    creating: "建立中...",
    create: "建立",
    statRegistered: "報名數",
    statAttended: "出席數",
    statEngagement: "互動率",
    statOnline: "在線觀眾",
    onlineCount: (n: number) => `${n} 人在線`,
    actionEdit: "編輯管理",
    actionControl: "控制台",
    actionShare: "分享連結",
    actionMore: "更多",
    actionPreview: "報名頁預覽",
    actionDuplicate: "複製直播間",
    actionDelete: "刪除",
    deleteConfirmTitle: "確定要刪除此直播間？",
    deleteConfirmDesc: (title: string) => `將會刪除「${title}」及其所有相關資料（報名記錄、聊天訊息、分析數據等），此操作無法復原。`,
    deleteCancel: "取消",
    deleteConfirm: "確定刪除",
    emptyTitle: "尚無直播間",
    emptyDesc: "建立您的第一個線上研討會",
    subPlanLabel: "目前方案",
    subPlanFree: "免費方案",
    subPlanMonthly: "月租方案 ($49/月)",
    subPlanEnterprise: "企業方案",
    subWebinarUsage: "直播間使用",
    subExpires: "到期日",
    subNoExpiry: "無到期日",
    subExpired: "已過期",
    subContactUs: "聯繫客服升級",
    subOf: "/",
    subRooms: "間",
    superAdminPanel: "使用者管理",
    subUpgrade: "升級方案",
    subPublished: "已發佈",
    subDraft: "草稿",
    subPublishLimit: "已發佈數量",
    publishBtn: "發佈",
    unpublishBtn: "取消發佈",
    upgradeTitle: "升級方案",
    upgradeDesc: "訂閱月租方案即可依方案額度發布 1、5 或 15 個 Webinar",
    upgradeBtn: "立即訂閱",
    manageSubscription: "管理訂閱",
    toastPublishSuccess: "已發佈",
    toastPublishSuccessDesc: "直播間已發佈，報名連結已啟用",
    toastUnpublishSuccess: "已取消發佈",
    toastUnpublishSuccessDesc: "直播間已轉為草稿狀態",
    toastUpgradeNeeded: "需要升級方案",
    toastUpgradeNeededDesc: "免費方案無法建立直播間，請先升級",
    publishLimitReached: "已達發佈上限",
    publishLimitReachedDesc: "已達目前方案的發布額度，請取消發布其他 Webinar 或升級方案",
    aiPointsTitle: "AI 回覆點數",
    aiPointsBalance: "目前餘額",
    aiPointsUnit: "點",
    aiPointsUnlimited: "無限（企業／管理員）",
    aiPointsHint: "觀眾在直播間向 AI 提問，每則回覆扣 1 點。點數用完 AI 會停止回覆並顯示提示訊息。",
    aiPointsRecharge: "充值點數",
    rechargeTitle: "充值 AI 點數",
    rechargeDesc: "選擇儲值包或自訂金額（1 元 = 1 點）",
    rechargeCustom: "自訂金額（元）",
    rechargeCustomPlaceholder: "最低 100 元",
    rechargeCustomBtn: "自訂金額付款",
    rechargePoints: "點",
    rechargeSuccess: "充值成功",
    rechargeSuccessDesc: "點數已入帳，目前餘額 {points} 點",
    rechargeFail: "充值失敗",
  },
  "zh-CN": {
    validationTitle: "请输入标题",
    validationVimeoUrl: "请输入有效的 Vimeo 网址",
    validationStartTime: "请选择开始时间",
    toastCreateSuccess: "创建成功",
    toastCreateSuccessDesc: "直播间已创建",
    toastCreateFail: "创建失败",
    toastDuplicateSuccess: "复制成功",
    toastDuplicateSuccessDesc: "直播间已复制",
    toastDuplicateFail: "复制失败",
    toastDeleteSuccess: "已删除",
    toastDeleteSuccessDesc: "直播间已成功删除",
    toastDeleteFail: "删除失败",
    toastLinkCopied: "已复制链接",
    toastLinkCopiedDesc: "报名页链接已复制到剪贴板",
    statusLive: "直播中",
    statusEnded: "已结束",
    statusUpcoming: "即将开始",
    logout: "登出",
    management: "直播间管理",
    managementDesc: "创建和管理您的线上研讨会",
    createWebinar: "创建直播间",
    createNewWebinar: "创建新直播间",
    createNewWebinarDesc: "设定直播间基本信息",
    labelTitle: "直播标题",
    placeholderTitle: "输入直播标题",
    labelDescription: "描述（选填）",
    placeholderDescription: "直播简介",
    labelVimeoUrl: "Vimeo 视频网址",
    labelStartTime: "开始时间",
    labelCoverImage: "封面图片网址（选填）",
    cancel: "取消",
    creating: "创建中...",
    create: "创建",
    statRegistered: "报名数",
    statAttended: "出席数",
    statEngagement: "互动率",
    statOnline: "在线观众",
    onlineCount: (n: number) => `${n} 人在线`,
    actionEdit: "编辑管理",
    actionControl: "控制台",
    actionShare: "分享链接",
    actionMore: "更多",
    actionPreview: "报名页预览",
    actionDuplicate: "复制直播间",
    actionDelete: "删除",
    deleteConfirmTitle: "确定要删除此直播间？",
    deleteConfirmDesc: (title: string) => `将会删除「${title}」及其所有相关资料（报名记录、聊天消息、分析数据等），此操作无法恢复。`,
    deleteCancel: "取消",
    deleteConfirm: "确定删除",
    emptyTitle: "尚无直播间",
    emptyDesc: "创建您的第一个线上研讨会",
    subPlanLabel: "当前方案",
    subPlanFree: "免费方案",
    subPlanMonthly: "月租方案 ($49/月)",
    subPlanEnterprise: "企业方案",
    subWebinarUsage: "直播间使用",
    subExpires: "到期日",
    subNoExpiry: "无到期日",
    subExpired: "已过期",
    subContactUs: "联系客服升级",
    subOf: "/",
    subRooms: "间",
    superAdminPanel: "用户管理",
    subUpgrade: "升级方案",
    subPublished: "已发布",
    subDraft: "草稿",
    subPublishLimit: "已发布数量",
    publishBtn: "发布",
    unpublishBtn: "取消发布",
    upgradeTitle: "升级方案",
    upgradeDesc: "订阅月租方案即可按方案额度发布 1、5 或 15 个 Webinar",
    upgradeBtn: "立即订阅",
    manageSubscription: "管理订阅",
    toastPublishSuccess: "已发布",
    toastPublishSuccessDesc: "直播间已发布，报名链接已启用",
    toastUnpublishSuccess: "已取消发布",
    toastUnpublishSuccessDesc: "直播间已转为草稿状态",
    toastUpgradeNeeded: "需要升级方案",
    toastUpgradeNeededDesc: "免费方案无法创建直播间，请先升级",
    publishLimitReached: "已达发布上限",
    publishLimitReachedDesc: "已达当前方案的发布额度，请取消发布其他 Webinar 或升级方案",
    aiPointsTitle: "AI 回复点数",
    aiPointsBalance: "当前余额",
    aiPointsUnit: "点",
    aiPointsUnlimited: "无限（企业／管理员）",
    aiPointsHint: "观众在直播间向 AI 提问，每条回复扣 1 点。点数用完 AI 会停止回复并显示提示信息。",
    aiPointsRecharge: "充值点数",
    rechargeTitle: "充值 AI 点数",
    rechargeDesc: "选择储值包或自定义金额（1 元 = 1 点）",
    rechargeCustom: "自定义金额（元）",
    rechargeCustomPlaceholder: "最低 100 元",
    rechargeCustomBtn: "自定义金额付款",
    rechargePoints: "点",
    rechargeSuccess: "充值成功",
    rechargeSuccessDesc: "点数已入账，当前余额 {points} 点",
    rechargeFail: "充值失败",
  },
};

type WebinarForm = z.infer<ReturnType<typeof createWebinarSchema>>;

function createWebinarSchema(s: typeof t["zh-TW"]) {
  return z.object({
    title: z.string().min(1, s.validationTitle),
    description: z.string().optional(),
    vimeoUrl: z.union([z.string().url(s.validationVimeoUrl), z.literal("")]),
    videoProvider: z.enum(["vimeo", "bunny"]).default("vimeo"),
    videoAssetId: z.string().uuid().optional(),
    startTime: z.string().min(1, s.validationStartTime),
    coverImage: z.string().optional(),
  });
}

function TrialCountdown({ expiresAt }: { expiresAt: string | null }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!expiresAt) return;
    const interval = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(interval);
  }, [expiresAt]);
  const remaining = expiresAt ? Math.max(0, new Date(expiresAt).getTime() - now) : 0;
  useEffect(() => {
    if (expiresAt && remaining === 0) void queryClient.invalidateQueries({ queryKey: ["/api/trial"] });
  }, [expiresAt, remaining]);
  if (!expiresAt) return <p className="mt-1 font-semibold tabular-nums" data-testid="text-trial-countdown">—</p>;
  const days = Math.floor(remaining / 86400000);
  const hours = Math.floor((remaining % 86400000) / 3600000);
  const minutes = Math.floor((remaining % 3600000) / 60000);
  return <p className="mt-1 font-semibold tabular-nums" data-testid="text-trial-countdown">{days} 天 {String(hours).padStart(2, "0")}:{String(minutes).padStart(2, "0")}</p>;
}

export default function AdminDashboard() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isAiWizardOpen, setIsAiWizardOpen] = useState(false);
  const [isProductPagePromptOpen, setIsProductPagePromptOpen] = useState(false);
  const [createdWizardWebinar, setCreatedWizardWebinar] = useState<Webinar | null>(null);
  const [isUploadingCreateCover, setIsUploadingCreateCover] = useState(false);
  const createCoverFileRef = useRef<HTMLInputElement>(null);
  const [isUploadingWizardBanner, setIsUploadingWizardBanner] = useState(false);
  const [imagePickerTarget, setImagePickerTarget] = useState<"create" | "wizard" | null>(null);
  const wizardBannerFileRef = useRef<HTMLInputElement>(null);
  const [aiWizardStep, setAiWizardStep] = useState(1);
  const [aiWizard, setAiWizard] = useState({
    title: "",
    audience: "",
    goal: "",
    ctaText: "",
    coverImage: "",
    sourceContent: "",
    vimeoUrl: "",
    videoProvider: "vimeo" as "vimeo" | "bunny",
    videoAssetId: undefined as string | undefined,
    startTime: "",
    videoDurationMinutes: "",
  });
  const [isUpgradeOpen, setIsUpgradeOpen] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<"starter" | "growth" | "scale">("starter");
  const [billingInterval, setBillingInterval] = useState<"month" | "year">("month");
  const [addonWebinars, setAddonWebinars] = useState(0);
  const [isRechargeOpen, setIsRechargeOpen] = useState(false);
  const [customAmount, setCustomAmount] = useState("");
  const [isSupportOpen, setIsSupportOpen] = useState(false);
  const [isTrialInfoOpen, setIsTrialInfoOpen] = useState(false);
  const trialTriggerRef = useRef<HTMLButtonElement>(null);
  const trialCloseRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (isTrialInfoOpen) {
      requestAnimationFrame(() => trialCloseRef.current?.focus());
    }
  }, [isTrialInfoOpen]);
  useEffect(() => {
    if (!isTrialInfoOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setIsTrialInfoOpen(false);
        requestAnimationFrame(() => trialTriggerRef.current?.focus());
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isTrialInfoOpen]);
  const [supportCategory, setSupportCategory] = useState<"feedback" | "question" | "bug">("feedback");
  const [supportSubject, setSupportSubject] = useState("");
  const [supportMessage, setSupportMessage] = useState("");
  const [isEcpayOpen, setIsEcpayOpen] = useState(false);
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("ecpay") === "1") {
      setIsEcpayOpen(true);
      window.history.replaceState({}, "", "/admin/dashboard");
    }
  }, []);
  const [ecpayForm, setEcpayForm] = useState({ merchantId: "", hashKey: "", hashIv: "", environment: "stage" as "stage" | "production", enabled: false });
  const { lang, setLang } = useAdminLang();
  const s = t[lang];
  const marketingConsent = useMarketingConsent();
  const { data: pricingRegion } = usePricingRegion();
  const regionalPricing = pricingRegion ?? DEFAULT_PRICING_REGION;

  const webinarSchema = createWebinarSchema(s);

  const { data: webinars, isLoading } = useQuery<Webinar[]>({
    queryKey: ["/api/webinars"],
  });
  const {
    data: adminMe,
    isFetchedAfterMount: adminMeFetchedAfterMount,
  } = useQuery<{ id: string }>({
    queryKey: ["/api/admin/me"],
  });

  useEffect(() => {
    if (adminMeFetchedAfterMount && adminMe?.id) {
      flushPlatformConversions(adminMe.id, marketingConsent);
    }
  }, [adminMe?.id, adminMeFetchedAfterMount, marketingConsent]);

  const { data: stats } = useQuery<WebinarStats>({
    queryKey: ["/api/webinars", "stats", "summary"],
    refetchInterval: 15000,
  });

  const { data: subscription } = useQuery<{
    plan: string;
    amountUsd: number | null;
    status: string;
    active: boolean;
    planStartedAt: string | null;
    planExpiresAt: string | null;
    cancelAtPeriodEnd: boolean;
    addonWebinars: number;
    maxWebinars: number;
    webinarCount: number;
    publishedCount: number;
    isActive: boolean;
    isExpired: boolean;
    isSuperAdmin: boolean;
    canManage?: boolean;
    managementRole?: string;
    hasStripeCustomer: boolean;
    effectivePlan?: EffectiveMemberPlanDto;
    manualPlan?: MemberManualPlanDto | null;
    publishingOverride?: {
      id: string;
      publishingSlots: number;
      startsAt: string;
      expiresAt: string;
    } | null;
    paid?: {
      plan: string;
      status: string;
      active: boolean;
      planStartedAt: string | null;
      planExpiresAt: string | null;
      cancelAtPeriodEnd: boolean;
      amountUsd: number | null;
      stripeSubscriptionId: string | null;
    };
  }>({
    queryKey: ["/api/admin/subscription"],
  });
  const { data: noCardTrial } = useQuery<NoCardTrialClientStatus>({
    queryKey: ["/api/trial"],
  });
  const { data: trialSalesPages } = useQuery<Array<{ status: "draft" | "published" }>>({
    queryKey: ["/api/product-sales-pages"],
    enabled: noCardTrial?.state === "active",
  });
  const trialPageRemaining = (trialSalesPages || []).some((page) => page.status === "published") ? 0 : 1;
  // Older responses expose only the original, paid top-level fields. Once an
  // effective entitlement exists, do not synthesize Stripe billing from it:
  // manual or capacity-only access may be active without paid billing.
  const paidSubscription = subscription?.paid ??
    (subscription && !subscription.effectivePlan
      ? {
          plan: subscription.plan,
          status: subscription.status,
          active: subscription.active,
          planStartedAt: subscription.planStartedAt,
          planExpiresAt: subscription.planExpiresAt,
          cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
          amountUsd: subscription.amountUsd,
          stripeSubscriptionId: null,
        }
      : undefined);
  const effectiveSource = subscription?.effectivePlan?.source;
  const manualAccess = effectiveSource === "manual";
  const overrideAccess = effectiveSource === "override";
  const effectiveStartsAt = manualAccess
    ? subscription?.manualPlan?.startsAt || subscription?.planStartedAt
    : overrideAccess
      ? subscription?.publishingOverride?.startsAt || null
      : paidSubscription?.planStartedAt || subscription?.planStartedAt;
  const effectiveExpiresAt = manualAccess
    ? subscription?.manualPlan?.expiresAt || subscription?.planExpiresAt
    : overrideAccess
      ? subscription?.publishingOverride?.expiresAt || null
      : paidSubscription?.planExpiresAt || subscription?.planExpiresAt;

  const { data: stripeConfig } = useQuery<{
    publishableKey: string;
    billingAvailable: boolean;
    catalogReady: boolean;
    plans: { key: "starter" | "growth" | "scale"; amountUsd: number; annualAmountUsd: number; includedWebinars: number; monthlyRegistrants: number; monthlyAiPoints: number; trialDays: number; available: boolean; annualAvailable: boolean }[];
    addonAmountUsd: number;
    annualAddonAmountUsd: number;
  }>({
    queryKey: ["/api/stripe/config"],
    enabled: !subscription?.isSuperAdmin,
  });

  const { data: aiPoints } = useQuery<{
    points: number;
    giftedPoints: number;
    permanentPoints: number;
    nextExpiry: string | null;
    nextExpiryPoints: number;
    planMonthlyGift: number;
    unlimited: boolean;
    pointsPerReply: number;
    pointsPerTwd: number;
    minTwd: number;
    packages: { id: string; twd: number; points: number }[];
  }>({
    queryKey: ["/api/ai-points"],
  });
  const activateTrialMutation = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/trial/activate", {})).json() as Promise<NoCardTrialClientStatus>,
    onSuccess: (trial) => {
      queryClient.setQueryData(["/api/trial"], trial);
      queryClient.invalidateQueries({ queryKey: ["/api/admin/subscription"] });
      toast({ title: "免信用卡試用已啟用", description: `可發布 1 個商品頁，並使用 ${NO_CARD_TRIAL_AI_CALL_LIMIT} 次 AI。到期不扣款。` });
    },
    onError: (error: Error) => toast({ title: "無法啟用試用", description: error.message, variant: "destructive" }),
  });

  const { data: ecpayConnection } = useQuery<{
    merchantId: string; environment: "stage" | "production"; enabled: boolean;
    verified: boolean; hasCredentials: boolean; updatedAt: string;
  } | null>({ queryKey: ["/api/admin/ecpay-connection"] });

  useEffect(() => {
    if (ecpayConnection) setEcpayForm({
      merchantId: ecpayConnection.merchantId,
      hashKey: "",
      hashIv: "",
      environment: ecpayConnection.environment,
      enabled: ecpayConnection.enabled,
    });
  }, [ecpayConnection]);

  const saveEcpayMutation = useMutation({
    mutationFn: async () => {
      const body = {
        ...ecpayForm,
        hashKey: ecpayForm.hashKey || undefined,
        hashIv: ecpayForm.hashIv || undefined,
      };
      const response = await apiRequest("PUT", "/api/admin/ecpay-connection", body);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/ecpay-connection"] });
      setEcpayForm((value) => ({ ...value, hashKey: "", hashIv: "" }));
      toast({ title: "綠界設定已安全儲存", description: "憑證已加密；測試環境結帳才是實際驗證。" });
    },
    onError: (error: any) => toast({ title: "儲存失敗", description: error.message, variant: "destructive" }),
  });
  const testEcpayMutation = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/admin/ecpay-connection/test", {})).json(),
    onSuccess: (result: any) => toast({ title: "設定完整", description: result.message }),
    onError: (error: any) => toast({ title: "設定檢查失敗", description: error.message, variant: "destructive" }),
  });
  const disableEcpayMutation = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/admin/ecpay-connection/disable", {})).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/ecpay-connection"] });
      toast({ title: "綠界收款已停用" });
    },
  });

  const form = useForm<WebinarForm>({
    resolver: zodResolver(webinarSchema),
    defaultValues: {
      title: "",
      description: "",
      vimeoUrl: "",
      videoProvider: "vimeo",
      videoAssetId: undefined,
      startTime: "",
      coverImage: "",
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: WebinarForm) => {
      return apiRequest("POST", "/api/webinars", {
        ...data,
        startTime: new Date(data.startTime).toISOString(),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/webinars"] });
      setIsCreateOpen(false);
      form.reset();
      if (createCoverFileRef.current) createCoverFileRef.current.value = "";
      toast({
        title: s.toastCreateSuccess,
        description: s.toastCreateSuccessDesc,
      });
    },
    onError: (error: any) => {
      if (error.message === "FREE_PLAN" || error.message?.includes("FREE_PLAN")) {
        toast({ title: s.toastUpgradeNeeded, description: s.toastUpgradeNeededDesc, variant: "destructive" });
      } else {
        toast({
          title: s.toastCreateFail,
          description: error.message,
          variant: "destructive",
        });
      }
    },
  });

  const aiWizardMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/webinars/ai-wizard", {
        title: aiWizard.title,
        audience: aiWizard.audience,
        goal: aiWizard.goal,
        ctaText: aiWizard.ctaText,
        coverImage: aiWizard.coverImage,
        sourceContent: aiWizard.sourceContent,
        vimeoUrl: aiWizard.vimeoUrl,
        videoProvider: aiWizard.videoProvider,
        videoAssetId: aiWizard.videoAssetId,
        startTime: new Date(aiWizard.startTime).toISOString(),
        videoDuration: aiWizard.videoProvider === "vimeo" && aiWizard.videoDurationMinutes
          ? Math.round(Number(aiWizard.videoDurationMinutes) * 60)
          : undefined,
      });
      return response.json() as Promise<{
        webinar: Webinar;
        pointsUsed: number;
        counts: { messages: number; polls: number; tips: number; ctas: number; emails: number };
      }>;
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["/api/webinars"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ai-points"] });
      queryClient.invalidateQueries({ queryKey: ["/api/trial"] });
      setIsAiWizardOpen(false);
      setCreatedWizardWebinar(result.webinar);
      setIsProductPagePromptOpen(true);
      setAiWizardStep(1);
      setAiWizard({
        title: "",
        audience: "",
        goal: "",
        ctaText: "",
        coverImage: "",
        sourceContent: "",
        vimeoUrl: "",
        videoProvider: "vimeo",
        videoAssetId: undefined,
        startTime: "",
        videoDurationMinutes: "",
      });
      toast({
        title: "開賣場草稿已建立",
        description: `已產生 ${result.counts.messages} 則訊息、${result.counts.polls} 個投票、${result.counts.ctas} 個 CTA 與 ${result.counts.emails} 封 Email。`,
      });
    },
    onError: (error: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/ai-points"] });
      if (noCardTrial?.state === "active" && (String(error?.message || "").includes("402") || String(error?.message || "").includes("額度"))) {
        setIsAiWizardOpen(false);
        toast({ title: "試用 AI 次數不足", description: `這個建立精靈需要 3 次 AI 呼叫；試用剩餘 ${noCardTrial.remainingAI} 次。升級不會重設試用次數。`, variant: "destructive" });
        return;
      }
      if (String(error?.message || "").includes("402") || String(error?.message || "").includes("點數")) {
        setIsAiWizardOpen(false);
        setIsRechargeOpen(true);
        toast({ title: "AI 點數不足", description: "請先購買點數後再使用 AI 建立精靈。", variant: "destructive" });
        return;
      }
      toast({
        title: "AI 建立失敗",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const duplicateMutation = useMutation({
    mutationFn: async (webinarId: string) => {
      return apiRequest("POST", `/api/webinars/${webinarId}/duplicate`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/webinars"] });
      toast({ title: s.toastDuplicateSuccess, description: s.toastDuplicateSuccessDesc });
    },
    onError: (error: any) => {
      toast({ title: s.toastDuplicateFail, description: error.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (webinarId: string) => {
      return apiRequest("DELETE", `/api/webinars/${webinarId}`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/webinars"] });
      toast({ title: s.toastDeleteSuccess, description: s.toastDeleteSuccessDesc });
    },
    onError: (error: any) => {
      toast({ title: s.toastDeleteFail, description: error.message, variant: "destructive" });
    },
  });

  const publishMutation = useMutation({
    mutationFn: async (webinarId: string) => {
      return apiRequest("POST", `/api/webinars/${webinarId}/publish`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/webinars"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/subscription"] });
      toast({ title: s.toastPublishSuccess, description: s.toastPublishSuccessDesc });
    },
    onError: (error: any) => {
      if (error.message === "PUBLISH_LIMIT" || error.message?.includes("PUBLISH_LIMIT")) {
        toast({ title: s.publishLimitReached, description: s.publishLimitReachedDesc, variant: "destructive" });
        setIsUpgradeOpen(true);
      } else if (error.message?.includes("SUBSCRIPTION_REQUIRED")) {
        toast({ title: s.toastUpgradeNeeded, description: "發布與取得公開網址需要有效訂閱。您的草稿仍會完整保留。", variant: "destructive" });
        setIsUpgradeOpen(true);
      } else {
        toast({ title: s.toastCreateFail, description: error.message, variant: "destructive" });
      }
    },
  });

  const unpublishMutation = useMutation({
    mutationFn: async (webinarId: string) => {
      return apiRequest("POST", `/api/webinars/${webinarId}/unpublish`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/webinars"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/subscription"] });
      toast({ title: s.toastUnpublishSuccess, description: s.toastUnpublishSuccessDesc });
    },
    onError: (error: any) => {
      toast({ title: s.toastCreateFail, description: error.message, variant: "destructive" });
    },
  });

  const checkoutMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/stripe/checkout", { planKey: selectedPlan, billingInterval, addonWebinars });
      return await res.json();
    },
    onSuccess: (data: { url: string }) => {
      if (data.url) window.location.href = data.url;
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const portalMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/stripe/portal", {});
      return await res.json();
    },
    onSuccess: (data: { url: string }) => {
      if (data.url) window.location.href = data.url;
    },
  });

  const endTrialMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/stripe/end-trial", {});
      return await res.json() as { status: string; paid: boolean; paymentUrl: string | null };
    },
    onSuccess: async (data) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["/api/admin/subscription"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/ai-points"] }),
      ]);
      if (!data.paid && data.paymentUrl) {
        window.location.href = data.paymentUrl;
        return;
      }
      toast({
        title: data.paid ? "付款成功" : "付款處理中",
        description: data.paid
          ? "試用已提前結束，方案 AI 點數將自動入帳。"
          : "Stripe 正在處理付款；只有付款成功後才會發放 AI 點數。",
      });
    },
    onError: (error: any) => {
      toast({
        title: "提前付款失敗",
        description: error.message || "請確認付款方式後再試一次。",
        variant: "destructive",
      });
    },
  });

  const rechargeMutation = useMutation({
    mutationFn: async (body: { packageId?: string; amount?: number }) => {
      const res = await apiRequest("POST", "/api/stripe/recharge-checkout", body);
      return await res.json();
    },
    onSuccess: (data: { url: string }) => {
      if (data.url) window.location.href = data.url;
    },
    onError: (error: any) => {
      toast({ title: s.rechargeFail, description: error.message, variant: "destructive" });
    },
  });

  const supportMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/support", { category: supportCategory, subject: supportSubject, message: supportMessage });
      return res.json();
    },
    onSuccess: () => {
      setIsSupportOpen(false);
      setSupportCategory("feedback");
      setSupportSubject("");
      setSupportMessage("");
      toast({ title: lang === "zh-CN" ? "已发送给客服" : "已送出客服訊息", description: lang === "zh-CN" ? "我们会尽快回复您。" : "我們會盡快回覆您。" });
    },
    onError: (error: any) => toast({ title: lang === "zh-CN" ? "发送失败" : "送出失敗", description: error.message, variant: "destructive" }),
  });

  useEffect(() => {
    let active = true;
    const pendingTimers = new Set<number>();
    const schedulePendingConfirmation = (callback: () => void) => {
      const timer = window.setTimeout(() => {
        pendingTimers.delete(timer);
        if (active) callback();
      }, 2500);
      pendingTimers.add(timer);
    };
    const params = new URLSearchParams(window.location.search);
    if (params.get("checkout") === "success") {
      const sessionId = params.get("session_id");
      window.history.replaceState({}, "", "/admin/dashboard");
      queryClient.invalidateQueries({ queryKey: ["/api/admin/subscription"] });
      toast({ title: s.toastCreateSuccess, description: "付款已完成，訂閱狀態正在同步" });
      if (sessionId) {
        let attempts = 0;
        const confirmSubscription = async (): Promise<void> => {
          const response = await apiRequest("POST", "/api/stripe/confirm-platform-checkout", { sessionId });
          const result = await response.json() as {
            status?: "paid" | "pending" | "failed";
            conversion?: PlatformConversion;
          };
          if (!active) return;
          if (result.status === "paid" && result.conversion?.eventName === "Purchase") {
            trackPlatformConversion(result.conversion, readMarketingConsent());
            await queryClient.invalidateQueries({ queryKey: ["/api/admin/subscription"] });
            return;
          }
          if (result.status === "pending" && attempts < 8) {
            attempts += 1;
            schedulePendingConfirmation(() => { void confirmSubscription(); });
            return;
          }
          if (result.status === "pending") {
            toast({ title: "付款處理中", description: "Stripe 尚未回報付款成功；確認後才會計入轉換。" });
          }
        };
        void confirmSubscription().catch((error: any) => {
          // A failed/foreign session is never a conversion. Keep the existing
          // billing UI flow and avoid manufacturing a client-side success.
          console.warn("Unable to confirm platform subscription conversion:", error?.message || error);
        });
      }
    }
    if (params.get("buy-points") === "1") {
      window.history.replaceState({}, "", "/admin/dashboard");
      setIsRechargeOpen(true);
    }
    if (params.get("recharge") === "success") {
      const sessionId = params.get("session_id");
      window.history.replaceState({}, "", "/admin/dashboard");
      if (sessionId) {
        apiRequest("POST", "/api/stripe/confirm-recharge", { sessionId })
          .then(async (res) => {
            if (!active) return;
            const data = await res.json() as {
              success?: boolean;
              status?: "pending" | "paid" | "failed";
              points?: number;
              conversion?: PlatformConversion;
            };
            if (!active) return;
            queryClient.invalidateQueries({ queryKey: ["/api/ai-points"] });
            if (data.success && data.conversion?.eventName === "Purchase") {
              trackPlatformConversion(data.conversion, readMarketingConsent());
              toast({ title: s.rechargeSuccess, description: s.rechargeSuccessDesc?.replace("{points}", String(data.points ?? "")) });
            } else if (data.status === "pending") {
              toast({ title: "付款處理中", description: "Stripe 尚未回報付款成功；點數與轉換都會在確認後處理。" });
            }
          })
          .catch((err: any) => {
            if (active) toast({ title: s.rechargeFail, description: err.message, variant: "destructive" });
          });
      }
    } else if (params.get("recharge") === "cancel") {
      window.history.replaceState({}, "", "/admin/dashboard");
    }
    return () => {
      active = false;
      pendingTimers.forEach(timer => window.clearTimeout(timer));
      pendingTimers.clear();
    };
  }, []);

  const handleLogout = async () => {
    try {
      await apiRequest("POST", "/api/admin/logout", {});
    } catch {
      // Clear the local boundary even when the network logout fails.
    } finally {
      await clearAuthScopedQueryCache();
      setLocation("/admin");
    }
  };

  const getStatusBadge = (webinar: Webinar) => {
    const now = new Date();
    const start = new Date(webinar.startTime);
    const duration = webinar.videoDuration || 3600;
    const end = new Date(start.getTime() + duration * 1000);

    if (now >= start && now <= end) {
      return <Badge className="bg-red-500 text-white" data-testid={`badge-status-${webinar.id}`}>{s.statusLive}</Badge>;
    } else if (now > end) {
      return <Badge variant="secondary" data-testid={`badge-status-${webinar.id}`}>{s.statusEnded}</Badge>;
    } else {
      return <Badge variant="outline" data-testid={`badge-status-${webinar.id}`}>{s.statusUpcoming}</Badge>;
    }
  };

  const formatDate = (date: Date | string) => {
    return new Date(date).toLocaleString(lang, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const formatDuration = (seconds: number | null) => {
    if (!seconds) return "";
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const sec = seconds % 60;
    if (h > 0) return `${h}h ${m}m ${sec}s`;
    return `${m}m ${sec}s`;
  };

  const handleShare = (webinar: Webinar) => {
    if (webinar.publishStatus !== "published") {
      toast({ title: s.toastUpgradeNeeded, description: "草稿不能取得公開分享網址，請先發布。", variant: "destructive" });
      setIsUpgradeOpen(true);
      return;
    }
    const baseUrl = window.location.origin;
    const registerUrl = `${baseUrl}/register/${webinar.id}`;
    navigator.clipboard.writeText(registerUrl);
    toast({ title: s.toastLinkCopied, description: s.toastLinkCopiedDesc });
  };

  return (
    <div className="admin-shell admin-dashboard">
      <header className="admin-topbar border-b bg-card sticky top-0 z-50">
          <div className="container mx-auto px-4 py-4 flex items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <SellCaseLogo className="h-auto w-[148px] sm:w-[178px]" />
            <h1 className="sr-only">開賣啦 SellCase｜AI 自動銷講成交系統</h1>
          </div>
          <AdminDashboardNavigation
            lang={lang}
            isSuperAdmin={!!subscription?.isSuperAdmin}
            canManage={!!subscription?.canManage}
            adminLabel={s.superAdminPanel}
            logoutLabel={s.logout}
            navigate={setLocation}
            toggleLanguage={() => setLang(lang === "zh-TW" ? "zh-CN" : "zh-TW")}
            openSupport={() => setIsSupportOpen(true)}
            openEcpay={() => setIsEcpayOpen(true)}
            logout={handleLogout}
          />
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 space-y-6">
        <MediaPicker
          open={!!imagePickerTarget}
          onOpenChange={(open) => !open && setImagePickerTarget(null)}
          kind="image"
          onSelect={(asset) => {
            if (!asset.url) return;
            if (imagePickerTarget === "create") form.setValue("coverImage", asset.url);
            if (imagePickerTarget === "wizard") setAiWizard((current) => ({ ...current, coverImage: asset.url! }));
          }}
        />
        <Dialog open={isEcpayOpen} onOpenChange={setIsEcpayOpen}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>綠界 ECPay 自有商店</DialogTitle>
              <DialogDescription>串接你自己的綠界 AIO 帳號，直播優惠款項會直接進入你的商店。</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">
                HashKey 與 HashIV 會以 AES-256-GCM 加密保存，API 不會再次顯示明文。綠界沒有安全的「只驗證憑證、不建立訂單」介面，因此此處僅標示設定完整；請先選測試環境完成一次結帳。
              </div>
              <div className="space-y-2"><Label>MerchantID</Label><Input value={ecpayForm.merchantId} onChange={(e) => setEcpayForm((v) => ({ ...v, merchantId: e.target.value }))} autoComplete="off" data-testid="input-ecpay-merchant-id" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2"><Label>HashKey</Label><Input type="password" value={ecpayForm.hashKey} placeholder={ecpayConnection?.hasCredentials ? "已安全儲存（留空不變）" : "請輸入 HashKey"} onChange={(e) => setEcpayForm((v) => ({ ...v, hashKey: e.target.value }))} autoComplete="new-password" /></div>
                <div className="space-y-2"><Label>HashIV</Label><Input type="password" value={ecpayForm.hashIv} placeholder={ecpayConnection?.hasCredentials ? "已安全儲存（留空不變）" : "請輸入 HashIV"} onChange={(e) => setEcpayForm((v) => ({ ...v, hashIv: e.target.value }))} autoComplete="new-password" /></div>
              </div>
              <div className="space-y-2"><Label>環境</Label><Select value={ecpayForm.environment} onValueChange={(environment: "stage" | "production") => setEcpayForm((v) => ({ ...v, environment }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="stage">測試環境 Stage（建議先用）</SelectItem><SelectItem value="production">正式環境 Production</SelectItem></SelectContent></Select></div>
              <div className="flex items-center justify-between rounded-md border p-3"><div><Label>啟用綠界收款</Label><p className="text-xs text-muted-foreground">停用後既有 Stripe 優惠不受影響。</p></div><Switch checked={ecpayForm.enabled} onCheckedChange={(enabled) => setEcpayForm((v) => ({ ...v, enabled }))} /></div>
              <div className="flex flex-wrap justify-end gap-2">
                {ecpayConnection?.enabled && <Button variant="destructive" onClick={() => disableEcpayMutation.mutate()} disabled={disableEcpayMutation.isPending}>停用</Button>}
                {ecpayConnection && <Button variant="outline" onClick={() => testEcpayMutation.mutate()} disabled={testEcpayMutation.isPending}>檢查設定</Button>}
                <Button onClick={() => saveEcpayMutation.mutate()} disabled={saveEcpayMutation.isPending}>{saveEcpayMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}儲存</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
        <Dialog open={isSupportOpen} onOpenChange={setIsSupportOpen}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>{lang === "zh-CN" ? "联系支持团队" : "聯繫客服團隊"}</DialogTitle>
              <DialogDescription>{lang === "zh-CN" ? "提交问题、错误报告或产品反馈，我们会尽快处理。" : "提交問題、錯誤回報或產品建議，我們會盡快處理。"}</DialogDescription>
            </DialogHeader>
            <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); supportMutation.mutate(); }}>
              <div className="space-y-2">
                <Label>{lang === "zh-CN" ? "类型" : "類型"}</Label>
                <Select value={supportCategory} onValueChange={(value: "feedback" | "question" | "bug") => setSupportCategory(value)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="feedback">{lang === "zh-CN" ? "产品反馈" : "產品建議"}</SelectItem>
                    <SelectItem value="question">{lang === "zh-CN" ? "使用问题" : "使用問題"}</SelectItem>
                    <SelectItem value="bug">{lang === "zh-CN" ? "错误报告" : "錯誤回報"}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2"><Label htmlFor="support-subject">{lang === "zh-CN" ? "主题" : "主旨"}</Label><Input id="support-subject" maxLength={200} value={supportSubject} onChange={(e) => setSupportSubject(e.target.value)} required /></div>
              <div className="space-y-2"><Label htmlFor="support-message">{lang === "zh-CN" ? "说明" : "說明"}</Label><Textarea id="support-message" maxLength={5000} rows={5} value={supportMessage} onChange={(e) => setSupportMessage(e.target.value)} required /></div>
              <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => setIsSupportOpen(false)}>{s.cancel}</Button><Button type="submit" disabled={supportMutation.isPending || !supportSubject.trim() || !supportMessage.trim()}>{supportMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{lang === "zh-CN" ? "发送" : "送出"}</Button></div>
            </form>
          </DialogContent>
        </Dialog>
        <section className="dashboard-at-a-glance" aria-label="帳戶摘要">
          <div className="glance-heading">
            <div><p className="dashboard-kicker">ACCOUNT SNAPSHOT</p><h2>今天，先處理你的直播間</h2></div>
            <div className="glance-actions">
              {noCardTrial?.state === "active" && <Badge className="trial-badge">免信用卡試用中</Badge>}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" variant="outline" data-testid="button-account-actions"><Crown className="mr-1 h-4 w-4" />方案操作</Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-60">
                  {!aiPoints?.unlimited && <DropdownMenuItem onSelect={() => requestAnimationFrame(() => setIsRechargeOpen(true))} data-testid="button-open-recharge"><Plus className="mr-2 h-4 w-4" />充值 AI 點數</DropdownMenuItem>}
                  {paidSubscription?.status === "trialing" && <DropdownMenuItem onSelect={() => { if (window.confirm("將立即結束目前試用並向目前付款方式收取本月方案費用。付款成功後會立即發放方案 AI 點數，是否繼續？")) endTrialMutation.mutate(); }} disabled={endTrialMutation.isPending} data-testid="button-end-trial">{endTrialMutation.isPending ? "付款處理中…" : "立即付款取得 AI 點數"}</DropdownMenuItem>}
                  <DropdownMenuItem onSelect={() => paidSubscription?.active && subscription?.hasStripeCustomer ? portalMutation.mutate() : requestAnimationFrame(() => setIsUpgradeOpen(true))} disabled={portalMutation.isPending} data-testid="button-upgrade">{paidSubscription?.active ? "變更方案／增加額度" : s.upgradeBtn}</DropdownMenuItem>
                  {paidSubscription?.active && subscription?.hasStripeCustomer && <DropdownMenuItem onSelect={() => portalMutation.mutate()} disabled={portalMutation.isPending} data-testid="button-manage-subscription">{s.manageSubscription}</DropdownMenuItem>}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
          <div className="glance-grid">
            <div className="glance-stat">
              <span className="glance-label">{s.subPlanLabel}</span>
              <strong data-testid="badge-current-plan">{subscription?.plan === "starter" ? "Starter" : subscription?.plan === "growth" ? "Growth" : subscription?.plan === "scale" ? "Scale" : s.subPlanFree}</strong>
              <span className="glance-meta">{subscription?.active ? "方案有效" : "草稿模式"}</span>
            </div>
            <div className="glance-stat">
              <span className="glance-label">AI 回覆點數</span>
              <strong data-testid="text-ai-points">{aiPoints?.unlimited ? "∞" : (aiPoints?.points ?? "—")}</strong>
              <span className="glance-meta">{aiPoints?.unlimited ? "無限使用" : "目前可用點數"}</span>
            </div>
            <div className="glance-stat glance-stat-accent">
              <span className="glance-label">發布額度</span>
              <strong data-testid="text-published-count">{subscription ? `${subscription.publishedCount} / ${subscription.maxWebinars}` : "—"}</strong>
              <span className="glance-meta">已發布 / 可發布直播間</span>
            </div>
          </div>
        </section>
        {noCardTrial && !subscription?.isSuperAdmin && isTrialInfoOpen && (
          <aside id="trial-info-panel" className="trial-panel is-open" role="dialog" aria-modal="false" aria-labelledby="trial-info-title" data-testid="card-no-card-trial">
            <div className="trial-panel-head"><div><p className="dashboard-kicker">TRIAL DETAILS</p><h2 id="trial-info-title">{noCardTrial.state === "active" ? "免信用卡試用進行中" : noCardTrial.state === "eligible" ? `啟用 ${NO_CARD_TRIAL_DAYS} 天免信用卡試用` : "試用已結束，公開頁已暫停"}</h2></div><button ref={trialCloseRef} className="icon-close" onClick={() => { setIsTrialInfoOpen(false); requestAnimationFrame(() => trialTriggerRef.current?.focus()); }} aria-label="關閉試用資訊">×</button></div>
            {noCardTrial.state === "eligible" && <div className="trial-panel-row"><p>發布 1 個直播間與 1 個商品頁、使用 50 次 AI。到期不扣款。</p><Button onClick={() => activateTrialMutation.mutate()} disabled={activateTrialMutation.isPending} data-testid="button-activate-no-card-trial">{activateTrialMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}啟用試用</Button></div>}
            {noCardTrial.state === "active" && <><div className="trial-mini-grid"><div><span>試用剩餘時間</span><TrialCountdown expiresAt={noCardTrial.expiresAt} /></div><div><span>AI 次數剩餘</span><b data-testid="text-trial-ai-remaining">{noCardTrial.remainingAI} / {NO_CARD_TRIAL_AI_CALL_LIMIT} 次</b></div><div><span>發布額度</span><b>{subscription?.publishedCount || 0} / 1 個</b><small data-testid="text-trial-page-quota">商品頁剩餘 {trialPageRemaining} / 1 個</small></div></div><ol className="trial-milestones" aria-label="試用行動清單">{NO_CARD_TRIAL_MILESTONES.map((day) => { const label: Record<number, string> = { 1: "建立直播間或商品頁", 2: "發布並開始使用", 3: "分享平台網址", 7: "查看實際基本數據", 12: "試用即將到期，請選擇方案", 14: "試用結束；升級後可恢復公開頁" }; const reached = noCardTrial.milestones.find(item => item.day === day)?.reached; return <li key={day} className={reached ? "reached" : ""}><b>第 {day} 天</b> · {label[day]} {reached && <span>完成</span>}</li>; })}</ol><div className="trial-panel-actions"><Button variant="outline" onClick={() => setIsUpgradeOpen(true)} data-testid="button-trial-upgrade">升級付費方案</Button><Button size="sm" onClick={() => { setIsTrialInfoOpen(false); requestAnimationFrame(() => trialTriggerRef.current?.focus()); }} data-testid="button-trial-close">關閉資訊</Button></div></>}
            {noCardTrial.state === "expired" && <div className="trial-panel-row"><p>內容會至少保留到 {noCardTrial.retentionUntil ? new Date(noCardTrial.retentionUntil).toLocaleDateString("zh-TW") : "試用結束後 30 天"}。</p><Button onClick={() => setIsUpgradeOpen(true)} data-testid="button-restore-trial-page">選擇付費方案</Button></div>}
          </aside>
        )}
        {noCardTrial && !subscription?.isSuperAdmin && !isTrialInfoOpen && (
          <button ref={trialTriggerRef} className="trial-info-trigger" onClick={() => setIsTrialInfoOpen(true)} aria-label="開啟試用資訊" aria-expanded={isTrialInfoOpen} aria-controls="trial-info-panel" data-testid="button-open-trial-info"><CircleAlert className="h-5 w-5" /><span>試用資訊</span></button>
        )}
        <Dialog open={isUpgradeOpen} onOpenChange={setIsUpgradeOpen}>
          <DialogContent className="sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>選擇發布方案</DialogTitle>
              <DialogDescription>付費方案會立即進入安全結帳並依方案收費；不會建立新的信用卡試用。免信用卡試用與付費 AI 點數、Stripe 帳務分開計算。</DialogDescription>
            </DialogHeader>
            <RegionalPricingNote region={regionalPricing}>
              幣別只影響本頁顯示，選擇方案後仍會以美元向付款方式請款。
            </RegionalPricingNote>
            <div className="mx-auto flex rounded-lg border bg-muted/50 p-1">
              <button type="button" onClick={() => setBillingInterval("month")} className={`rounded-md px-4 py-2 text-sm font-medium ${billingInterval === "month" ? "bg-background shadow-sm" : "text-muted-foreground"}`}>月繳</button>
              <button type="button" onClick={() => setBillingInterval("year")} className={`rounded-md px-4 py-2 text-sm font-medium ${billingInterval === "year" ? "bg-background shadow-sm" : "text-muted-foreground"}`}>年繳 <span className="text-emerald-700">85 折</span></button>
            </div>
            <div className="grid sm:grid-cols-3 gap-3">
              {stripeConfig?.plans.map((plan) => {
                const available = billingInterval === "year" ? plan.annualAvailable : plan.available;
                return (
                <button
                  type="button"
                  key={`${plan.key}-${billingInterval}`}
                  onClick={() => available && setSelectedPlan(plan.key)}
                  disabled={!available}
                  className={`rounded-xl border p-4 text-left transition ${selectedPlan === plan.key ? "border-primary ring-2 ring-primary/20" : "hover:border-primary/50"} ${!available ? "cursor-not-allowed opacity-60" : ""}`}
                >
                  <div className="min-w-0">
                    <span className="block font-semibold">{plan.key === "starter" ? "Starter" : plan.key === "growth" ? "Growth" : "Scale"}</span>
                    <span className="mt-1 block break-words text-xl font-bold leading-tight sm:text-2xl [&_small]:ml-1 [&_small]:text-xs [&_small]:font-medium [&_small]:text-muted-foreground [&_strong]:block">
                      <PricingAmount planKey={plan.key} interval={billingInterval} region={regionalPricing} />
                    </span>
                  </div>
                  {billingInterval === "year" && <p className="mt-1 text-xs font-semibold text-emerald-700">年繳 85 折；實際以美元年繳預付</p>}
                  <p className="text-sm text-muted-foreground mt-2">最多發布 {plan.includedWebinars} 個直播間</p>
                  <p className="text-sm text-muted-foreground">每月 {plan.monthlyRegistrants.toLocaleString()} 位報名者</p>
                  <p className="text-sm font-medium text-primary">正式首次扣款後，每月發放 {plan.monthlyAiPoints} AI 點</p>
                  <p className="mt-2 text-sm font-semibold text-emerald-700">付款完成後立即啟用付費方案</p>
                  {!available && <p className="mt-2 text-xs font-medium text-amber-700">即將開放</p>}
                </button>
              )})}
            </div>
            <div className="rounded-lg bg-muted/60 p-4 flex items-center justify-between gap-3">
              <div>
                <div className="font-medium">加購直播間</div>
                <div className="text-sm text-muted-foreground">每增加 1 間 ${billingInterval === "year" ? (stripeConfig?.annualAddonAmountUsd || 204) : (stripeConfig?.addonAmountUsd || 20)} USD／{billingInterval === "year" ? "年（85 折）" : "月"}</div>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="icon" onClick={() => setAddonWebinars(Math.max(0, addonWebinars - 1))}>−</Button>
                <span className="w-8 text-center font-bold">{addonWebinars}</span>
                <Button variant="outline" size="icon" onClick={() => setAddonWebinars(Math.min(50, addonWebinars + 1))}>+</Button>
              </div>
            </div>
            <p className="text-sm text-muted-foreground" data-testid="checkout-currency-confirmation">
              {(() => {
                const selected = stripeConfig?.plans.find((plan) => plan.key === selectedPlan);
                return selected ? (
                  <>確認方案：{selectedPlan === "starter" ? "Starter" : selectedPlan === "growth" ? "Growth" : "Scale"} · <PricingAmount planKey={selectedPlan} interval={billingInterval} region={regionalPricing} showTestIds={false} />。結帳幣別：USD。</>
                ) : "結帳幣別：USD。";
              })()}
            </p>
            <Button
              onClick={() => checkoutMutation.mutate()}
              disabled={checkoutMutation.isPending || !stripeConfig?.billingAvailable || !(billingInterval === "year" ? stripeConfig.plans.find((plan) => plan.key === selectedPlan)?.annualAvailable : stripeConfig.plans.find((plan) => plan.key === selectedPlan)?.available)}
              aria-busy={checkoutMutation.isPending}
            >
              {checkoutMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              {checkoutMutation.isPending ? "正在建立安全結帳…" : "前往 Stripe 安全結帳"}
            </Button>
            {stripeConfig && !stripeConfig.billingAvailable && (
              <p className="text-sm text-destructive" role="alert">
                正式付款服務尚未啟用，管理員需完成 Stripe Live 連線後重新發布。
              </p>
            )}
            {stripeConfig?.billingAvailable && !stripeConfig.catalogReady && (
              <p className="text-sm text-amber-700" role="status">部分方案正在設定中；標示為可用的方案仍可正常訂閱。</p>
            )}
          </DialogContent>
        </Dialog>

        <Dialog open={isRechargeOpen} onOpenChange={setIsRechargeOpen}>
          <DialogContent className="sm:max-w-md" data-testid="dialog-recharge">
            <DialogHeader>
              <DialogTitle>{s.rechargeTitle}</DialogTitle>
              <DialogDescription>{s.rechargeDesc}</DialogDescription>
            </DialogHeader>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {aiPoints?.packages.map((pkg) => (
                <Button
                  key={pkg.id}
                  variant="outline"
                  className="h-auto flex-col py-4 gap-1"
                  disabled={rechargeMutation.isPending}
                  onClick={() => rechargeMutation.mutate({ packageId: pkg.id })}
                  data-testid={`button-package-${pkg.id}`}
                >
                  <span className="text-lg font-bold">{pkg.points} {s.rechargePoints}</span>
                  <span className="text-sm text-muted-foreground">NT$ {pkg.twd}</span>
                </Button>
              ))}
            </div>
            <div className="space-y-2 pt-2">
              <label className="text-sm font-medium">{s.rechargeCustom}</label>
              <div className="flex gap-2">
                <Input
                  type="number"
                  min={aiPoints?.minTwd ?? 100}
                  placeholder={s.rechargeCustomPlaceholder}
                  value={customAmount}
                  onChange={(e) => setCustomAmount(e.target.value)}
                  data-testid="input-custom-amount"
                />
                <Button
                  disabled={rechargeMutation.isPending || Number(customAmount) < (aiPoints?.minTwd ?? 100)}
                  onClick={() => rechargeMutation.mutate({ amount: Number(customAmount) })}
                  data-testid="button-custom-recharge"
                >
                  {rechargeMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : s.rechargeCustomBtn}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

          <div className="flex items-center justify-between flex-wrap gap-3 admin-dashboard-titlebar">
          <div>
            <h2 className="text-2xl font-bold">{s.management}</h2>
            <p className="text-muted-foreground">{s.managementDesc}</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
          <Dialog open={isAiWizardOpen} onOpenChange={(open) => {
            if (!aiWizardMutation.isPending) setIsAiWizardOpen(open);
          }}>
            <Button
              variant="outline"
              className="border-primary text-primary"
              data-testid="button-ai-webinar-wizard"
              onClick={() => {
                setAiWizardStep(1);
                setIsAiWizardOpen(true);
              }}
            >
              <Sparkles className="h-4 w-4 mr-2" />
              開賣場建立精靈
            </Button>
            <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Sparkles className="h-5 w-5 text-primary" />
                  開賣場建立精靈
                </DialogTitle>
                <DialogDescription>
                  AI 會建立可編輯的草稿，不會自動發布或寄信。
                </DialogDescription>
              </DialogHeader>

              <div className="grid grid-cols-3 gap-2">
                {[
                  { step: 1, label: "策略" },
                  { step: 2, label: "內容" },
                  { step: 3, label: "確認" },
                ].map((item) => (
                  <div
                    key={item.step}
                    className={`rounded-md border px-3 py-2 text-center text-sm ${
                      aiWizardStep === item.step
                        ? "border-primary bg-primary/10 text-primary font-medium"
                        : aiWizardStep > item.step
                          ? "border-primary/40 bg-primary/5"
                          : "text-muted-foreground"
                    }`}
                  >
                    {item.step}. {item.label}
                  </div>
                ))}
              </div>

              {aiWizardStep === 1 && (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="ai-wizard-title">Webinar 主題 *</Label>
                    <Input
                      id="ai-wizard-title"
                      value={aiWizard.title}
                      onChange={(event) => setAiWizard((current) => ({ ...current, title: event.target.value }))}
                      placeholder="例如：如何用自動化 Webinar 穩定取得客戶"
                      data-testid="input-ai-wizard-title"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>報名頁 Banner（選填）</Label>
                    {aiWizard.coverImage ? (
                      <div className="relative overflow-hidden rounded-lg border bg-muted">
                        <img src={aiWizard.coverImage} alt="Banner 預覽" className="h-40 w-full object-cover" />
                        <Button
                          type="button"
                          size="icon"
                          variant="secondary"
                          className="absolute right-2 top-2"
                          onClick={() => setAiWizard((current) => ({ ...current, coverImage: "" }))}
                          aria-label="移除 Banner"
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="w-full rounded-lg border-2 border-dashed p-5 text-center transition-colors hover:border-primary hover:bg-primary/5"
                        onClick={() => wizardBannerFileRef.current?.click()}
                        disabled={isUploadingWizardBanner}
                        data-testid="button-ai-wizard-upload-banner"
                      >
                        {isUploadingWizardBanner ? <Loader2 className="mx-auto h-6 w-6 animate-spin text-primary" /> : <ImagePlus className="mx-auto h-7 w-7 text-muted-foreground" />}
                        <span className="mt-2 block text-sm font-medium">{isUploadingWizardBanner ? "Banner 上傳中…" : "點此上傳 Banner"}</span>
                        <span className="mt-1 block text-xs text-muted-foreground">支援 JPG、PNG、WebP、AVIF</span>
                      </button>
                    )}
                    <input
                      ref={wizardBannerFileRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/avif"
                      className="hidden"
                      data-testid="input-ai-wizard-banner"
                      onChange={async (event) => {
                        const file = event.target.files?.[0];
                        if (!file) return;
                        setIsUploadingWizardBanner(true);
                        try {
                          const body = new FormData();
                          body.append("file", file);
                          const response = await fetch("/api/upload", { method: "POST", body });
                          const result = await response.json();
                          if (!response.ok) throw new Error(result.message || "Banner 上傳失敗");
                          setAiWizard((current) => ({ ...current, coverImage: result.url }));
                        } catch (error) {
                          toast({ title: "Banner 上傳失敗", description: error instanceof Error ? error.message : "請稍後再試", variant: "destructive" });
                        } finally {
                          setIsUploadingWizardBanner(false);
                          if (wizardBannerFileRef.current) wizardBannerFileRef.current.value = "";
                        }
                      }}
                    />
                    {aiWizard.coverImage && (
                      <Button type="button" variant="outline" size="sm" onClick={() => wizardBannerFileRef.current?.click()} disabled={isUploadingWizardBanner}>
                        <Upload className="mr-2 h-4 w-4" />更換 Banner
                      </Button>
                    )}
                    <Button type="button" variant="outline" size="sm" onClick={() => setImagePickerTarget("wizard")} data-testid="button-ai-wizard-pick-banner">
                      <FolderOpen className="mr-2 h-4 w-4" />從素材庫選擇
                    </Button>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="ai-wizard-audience">目標受眾 *</Label>
                    <Textarea
                      id="ai-wizard-audience"
                      value={aiWizard.audience}
                      onChange={(event) => setAiWizard((current) => ({ ...current, audience: event.target.value }))}
                      placeholder="他們是誰？目前遇到什麼問題？"
                      rows={3}
                      data-testid="input-ai-wizard-audience"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="ai-wizard-goal">商業目標 *</Label>
                    <Textarea
                      id="ai-wizard-goal"
                      value={aiWizard.goal}
                      onChange={(event) => setAiWizard((current) => ({ ...current, goal: event.target.value }))}
                      placeholder="希望觀眾看完後理解什麼、採取什麼行動？"
                      rows={3}
                      data-testid="input-ai-wizard-goal"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="ai-wizard-cta">直播中的主要行動（選填）</Label>
                    <Input
                      id="ai-wizard-cta"
                      value={aiWizard.ctaText}
                      onChange={(event) => setAiWizard((current) => ({ ...current, ctaText: event.target.value }))}
                      placeholder="例如：了解完整課程；網址可在建立商品頁後設定"
                    />
                    <p className="text-xs text-muted-foreground">報名頁按鈕會直接開啟報名表，不需要先填 CTA 網址。</p>
                  </div>
                </div>
              )}

              {aiWizardStep === 2 && (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-3">
                      <Label htmlFor="ai-wizard-source">參考資料／逐字稿</Label>
                      <Label className="cursor-pointer text-sm text-primary font-medium">
                        讀取 TXT、MD 或 SRT
                        <input
                          type="file"
                          accept=".txt,.md,.srt,text/plain"
                          className="hidden"
                          onChange={async (event) => {
                            const file = event.target.files?.[0];
                            if (!file) return;
                            if (file.size > 2 * 1024 * 1024) {
                              toast({ title: "檔案過大", description: "文字檔請小於 2 MB", variant: "destructive" });
                              return;
                            }
                            const content = await file.text();
                            setAiWizard((current) => ({ ...current, sourceContent: content.slice(0, 40000) }));
                            event.target.value = "";
                          }}
                        />
                      </Label>
                    </div>
                    <Textarea
                      id="ai-wizard-source"
                      value={aiWizard.sourceContent}
                      onChange={(event) => setAiWizard((current) => ({ ...current, sourceContent: event.target.value.slice(0, 40000) }))}
                      placeholder="貼上產品資料、課程大綱、講稿、逐字稿或銷售資訊。沒有資料也可以繼續。"
                      rows={9}
                      data-testid="input-ai-wizard-source"
                    />
                    <p className="text-xs text-muted-foreground text-right">
                      {aiWizard.sourceContent.length.toLocaleString()} / 40,000 字
                    </p>
                  </div>
                    <div className="grid sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>影片來源（選填）</Label>
                      <VideoSourcePicker
                        vimeoUrl={aiWizard.vimeoUrl}
                        videoAssetId={aiWizard.videoAssetId}
                        onChange={(source) => setAiWizard((current) => ({
                          ...current,
                          vimeoUrl: source.vimeoUrl,
                          videoProvider: source.videoProvider,
                          videoAssetId: source.videoAssetId,
                          videoDurationMinutes: source.durationSeconds ? String(Math.ceil(source.durationSeconds / 60)) : current.videoDurationMinutes,
                        }))}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="ai-wizard-duration">影片長度（分鐘）</Label>
                      <Input
                        id="ai-wizard-duration"
                        type="number"
                        min="0"
                        max="1440"
                        value={aiWizard.videoDurationMinutes}
                        onChange={(event) => setAiWizard((current) => ({ ...current, videoDurationMinutes: event.target.value }))}
                        placeholder="例如：45"
                        disabled={aiWizard.videoProvider === "bunny"}
                      />
                      {aiWizard.videoProvider === "bunny" && <p className="text-xs text-muted-foreground">自有影片長度由伺服器處理完成後提供。</p>}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="ai-wizard-start">預計開始時間 *</Label>
                    <Input
                      id="ai-wizard-start"
                      type="datetime-local"
                      value={aiWizard.startTime}
                      onChange={(event) => setAiWizard((current) => ({ ...current, startTime: event.target.value }))}
                      data-testid="input-ai-wizard-start"
                    />
                  </div>
                </div>
              )}

              {aiWizardStep === 3 && (
                <div className="space-y-4">
                  <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">本次 AI 建立</span>
                      <Badge variant="default">{noCardTrial?.state === "active" ? "3 次試用 AI 呼叫" : "30 點"}</Badge>
                    </div>
                    <ul className="text-sm text-muted-foreground space-y-1 list-disc pl-5">
                      <li>產生 Webinar 標題、報名頁介紹與稀缺設定</li>
                      <li>產生定時聊天、投票、提示卡與 CTA</li>
                      <li>產生分眾 Email Sequence</li>
                      <li>建立 AI 助教設定與知識文件</li>
                    </ul>
                  </div>
                  <div className="rounded-lg border p-4 text-sm space-y-2">
                    <p><span className="text-muted-foreground">主題：</span>{aiWizard.title}</p>
                    <p><span className="text-muted-foreground">受眾：</span>{aiWizard.audience}</p>
                    <p><span className="text-muted-foreground">目標：</span>{aiWizard.goal}</p>
                    <p><span className="text-muted-foreground">建立後：</span>只保存為草稿，不自動發布、不自動寄信</p>
                  </div>
                  {noCardTrial?.state === "active" ? (
                    <div className="flex items-center justify-between gap-3">
                      <p className={`text-sm ${(noCardTrial.remainingAI < 3) ? "text-destructive" : "text-muted-foreground"}`} data-testid="text-ai-wizard-trial-budget">
                        試用 AI 次數：剩餘 {noCardTrial.remainingAI} / {NO_CARD_TRIAL_AI_CALL_LIMIT} 次；本次會使用 3 次，不使用付費 AI 點數。
                        {noCardTrial.remainingAI < 3 ? " 次數不足，請升級後使用付費 AI 點數。" : ""}
                      </p>
                      {noCardTrial.remainingAI < 3 && <Button type="button" size="sm" variant="outline" onClick={() => setIsUpgradeOpen(true)}>升級方案</Button>}
                    </div>
                  ) : !aiPoints?.unlimited && (
                    <div className="flex items-center justify-between gap-3">
                      <p className={`text-sm ${aiPoints && aiPoints.points < 30 ? "text-destructive" : "text-muted-foreground"}`}>
                        目前餘額：{aiPoints?.points ?? "—"} 點
                        {aiPoints && aiPoints.points < 30 ? "，點數不足。" : "。失敗會自動退回 30 點。"}
                      </p>
                      {aiPoints && aiPoints.points < 30 && (
                        <Button type="button" size="sm" variant="outline" onClick={() => setIsRechargeOpen(true)}>
                          購買 AI 點數
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              )}

              <div className="flex justify-between gap-2 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => aiWizardStep === 1 ? setIsAiWizardOpen(false) : setAiWizardStep((step) => step - 1)}
                  disabled={aiWizardMutation.isPending}
                >
                  {aiWizardStep === 1 ? "取消" : "上一步"}
                </Button>
                {aiWizardStep < 3 ? (
                  <Button
                    type="button"
                    onClick={() => setAiWizardStep((step) => step + 1)}
                    disabled={
                      (aiWizardStep === 1 && (!aiWizard.title.trim() || !aiWizard.audience.trim() || !aiWizard.goal.trim())) ||
                      (aiWizardStep === 2 && !aiWizard.startTime)
                    }
                  >
                    下一步
                  </Button>
                ) : (
                  <Button
                    type="button"
                    onClick={() => {
                      if (noCardTrial?.state === "active" && noCardTrial.remainingAI < 3) {
                        return;
                      }
                      if (noCardTrial?.state !== "active" && !aiPoints?.unlimited && (aiPoints?.points ?? 0) < 30) {
                        setIsAiWizardOpen(false);
                        setIsRechargeOpen(true);
                        return;
                      }
                      aiWizardMutation.mutate();
                    }}
                    disabled={aiWizardMutation.isPending || (noCardTrial?.state === "active" && noCardTrial.remainingAI < 3)}
                    data-testid="button-run-ai-webinar-wizard"
                  >
                    {aiWizardMutation.isPending ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        AI 正在建立，請勿關閉
                      </>
                    ) : (
                      <>
                        <Sparkles className="h-4 w-4 mr-2" />
                        {noCardTrial?.state === "active" ? "使用 3 次試用 AI 建立草稿" : "使用 30 點建立草稿"}
                      </>
                    )}
                  </Button>
                )}
              </div>
            </DialogContent>
          </Dialog>

          <Dialog open={isProductPagePromptOpen} onOpenChange={setIsProductPagePromptOpen}>
            <DialogContent className="sm:max-w-lg">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <ShoppingBag className="h-5 w-5 text-primary" />
                  要接著建立商品下單頁嗎？
                </DialogTitle>
                <DialogDescription>
                  AI 已完成直播間與內容草稿。商品頁會參考「{createdWizardWebinar?.title || "這場直播"}」的內容建立，你只需要先補上商品名稱與售價。
                </DialogDescription>
              </DialogHeader>
              <div className="rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">
                商品頁仍只會建立為草稿，不會自動發布；商品款會由你自己的綠界帳號收取。
              </div>
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    const webinarId = createdWizardWebinar?.id;
                    setIsProductPagePromptOpen(false);
                    if (webinarId) setLocation(`/admin/webinar/${webinarId}`);
                  }}
                >
                  先編輯直播間
                </Button>
                <Button
                  type="button"
                  onClick={() => {
                    const webinar = createdWizardWebinar;
                    setIsProductPagePromptOpen(false);
                    if (webinar) {
                      setLocation(`/admin/webinar/${webinar.id}?setupProduct=1&productName=${encodeURIComponent(webinar.title)}`);
                    }
                  }}
                  data-testid="button-ai-wizard-create-product-page"
                >
                  <ShoppingBag className="mr-2 h-4 w-4" />
                  建立商品頁
                </Button>
              </div>
            </DialogContent>
          </Dialog>

          <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
            <Button
              className="admin-create-button"
              data-testid="button-create-webinar"
              onClick={() => setIsCreateOpen(true)}
            >
              <Plus className="h-4 w-4 mr-2" />
              {s.createWebinar}
            </Button>
            <DialogContent className="sm:max-w-lg">
              <DialogHeader>
                <DialogTitle>{s.createNewWebinar}</DialogTitle>
                <DialogDescription>{s.createNewWebinarDesc}</DialogDescription>
              </DialogHeader>
              <Form {...form}>
                <form onSubmit={form.handleSubmit((data) => createMutation.mutate(data))} className="space-y-4">
                  <FormField
                    control={form.control}
                    name="title"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{s.labelTitle}</FormLabel>
                        <FormControl>
                          <Input placeholder={s.placeholderTitle} {...field} data-testid="input-webinar-title" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="description"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{s.labelDescription}</FormLabel>
                        <FormControl>
                          <Textarea placeholder={s.placeholderDescription} {...field} data-testid="input-webinar-description" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormItem>
                    <FormLabel>影片來源</FormLabel>
                    <VideoSourcePicker
                      vimeoUrl={form.watch("vimeoUrl")}
                      videoAssetId={form.watch("videoAssetId")}
                      onChange={(source) => {
                        form.setValue("videoProvider", source.videoProvider);
                        form.setValue("vimeoUrl", source.vimeoUrl, { shouldValidate: true });
                        form.setValue("videoAssetId", source.videoAssetId);
                      }}
                    />
                    <FormMessage>{form.formState.errors.vimeoUrl?.message}</FormMessage>
                  </FormItem>
                  <FormField
                    control={form.control}
                    name="startTime"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{s.labelStartTime}</FormLabel>
                        <FormControl>
                          <Input type="datetime-local" {...field} data-testid="input-start-time" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="coverImage"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>報名頁 Banner（選填）</FormLabel>
                        {field.value ? (
                          <div className="relative overflow-hidden rounded-lg border bg-muted">
                            <img src={field.value} alt="Banner 預覽" className="h-40 w-full object-cover" />
                            <Button
                              type="button"
                              size="icon"
                              variant="secondary"
                              className="absolute right-2 top-2"
                              onClick={() => field.onChange("")}
                              aria-label="移除 Banner"
                              data-testid="button-remove-create-cover"
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            className="w-full rounded-lg border-2 border-dashed p-5 text-center transition-colors hover:border-primary hover:bg-primary/5"
                            onClick={() => createCoverFileRef.current?.click()}
                            disabled={isUploadingCreateCover}
                            data-testid="button-upload-create-cover"
                          >
                            {isUploadingCreateCover ? <Loader2 className="mx-auto h-6 w-6 animate-spin text-primary" /> : <ImagePlus className="mx-auto h-7 w-7 text-muted-foreground" />}
                            <span className="mt-2 block text-sm font-medium">{isUploadingCreateCover ? "Banner 上傳中…" : "點此上傳 Banner"}</span>
                            <span className="mt-1 block text-xs text-muted-foreground">支援 JPG、PNG、WebP、AVIF</span>
                          </button>
                        )}
                        <input
                          ref={createCoverFileRef}
                          type="file"
                          accept="image/jpeg,image/png,image/webp,image/avif"
                          className="hidden"
                          data-testid="input-create-cover"
                          onChange={async (event) => {
                            const file = event.target.files?.[0];
                            if (!file) return;
                            setIsUploadingCreateCover(true);
                            try {
                              const body = new FormData();
                              body.append("file", file);
                              const response = await fetch("/api/upload", { method: "POST", body });
                              const result = await response.json();
                              if (!response.ok) throw new Error(result.message || "Banner 上傳失敗");
                              field.onChange(result.url);
                            } catch (error) {
                              toast({ title: "Banner 上傳失敗", description: error instanceof Error ? error.message : "請稍後再試", variant: "destructive" });
                            } finally {
                              setIsUploadingCreateCover(false);
                              if (createCoverFileRef.current) createCoverFileRef.current.value = "";
                            }
                          }}
                        />
                        {field.value && (
                          <Button type="button" variant="outline" size="sm" onClick={() => createCoverFileRef.current?.click()} disabled={isUploadingCreateCover}>
                            <Upload className="mr-2 h-4 w-4" />更換 Banner
                          </Button>
                        )}
                        <Button type="button" variant="outline" size="sm" onClick={() => setImagePickerTarget("create")} data-testid="button-pick-create-cover">
                          <FolderOpen className="mr-2 h-4 w-4" />從素材庫選擇
                        </Button>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <div className="flex justify-end gap-2">
                    <Button type="button" variant="outline" onClick={() => setIsCreateOpen(false)}>
                      {s.cancel}
                    </Button>
                    <Button type="submit" disabled={createMutation.isPending} data-testid="button-submit-webinar">
                      {createMutation.isPending ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          {s.creating}
                        </>
                      ) : (
                        s.create
                      )}
                    </Button>
                  </div>
                </form>
              </Form>
            </DialogContent>
          </Dialog>
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin" />
          </div>
        ) : webinars && webinars.length > 0 ? (
          <div className="space-y-4">
            {webinars.map((webinar) => {
              const webinarStats = stats?.[webinar.id];
              const onlineCount = webinarStats?.onlineCount || 0;
              return (
                <Card key={webinar.id} data-testid={`card-webinar-${webinar.id}`}>
                  <CardContent className="p-0">
                    <div className="flex flex-col md:flex-row">
                      <div 
                        className="w-full md:w-48 lg:w-56 h-32 md:h-auto flex-shrink-0 bg-muted relative cursor-pointer rounded-t-lg md:rounded-t-none md:rounded-l-lg overflow-hidden"
                        onClick={() => setLocation(`/admin/webinar/${webinar.id}`)}
                        data-testid={`link-webinar-detail-${webinar.id}`}
                      >
                        {webinar.coverImage ? (
                          <img 
                            src={webinar.coverImage} 
                            alt={webinar.title}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-primary/20 to-primary/5">
                            <Video className="h-10 w-10 text-muted-foreground/50" />
                          </div>
                        )}
                        {onlineCount > 0 && (
                          <div className="absolute top-2 left-2 flex items-center gap-1 bg-red-500 text-white text-xs px-2 py-0.5 rounded-full" data-testid={`badge-online-${webinar.id}`}>
                            <span className="w-1.5 h-1.5 bg-white rounded-full animate-pulse" />
                            {s.onlineCount(onlineCount)}
                          </div>
                        )}
                      </div>

                      <div className="flex-1 p-4 min-w-0">
                        <div className="flex items-start justify-between gap-2 mb-1 flex-wrap">
                          <div className="flex items-center gap-2 flex-wrap min-w-0">
                            <h3 
                              className="font-semibold text-base truncate cursor-pointer hover:text-primary transition-colors"
                              onClick={() => setLocation(`/admin/webinar/${webinar.id}`)}
                              data-testid={`text-webinar-title-${webinar.id}`}
                            >
                              {webinar.title}
                            </h3>
                            {getStatusBadge(webinar)}
                            {webinar.publishStatus === "published" ? (
                              <Badge variant="default" className="bg-green-600 text-white" data-testid={`badge-publish-${webinar.id}`}>{s.subPublished}</Badge>
                            ) : (
                              <Badge variant="secondary" data-testid={`badge-publish-${webinar.id}`}>{s.subDraft}</Badge>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-3 text-xs text-muted-foreground mb-3 flex-wrap">
                          <span className="flex items-center gap-1">
                            <Calendar className="h-3 w-3" />
                            {formatDate(webinar.startTime)}
                          </span>
                          {webinar.videoDuration && webinar.videoDuration > 0 && (
                            <span>{formatDuration(webinar.videoDuration)}</span>
                          )}
                        </div>

                        {webinar.description && (
                          <p className="text-sm text-muted-foreground line-clamp-1 mb-3">{webinar.description}</p>
                        )}

                        <div className="admin-webinar-stats grid grid-cols-3 gap-3">
                          <div className="text-center" data-testid={`stat-registered-${webinar.id}`}>
                            <div className="text-xl font-bold">{webinarStats?.registered ?? "—"}</div>
                            <div className="text-xs text-muted-foreground">{s.statRegistered}</div>
                          </div>
                          <div className="text-center" data-testid={`stat-attended-${webinar.id}`}>
                            <div className="text-xl font-bold">{webinarStats?.attended ?? "—"}</div>
                            <div className="text-xs text-muted-foreground">{s.statAttended}</div>
                          </div>
                          <div className="text-center" data-testid={`stat-engaged-${webinar.id}`}>
                            <div className="text-xl font-bold">{webinarStats?.engaged !== undefined ? `${webinarStats.engaged}%` : "—"}</div>
                            <div className="text-xs text-muted-foreground">{s.statEngagement}</div>
                          </div>
                        </div>
                      </div>

                       <div className="admin-webinar-actions flex md:flex-col items-center md:items-stretch gap-1 p-3 md:border-l border-t md:border-t-0 flex-wrap justify-center md:w-36 shrink-0">
                        {webinar.publishStatus === "published" ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="justify-start gap-2 text-xs w-full"
                            onClick={(e) => { e.stopPropagation(); unpublishMutation.mutate(webinar.id); }}
                            aria-label={s.unpublishBtn}
                            title={s.unpublishBtn}
                            disabled={unpublishMutation.isPending}
                            data-testid={`button-unpublish-${webinar.id}`}
                          >
                            <Eye className="h-3.5 w-3.5" />
                            <span>{s.unpublishBtn}</span>
                          </Button>
                        ) : (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="justify-start gap-2 text-xs w-full text-green-600"
                            onClick={(e) => { e.stopPropagation(); publishMutation.mutate(webinar.id); }}
                            aria-label={s.publishBtn}
                            title={s.publishBtn}
                            disabled={publishMutation.isPending}
                            data-testid={`button-publish-${webinar.id}`}
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                            <span>{s.publishBtn}</span>
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          className="justify-start gap-2 text-xs w-full"
                          onClick={() => setLocation(`/admin/webinar/${webinar.id}`)}
                          aria-label={s.actionEdit}
                          title={s.actionEdit}
                          data-testid={`button-edit-${webinar.id}`}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                          <span>{s.actionEdit}</span>
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="justify-start gap-2 text-xs w-full"
                          onClick={() => setLocation(`/admin/webinar/${webinar.id}/control`)}
                          aria-label={s.actionControl}
                          title={s.actionControl}
                          data-testid={`button-control-${webinar.id}`}
                        >
                          <Radio className="h-3.5 w-3.5" />
                          <span>{s.actionControl}</span>
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="justify-start gap-2 text-xs w-full"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleShare(webinar);
                          }}
                          aria-label={s.actionShare}
                          title={s.actionShare}
                          disabled={webinar.publishStatus !== "published"}
                          data-testid={`button-share-${webinar.id}`}
                        >
                          <Share2 className="h-3.5 w-3.5" />
                          <span>{s.actionShare}</span>
                        </Button>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="justify-start gap-2 text-xs w-full"
                              aria-label={s.actionMore}
                              title={s.actionMore}
                              data-testid={`button-more-${webinar.id}`}
                            >
                              <MoreVertical className="h-3.5 w-3.5" />
                              <span>{s.actionMore}</span>
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onClick={(e) => {
                                e.stopPropagation();
                                window.open(`/register/${webinar.id}`, "_blank");
                              }}
                              data-testid={`button-view-registration-${webinar.id}`}
                            >
                              <ExternalLink className="h-3.5 w-3.5 mr-2" />
                              {s.actionPreview}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={(e) => {
                                e.stopPropagation();
                                duplicateMutation.mutate(webinar.id);
                              }}
                              disabled={duplicateMutation.isPending}
                              data-testid={`button-duplicate-${webinar.id}`}
                            >
                              <Copy className="h-3.5 w-3.5 mr-2" />
                              {s.actionDuplicate}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <DropdownMenuItem
                                  onSelect={(e) => e.preventDefault()}
                                  className="text-destructive focus:text-destructive"
                                  data-testid={`button-delete-${webinar.id}`}
                                >
                                  <Trash2 className="h-3.5 w-3.5 mr-2" />
                                  {s.actionDelete}
                                </DropdownMenuItem>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>{s.deleteConfirmTitle}</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    {s.deleteConfirmDesc(webinar.title)}
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel data-testid="button-cancel-delete">{s.deleteCancel}</AlertDialogCancel>
                                  <AlertDialogAction
                                    onClick={() => deleteMutation.mutate(webinar.id)}
                                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                    data-testid="button-confirm-delete"
                                  >
                                    {deleteMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
                                    {s.deleteConfirm}
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        ) : (
          <Card>
            <CardContent className="py-12 text-center">
              <Video className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
              <h3 className="text-lg font-medium mb-2">{s.emptyTitle}</h3>
              <p className="text-muted-foreground mb-4">{s.emptyDesc}</p>
              <Button onClick={() => setIsCreateOpen(true)} data-testid="button-create-first-webinar">
                <Plus className="h-4 w-4 mr-2" />
                {s.createWebinar}
              </Button>
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}
