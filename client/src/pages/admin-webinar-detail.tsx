import { useState, useEffect, useRef, useMemo } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { applyDatePreservingTime, dateKeyInTimeZone } from "@/lib/webinar-date";
import { cn } from "@/lib/utils";
import { resolveFunnelCtaLabel } from "@/lib/funnel-analytics";
import { 
  ArrowLeft, Plus, Users, MessageSquare, MousePointerClick, 
  BarChart, Trash2, Loader2, Clock, Radio, Copy, ExternalLink,
  Lightbulb, HelpCircle, Star, TrendingUp, Settings, Code,
  Mail, Palette, Calendar, Edit, Save, RefreshCw, FileText, Eye,
  Upload, ImagePlus, X, Bell, Link2, Download, Globe, Languages, Bot,
  Sparkles, Megaphone, CheckCircle2, Activity, Inbox, Archive, UserRound, Send, Database, BrainCircuit, ShoppingBag
  , Flame, Snowflake, ChevronRight, Target, AlertCircle
} from "lucide-react";
import { EmailPreviewDialog, type EmailPreviewRequest } from "@/components/email-preview-dialog";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { parseClock } from "@/lib/clock-time";
import { apiErrorMessage } from "@/lib/viewer-messages";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BarChart as RechartsBarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, AreaChart, Area, LineChart, Line } from "recharts";
import type { Webinar, FakeUser, ScheduledMessage, CtaButton, Poll, Registration, Tip, Question, FeedbackSurvey, Webhook, WebinarDocument, EmailSequence, SocialPost, ChatMessage } from "@shared/schema";
import type { FeedbackResponse } from "@shared/schema";
import type { CourseMarketplaceOwnerDto } from "@shared/courseMarketplace";
import { useAdminLang, type LangAdmin } from "@/hooks/use-lang";
import { SellCaseLogo } from "@/components/sellcase-logo";
import {
  isValidGtmContainerId,
  isValidMetaPixelId,
  type TrackingWebinar,
} from "@/components/webinar-tracking-provider";
import { VideoSourcePicker } from "@/components/media-picker";
import { SalesTemplateChooser, type SalesTemplate } from "@/components/sales-template-chooser";
import { createSalesPageTemplate } from "@shared/salesPageTemplates";
import { ExternalJourneyPanel } from "@/components/external-journey-panel";
import { SessionRegistrationCounts, type SessionRegistrationCountsDto } from "@/components/session-registration-counts";
import { SalesScriptGenerator } from "@/components/sales-script-generator";

function toLocalDateTimeInput(value: Date | string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

interface AnalyticsResponse {
  webinar: Webinar;
  summary: {
    totalRegistrations: number;
    attended: number;
    attendanceRate: number;
    avgWatchTime: number;
    videoDuration: number;
  };
  analytics: Array<{
    id: string;
    webinarId: string;
    sessionDate: Date;
    registrations: number | null;
    attendees: number | null;
  }>;
  registrations: Registration[];
}

interface FunnelAnalyticsResponse {
  webinarId: string;
  range: { from: string | null; to: string | null };
  counts: Record<string, number>;
  uniqueViewers: number;
  uniqueByStage: Record<string, number>;
  stageConversionRates: Array<{ from: string; to: string; rate: number }>;
  ctaPerformance: Array<{
    ctaKey: string;
    views: number;
    clicks: number;
    uniqueViews: number;
    uniqueClicks: number;
    clickThroughRate: number;
  }>;
  dropoffBuckets: Array<{ range: string; count: number }>;
  revenue: Record<string, number>;
  checkoutToPurchaseRate: number;
}

interface WebinarOfferView {
  id: string;
  name: string;
  amountMinor: number;
  currency: string;
  checkoutMode: "payment";
  paymentProvider: "stripe" | "ecpay";
  active?: boolean;
}
interface SalesPageView {
  id: string;
  offerId: string;
  slug: string;
  status: "draft" | "published";
  title?: string;
}

interface LeadInsight {
  registrationId: string;
  score: number;
  stage: string;
  temperature: string;
  lastActivityAt: string | null;
  recommendation: { title: string; description: string; action: string };
  evidenceCount: number;
}

interface LeadInsightsResponse {
  summary: { total: number; cold: number; warm: number; hot: number; customers: number; refunded: number };
  pagination: { total: number; limit: number; offset: number; hasMore: boolean };
  leads: LeadInsight[];
}

interface LeadInsightDetail extends LeadInsight {
  evidence: Array<{ type: string; label: string; points: number; occurredAt: string }>;
  timeline: Array<{
    id: string;
    eventType: string;
    label: string;
    occurredAt: string;
    positionSeconds: number | null;
    amountMinor: number | null;
    currency: string | null;
    ctaKey: string | null;
  }>;
}
const funnelStageLabels: Record<string, string> = {
  landing_view: "落地頁",
  registration: "報名",
  webinar_enter: "進入直播",
  cta_view: "看到 CTA",
  cta_click: "點擊 CTA",
  checkout_start: "開始結帳",
  purchase: "購買",
};

function formatMinorCurrency(currency: string, amountMinor: number) {
  const formatter = new Intl.NumberFormat(undefined, { style: "currency", currency });
  const digits = formatter.resolvedOptions().maximumFractionDigits ?? 2;
  return formatter.format(amountMinor / (10 ** digits));
}
const t: Record<LangAdmin, Record<string, string>> = {
  "zh-TW": {
    valEnterName: "請輸入名稱",
    valSelectFakeUser: "請選擇假人",
    valEnterMessage: "請輸入訊息",
    valEnterTriggerTime: "請輸入觸發時間",
    valEnterButtonText: "請輸入按鈕文字",
    valEnterValidUrl: "請輸入有效網址",
    valEnterStartTime: "請輸入開始時間",
    valEnterQuestion: "請輸入問題",
    valEnterOptions: "請輸入選項（用逗號分隔）",
    valEnterTitle: "請輸入標題",
    valEnterContent: "請輸入內容",
    toastFakeUserCreated: "假人已建立",
    toastScheduledMsgCreated: "預排訊息已建立",
    toastCtaCreated: "CTA 按鈕已建立",
    toastPollCreated: "投票已建立",
    toastTipCreated: "小提示已建立",
    toastSettingsSaved: "設定已儲存",
    toastSaveFailed: "儲存失敗",
    toastQuestionAnswered: "已回覆問題",
    toastDeleted: "已刪除",
    toastWebhookCreated: "Webhook 已建立",
    toastCreateFailed: "建立失敗",
    toastWebhookDeleted: "Webhook 已刪除",
    toastCopied: "已複製到剪貼簿",
    toastUploadFailed: "上傳失敗",
    toastCoverUploaded: "封面上傳成功",
    toastSessionAdded: "場次已新增",
    toastAddFailed: "新增失敗",
    toastSessionsGenerated: "已產生未來 30 天的場次",
    toastGenerateFailed: "產生場次失敗",
    toastSessionDeleted: "場次已刪除",
    toastDeleteFailed: "刪除失敗",
    toastEnterTargetUrl: "請輸入目標網址",
    toastDefaultSurveyCreated: "預設問卷已建立",
    toastEmbedCodeCopied: "已複製嵌入代碼",
    toastScriptCodeCopied: "已複製 Script 代碼",
    toastButtonCodeCopied: "已複製按鈕代碼",
    toastCopiedSimple: "已複製",
    toastInlineCodeCopied: "已複製內嵌代碼",
    notFound: "找不到此直播間",
    placeholderTitle: "直播標題",
    placeholderVimeoUrl: "Vimeo 網址",
    placeholderDescription: "直播描述（選填）",
    labelCoverImage: "封面圖片",
    altCoverPreview: "封面預覽",
    clickUploadCover: "點擊上傳封面圖片",
    uploading: "上傳中...",
    placeholderImageUrl: "或輸入圖片網址",
    btnSave: "儲存",
    btnCancel: "取消",
    btnEdit: "編輯",
    valClockFormat: "請用「分:秒」格式，例如 5:30 或 1:05:30",
    valPollOptionsMin: "投票至少要有 2 個選項，用逗號分隔",
    editCtaTitle: "編輯 CTA 按鈕",
    editCtaAria: "編輯 CTA",
    editPollTitle: "編輯投票",
    editTipTitle: "編輯小提示",
    editFakeUserTitle: "編輯假人",
    editMessageTitle: "編輯預排訊息",
    toastPollUpdated: "投票已更新",
    toastTipUpdated: "小提示已更新",
    toastFakeUserUpdated: "假人已更新",
    toastMessageUpdated: "預排訊息已更新",
    toastSessionMoved: "場次時間已更新",
    toastSurveyUpdated: "問卷已更新",
    toastSurveyOn: "問卷已啟用",
    toastSurveyOff: "問卷已停用",
    sessionNewTimeAria: "新的場次時間",
    sessionEditAria: "修改場次時間",
    surveyEnableAria: "啟用回饋問卷",
    surveyEditTitle: "編輯回饋問卷",
    surveyEditDesc: "題目改了之後，舊的統計仍照原題目編號計算；刪掉的題目不再顯示統計。",
    surveyTitleLabel: "問卷標題",
    surveyQuestionPrefix: "第 ",
    surveyQuestionSuffix: " 題",
    surveyDeleteQuestion: "刪除這題",
    surveyQuestionPlaceholder: "題目",
    surveyOptionsPlaceholder: "選項，用逗號分隔",
    surveyAddQuestion: "新增題目",
    surveyNeedTitle: "請填問卷標題",
    surveyNeedQuestion: "問卷至少要有 1 題",
    surveyQuestionEmpty: "每一題都要填題目",
    surveyOptionsMin: "選擇題至少要有 2 個選項：",
    confirmDeleteTitle: "確定要刪除嗎？",
    confirmDeleteDesc: "刪除後無法復原。",
    confirmDeleteSessionTitle: "這個場次已經有人報名",
    confirmDeleteSessionDesc: "已有 {n} 人報名這個場次。刪除後，他們不會收到這個場次的提醒，也無法在這個時間觀看。確定要刪除嗎？",
    btnDeleteConfirm: "刪除",
    headerSubtitle: "直播間設定",
    btnLiveControl: "即時控制台",
    tabSchedule: "排程",
    tabNotifications: "通知",
    tabInteractions: "互動",
    tabChat: "聊天",
    tabRegistrations: "報名",
    tabAnalytics: "分析",
    tabSettings: "設定",
    tabAi: "AI 助教",
    aiTrainingTitle: "AI 訓練區",
    aiTrainingDesc: "確認 AI 助教已具備足夠知識，並快速完成上線前的必要設定。",
    aiTrainingReady: "已準備好啟用",
    aiTrainingNeedsDocs: "需要加入知識內容",
    aiTrainingActive: "AI 回覆已啟用",
    aiTrainingInactive: "AI 回覆尚未啟用",
    aiTrainingDocs: "知識文檔",
    aiTrainingCharacters: "訓練字數",
    aiTrainingPoints: "可用 AI 點數",
    aiTrainingUnlimited: "無限",
    aiTrainingAddKnowledge: "管理知識文檔",
    aiTrainingConfigure: "調整回覆設定",
    aiTestTitle: "試問 AI",
    aiTestDesc: "使用目前知識文檔與回覆設定預覽答案；內容不會出現在聊天室或觀眾端。",
    aiTestPlaceholder: "輸入觀眾可能會問的問題...",
    aiTestSubmit: "送出試問",
    aiTestCost: "每次試問消耗 1 點 AI 點數；模型失敗會自動退回。",
    aiTestNoDocs: "請先新增知識文檔後再試問。",
    aiTestAnswer: "AI 預覽回答",
    aiTitle: "AI 自動回覆設定",
    aiDesc: "啟用後，當觀眾在聊天室提問，AI 會根據你提供的資料，以老師名義自動回覆該觀眾。",
    aiEnabledLabel: "啟用 AI 自動回覆",
    aiEnabledHint: "只會回覆「看起來像問題」的訊息，節省成本。",
    aiTeacherName: "回覆時顯示的老師名稱",
    aiTeacherNamePlaceholder: "例如：王老師",
    aiSaveSettings: "儲存設定",
    aiDocsTitle: "知識文檔",
    aiDocsDesc: "貼上課程講義、產品資料、常見問答等內容，AI 會根據這些資料回答觀眾。",
    aiAddDoc: "新增文檔",
    aiDocDialogTitle: "新增知識文檔",
    aiDocTitle: "標題",
    aiDocTitlePlaceholder: "例如：課程大綱",
    aiDocContent: "內容（直接貼上文字）",
    aiDocContentPlaceholder: "在此貼上文字內容...",
    aiSrtUpload: "上傳 SRT 字幕檔",
    aiSrtHint: "上傳整部影片的 .srt 字幕，系統自動去除時間碼與編號，轉成 AI 知識內容",
    aiSrtLoaded: "字幕已載入，可編輯後儲存",
    aiSrtInvalid: "無法讀取字幕檔",
    aiNoDocs: "尚未新增任何文檔",
    aiDocSaved: "文檔已新增",
    aiSettingsSaved: "AI 設定已儲存",
    aiFallbackLabel: "答不出來時的自訂回覆",
    aiFallbackHint: "AI 無法從文檔找到答案時，會改用這段話回覆（留空則用預設行為）。",
    aiFallbackPlaceholder: "例如：這題我等等私訊您詳細說明～",
    cfTitle: "報名表單自訂欄位",
    cfDesc: "除了姓名/Email/電話，可額外蒐集公司、職稱、問題等資訊。",
    cfAddField: "新增欄位",
    cfLabel: "欄位名稱",
    cfLabelPlaceholder: "例如：公司名稱",
    cfType: "欄位類型",
    cfTypeText: "單行文字",
    cfTypeTextarea: "多行文字",
    cfTypeSelect: "下拉選單",
    cfTypeCheckbox: "勾選框",
    cfRequired: "必填",
    cfOptions: "選項（逗號分隔）",
    cfOptionsPlaceholder: "選項A, 選項B, 選項C",
    cfSave: "儲存欄位",
    cfSaved: "自訂欄位已儲存",
    cfNoFields: "尚未新增自訂欄位",
    scTitle: "稀缺感 / 倒數",
    scDesc: "在報名頁營造急迫感，提升報名與出席率。",
    scCountdown: "顯示距開始倒數",
    scCountdownHint: "報名頁顯示「距開始 03:42」倒數計時。",
    scSeats: "顯示名額有限",
    scSeatsHint: "顯示剩餘名額，營造稀缺感。",
    scTotalSeats: "總名額",
    scUrgency: "自訂催促文字",
    scUrgencyPlaceholder: "例如：名額有限，立即報名！",
    scSave: "儲存設定",
    scSaved: "稀缺感設定已儲存",
    pgTitle: "感謝頁 / 重播頁",
    pgThankYou: "感謝頁（報名完成後）",
    pgThankYouEnable: "啟用自訂感謝頁",
    pgReplay: "重播 / 結束頁",
    pgHeadline: "標題",
    pgMessage: "訊息內容",
    pgCtaText: "按鈕文字",
    pgCtaUrl: "按鈕連結",
    pgSave: "儲存頁面設定",
    pgSaved: "頁面設定已儲存",
    ntQuestionNotify: "有人發問時通知我",
    ntQuestionNotifyHint: "觀眾提交問題時，寄 Email 通知主持人。",
    ntEmail: "通知 Email（留空則寄到帳號 Email）",
    ntSave: "儲存通知設定",
    ntSaved: "通知設定已儲存",
    tagLabel: "標籤",
    tagEdit: "編輯標籤",
    tagPlaceholder: "標籤以逗號分隔，例如：VIP, 已聯絡",
    tagSave: "儲存",
    tagCancel: "取消",
    tagSaved: "標籤已更新",
    tagFilter: "依標籤篩選",
    tagAll: "全部",
    schedNavTitle: "排程",
    schedNavEventSettings: "活動設定",
    schedNavScheduledWebinars: "排程場次",
    schedNavOnDemand: "隨選觀看",
    schedNavJustInTime: "即時開始",
    schedNavReplays: "重播設定",
    schedNavSessionMgmt: "場次管理",
    schedEventSettingsTitle: "活動設定",
    schedEventType: "活動類型",
    schedRecurring: "循環排程",
    schedOneTime: "單次活動",
    schedSpecificDates: "指定日期時間",
    schedOnDemandOnly: "僅隨選",
    schedStartDate: "開始日期",
    schedEndDate: "結束日期",
    schedNeverEnd: "永不結束",
    schedSpecifyEndDate: "指定結束日期",
    schedTimezone: "時區",
    schedAttendeeTimezone: "觀眾所在時區",
    schedFixedTimezone: "固定時區",
    schedShowTimezoneOnForm: "在報名表單顯示時區",
    schedSaveEventSettings: "儲存活動設定",
    tzTaipei: "台北",
    tzTokyo: "東京",
    tzShanghai: "上海",
    tzHongKong: "香港",
    tzNewYork: "紐約",
    tzLosAngeles: "洛杉磯",
    tzLondon: "倫敦",
    tzParis: "巴黎",
    tzSydney: "雪梨",
    schedScheduledTitle: "排程場次",
    schedScheduledDesc: "儲存後會自動排出接下來 14 天的場次；每一場時間一過，報名表就自動改成下一場，不需要手動產生。",
    schedJitOverridesRecurring: "「即時開始」目前是開啟的，報名表會先列出「即時開始」場次。只想用上面的固定時段，請到左側「即時開始」停用。",
    schedJitDisable: "停用即時開始",
    schedNeedDaysAndTimes: "請至少勾選一天，並加入至少一個時段",
    schedBadExcludeDates: "排除日期格式要像 2026-01-01，多個日期用逗號分隔",
    schedEveryDay: "每天",
    schedEveryWeek: "每週",
    schedEveryTwoWeeks: "每兩週",
    schedAt: "於",
    schedDayMon: "一",
    schedDayTue: "二",
    schedDayWed: "三",
    schedDayThu: "四",
    schedDayFri: "五",
    schedDaySat: "六",
    schedDaySun: "日",
    schedAtFollowingTimes: "於以下時間：",
    schedExcludeDates: "排除日期（用逗號分隔）",
    schedSaveRecurring: "儲存排程設定",
    schedGenerateSessions: "產生未來 30 天場次",
    schedOnDemandTitle: "隨選觀看",
    schedOnDemandDesc: "觀眾可以隨時觀看直播錄影",
    schedOnDemandNote: "啟用隨選觀看模式後，觀眾無需等待特定時間即可觀看。",
    schedEnableOnDemand: "啟用隨選觀看",
    schedJitTitle: "即時開始",
    schedJitDesc: "觀眾進入後，在指定分鐘內自動開始直播",
    schedJitWaitMinutes: "等待分鐘數",
    schedJitNote: "觀眾進入後，下一場將在此分鐘數內開始",
    schedSaveJit: "儲存即時開始設定",
    schedReplaysTitle: "重播設定",
    schedReplaysDesc: "直播結束後的重播影片設定",
    schedEnableReplay: "啟用重播",
    schedReplayHours: "重播可用時數",
    schedReplayNote: "直播結束後，重播影片的可用時數",
    schedSaveReplay: "儲存重播設定",
    schedSessionMgmtTitle: "場次管理",
    schedSessionMgmtDesc: "新增直播場次讓觀眾在報名時自行選擇",
    schedAddSession: "新增場次",
    schedSessionUpcoming: "即將到來",
    schedSessionExpired: "已過期",
    schedNoSessions: "尚未新增場次，觀眾將無法選擇時段",
    schedCurrentMode: "目前排程模式",
    schedModeFixed: "固定時間",
    schedModeRecurring: "循環排程",
    schedModeOnDemand: "隨選觀看",
    schedModeJustInTime: "即時開始",
    schedActiveBadge: "✓ 使用中",
    schedSessionNotNeeded: "可新增未來預約場次，並與「隨到隨看」、「即時開始」同時開放；觀眾可在報名時自行選擇。",
    notifEmailTitle: "郵件設定",
    notifEmailDesc: "控制自動郵件通知的開關和內容",
    notifEmailConfirmation: "報名確認信",
    notifEmail24h: "24 小時前提醒",
    notifEmail1h: "1 小時前提醒",
    notifEmailFollowUp: "結束後跟進信",
    notifEmailSubject: "自訂郵件主旨（選填）",
    notifEmailSubjectPlaceholder: "留空使用預設主旨",
    notifEmailTemplate: "自訂郵件模板（選填）",
    notifEmailTemplatePlaceholder: "留空使用預設模板，支援 HTML",
    notifSaveEmail: "儲存郵件設定",
    notifWebhookTitle: "Webhook 管理",
    notifWebhookDesc: "設定事件觸發時自動通知的 Webhook",
    notifAddWebhook: "新增 Webhook",
    notifWebhookDialogTitle: "新增 Webhook",
    notifWebhookDialogDesc: "當指定事件發生時，系統會向目標網址發送 POST 請求",
    notifWebhookEventType: "事件類型",
    notifWebhookRegistration: "報名 (registration)",
    notifWebhookAttendance: "出席 (attendance)",
    notifWebhookCompletion: "完播 (completion)",
    notifWebhookTargetUrl: "目標網址",
    notifWebhookSecret: "密鑰（選填）",
    notifWebhookSecretPlaceholder: "用於驗證請求來源",
    btnCreate: "建立",
    notifWebhookEnabled: "啟用",
    notifWebhookDisabled: "停用",
    notifNoWebhooks: "尚無 Webhook",
    interCtaTitle: "CTA 按鈕",
    interCtaDesc: "在影片上顯示行動呼籲按鈕",
    interAddCta: "新增 CTA",
    interCtaDialogTitle: "新增 CTA 按鈕",
    interCtaButtonText: "按鈕文字",
    interCtaButtonTextPlaceholder: "立即報名",
    interCtaLinkUrl: "連結網址",
    interCtaStartTime: "開始時間 (分:秒)",
    interCtaEndTime: "結束時間（選填）",
    interCtaStyle: "樣式",
    interCtaStylePrimary: "主要（品牌主色，未設定則藍色）",
    interCtaStyleSecondary: "次要（灰色）",
    interCtaStyleDanger: "強調（紅色）",
    interCtaEnd: "結束",
    interNoCtaButtons: "尚無 CTA 按鈕",
    interPollTitle: "投票管理",
    interPollDesc: "影片到點後在聊天室顯示投票小卡，不遮擋影片；觀眾可直接作答或略過。",
    interAddPoll: "新增投票",
    interPollDialogTitle: "新增投票",
    interPollQuestion: "問題",
    interPollQuestionPlaceholder: "您覺得這個課程如何？",
    interPollOptions: "選項（用逗號分隔）",
    interPollOptionsPlaceholder: "非常好, 還可以, 需要改進",
    interPollTriggerTime: "觸發時間 (分:秒)",
    interPollDuration: "持續時間（秒）",
    interNoPolls: "尚無投票",
    interTipTitle: "小提示卡",
    interTipDesc: "影片到點後由小幫手發到聊天室，不再彈出提示卡；原顯示秒數不會移除聊天室訊息。",
    interAddTip: "新增提示",
    interTipDialogTitle: "新增小提示",
    interTipTitleLabel: "標題",
    interTipTitlePlaceholder: "重要提示",
    interTipContent: "內容",
    interTipContentPlaceholder: "輸入提示內容...",
    interTipTriggerTime: "觸發時間 (分:秒)",
    interTipDisplayDuration: "顯示時間（秒）",
    interTipSeconds: "秒",
    interNoTips: "尚無提示",
    interFeedbackTitle: "回饋問卷",
    interFeedbackDesc: "直播結束後向觀眾收集回饋",
    interFeedbackActive: "啟用中",
    interFeedbackInactive: "已停用",
    interFeedbackRating: "評分",
    interFeedbackText: "文字",
    interFeedbackChoice: "選擇",
    interFeedbackRequired: "必填",
    interNoSurvey: "尚未設定問卷",
    interDefaultSurveyTitle: "請給我們回饋",
    interDefaultQ1: "您對本次直播的整體評價？",
    interDefaultQ2: "您最喜歡哪個部分？",
    interDefaultQ3: "您會推薦給朋友嗎？",
    interDefaultOpt1: "一定會",
    interDefaultOpt2: "可能會",
    interDefaultOpt3: "不確定",
    interDefaultOpt4: "不會",
    interCreateDefaultSurvey: "建立預設問卷",
    interFeedbackStatsTitle: "問卷回覆統計",
    interFeedbackResponseCount: "份回覆",
    interNoFeedbackResponses: "尚無問卷回覆",
    interQaTitle: "觀眾問答",
    interQaDesc: "觀眾在直播中提交的問題",
    interQaAnonymous: "匿名",
    interQaAnswered: "已回覆",
    interQaPending: "待回覆",
    interQaReply: "回覆",
    interQaReplyPlaceholder: "輸入回覆...",
    interQaSubmit: "送出",
    interNoQuestions: "尚無問題",
    chatFakeUserTitle: "假人管理",
    chatFakeUserDesc: "建立虛擬觀眾以營造熱絡氣氛",
    chatAddFakeUser: "新增假人",
    chatFakeUserDialogTitle: "新增假人",
    chatFakeUserName: "名稱",
    chatFakeUserNamePlaceholder: "小明",
    chatNoFakeUsers: "尚無假人",
    chatScheduledMsgTitle: "預排訊息",
    chatScheduledMsgDesc: "設定在特定時間自動發送的訊息",
    chatAddMessage: "新增訊息",
    chatMsgDialogTitle: "新增預排訊息",
    chatMsgSender: "發送者",
    chatMsgSelectFakeUser: "選擇假人",
    chatMsgContent: "訊息內容",
    chatMsgContentPlaceholder: "太棒了！",
    chatMsgTriggerTime: "觸發時間 (分:秒)",
    chatMsgUnknown: "未知",
    chatNoScheduledMessages: "尚無預排訊息",
    regTitle: "報名名單",
    regDesc: "已報名參加此直播的觀眾",
    regExportCsv: "匯出 CSV",
    regSource: "來源:",
    regMedium: "媒介:",
    regCampaign: "活動:",
    regAttended: "已參加",
    regNoRegistrations: "尚無報名",
    analyticsRegistrations: "報名人數",
    analyticsAttended: "參加人數",
    analyticsAttendanceRate: "出席率",
    analyticsAvgWatchTime: "平均觀看時間",
    analyticsCompletionRate: "完播率",
    analyticsAvgCompletion: "平均觀看比例",
    analyticsRegVsAttend: "報名 vs 出席",
    analyticsAttendedLabel: "已出席",
    analyticsNotAttendedLabel: "未出席",
    analyticsNoData: "尚無數據",
    analyticsWatchDuration: "觀看時長分佈",
    analyticsViewerCount: "觀眾數",
    analyticsRetention: "觀眾留存曲線",
    analyticsRetentionDesc: "觀眾在影片各時間點的留存比例",
    analyticsRetentionRate: "留存率",
    analyticsViewerDetail: "觀眾出席詳情",
    analyticsViewerDetailDesc: "每位觀眾的觀看時長、跳出時間及完播狀態",
    analyticsNoAttendance: "尚無出席記錄",
    analyticsCompleted: "已完播",
    analyticsWatchPct: "觀看",
    analyticsEntered: "進入:",
    analyticsLeft: "離開:",
    analyticsDropOff: "跳出於影片",
    analyticsDropOffSuffix: "處",
    analyticsNoAnalytics: "尚無分析數據",
    settingsWebinarInfo: "直播資訊",
    settingsWebinarInfoDesc: "編輯直播標題、描述、影片網址與封面圖片",
    settingsTitle: "直播標題",
    settingsDescription: "直播描述",
    settingsVimeoUrl: "Vimeo 網址",
    settingsStartTime: "開始時間",
    settingsCoverImage: "封面圖片",
    settingsSaveWebinarInfo: "儲存直播資訊",
    settingsBrandTitle: "品牌設定",
    settingsBrandDesc: "自訂直播間的外觀和品牌元素",
    settingsLogoUrl: "Logo 網址",
    settingsPrimaryColor: "主色調",
    settingsSecondaryColor: "副色調",
    settingsBgColor: "背景色",
    settingsLogoPreview: "Logo 預覽：",
    settingsSaveBrand: "儲存品牌設定",
    settingsLinksTitle: "直播連結",
    settingsLinksDesc: "分享報名連結給觀眾",
    settingsShareLink: "將此報名連結分享給觀眾",
    settingsEmbedRegTitle: "嵌入報名表單",
    settingsEmbedRegDesc: "將報名表單嵌入到其他網站，訪客可以直接在你的網站上報名",
    settingsPreviewEffect: "預覽效果：",
    settingsRegFormPreview: "報名表單預覽",
    settingsEmbedWebinarTitle: "嵌入直播間播放器",
    settingsEmbedWebinarDesc: "將直播間嵌入到其他網站，觀眾可直接在你的網站上觀看直播",
    settingsPopupTitle: "彈出式報名按鈕",
    settingsPopupDesc: "在其他網站加入一段 JavaScript，訪客點擊按鈕後彈出報名視窗",
    settingsAllInOne: "完整代碼（一鍵複製，直接貼上）",
    settingsAllInOneDesc: "複製這段貼到你的網頁，就會出現報名按鈕，點擊跳出報名視窗 → 報名 → 感謝頁 → 自動寄信",
    settingsCopyAll: "一鍵複製完整代碼",
    settingsStep1Script: "步驟 1：加入 Script 標籤（放在 </body> 前）",
    settingsStep2Button: "步驟 2：在按鈕上加入屬性",
    settingsOrJsCall: "或用 JavaScript 直接呼叫",
    settingsRegisterNow: "立即報名",
    settingsInlineTitle: "內嵌報名元件（Inline Widget）",
    settingsInlineDesc: "直接嵌入到其他網頁中，訪客可以選擇時段並報名，無需彈出視窗",
    settingsStep2Container: "步驟 2：在頁面中放入容器元素",
    settingsInlineNote: "報名表單會自動嵌入到該容器中，支援時段選擇、品牌設定，並且會自動調整高度。",
    totalResponsesPrefix: "共 ",
    totalResponsesSuffix: " 份回覆",
    aiGenInterTitle: "AI 一鍵生成互動",
    aiGenInterDesc: "根據逐字稿（AI 助教知識文檔），自動生成假觀眾聊天、CTA、投票、提示卡，並標好時間點。",
    aiGenInterBtn: "AI 一鍵生成互動",
    aiGenGoalLabel: "目標 / 補充（選填）",
    aiGenGoalPlaceholder: "例：推廣年度方案、引導加 LINE、強調限時優惠…",
    aiGenReplace: "生成前先清除現有內容",
    aiGenerating: "AI 生成中…可能需要 10-30 秒",
    aiGenInterSuccess: "已生成互動內容",
    aiGenFail: "AI 生成失敗，請稍後再試",
    aiGenNoPoints: "AI 點數不足，請先儲值",
    aiGenCostHint: "每次生成消耗 5 點 AI 點數",
    seqTitle: "AI 銷售追蹤電子報",
    seqDesc: "研討會結束後，依觀眾行為（看完 / 沒看完 / 沒出席）自動分眾寄送追蹤信，提升轉換。",
    seqGenBtn: "AI 生成追蹤序列",
    seqEmpty: "尚無追蹤郵件，點上方按鈕讓 AI 生成。",
    seqSegAll: "全部",
    seqSegWatched: "有看完",
    seqSegNotWatched: "沒看完",
    seqSegNoShow: "沒出席",
    seqDelayLabel: "結束後幾分鐘寄出",
    btnPreview: "預覽",
    seqSendAfter: "研討會結束後",
    emailCustomNote: "有填自訂主旨和內容時，上面 4 封信都會改用這份內容。可用 {{name}} {{title}} {{date}} {{url}}（觀眾專屬直播間連結）{{cta_url}}（報名 / 購買頁）。",
    seqLinkNote: "信裡的 {{url}} 會自動換成每位觀眾自己的直播間 / 回放連結；{{cta_url}} 會換成「互動」裡第一個有網址的 CTA 按鈕（課程報名或購買頁）。",
    seqEnabledLabel: "啟用",
    seqDelete: "刪除",
    seqGenSuccess: "已生成追蹤郵件序列",
    postTitle: "AI 行銷貼文",
    postDesc: "AI 生成各平台社群宣傳貼文草稿（無串接社群 API，請複製後自行貼到平台發佈）。",
    postGenBtn: "AI 生成貼文",
    postEmpty: "尚無貼文，點上方按鈕讓 AI 生成。",
    postCopy: "複製",
    postCopied: "已複製貼文",
    postDelete: "刪除",
    postGenSuccess: "已生成行銷貼文",
  },
  "zh-CN": {
    valEnterName: "请输入名称",
    valSelectFakeUser: "请选择假人",
    valEnterMessage: "请输入消息",
    valEnterTriggerTime: "请输入触发时间",
    valEnterButtonText: "请输入按钮文字",
    valEnterValidUrl: "请输入有效网址",
    valEnterStartTime: "请输入开始时间",
    valEnterQuestion: "请输入问题",
    valEnterOptions: "请输入选项（用逗号分隔）",
    valEnterTitle: "请输入标题",
    valEnterContent: "请输入内容",
    toastFakeUserCreated: "假人已创建",
    toastScheduledMsgCreated: "预排消息已创建",
    toastCtaCreated: "CTA 按钮已创建",
    toastPollCreated: "投票已创建",
    toastTipCreated: "小提示已创建",
    toastSettingsSaved: "设置已保存",
    toastSaveFailed: "保存失败",
    toastQuestionAnswered: "已回复问题",
    toastDeleted: "已删除",
    toastWebhookCreated: "Webhook 已创建",
    toastCreateFailed: "创建失败",
    toastWebhookDeleted: "Webhook 已删除",
    toastCopied: "已复制到剪贴板",
    toastUploadFailed: "上传失败",
    toastCoverUploaded: "封面上传成功",
    toastSessionAdded: "场次已新增",
    toastAddFailed: "新增失败",
    toastSessionsGenerated: "已生成未来 30 天的场次",
    toastGenerateFailed: "生成场次失败",
    toastSessionDeleted: "场次已删除",
    toastDeleteFailed: "删除失败",
    toastEnterTargetUrl: "请输入目标网址",
    toastDefaultSurveyCreated: "默认问卷已创建",
    toastEmbedCodeCopied: "已复制嵌入代码",
    toastScriptCodeCopied: "已复制 Script 代码",
    toastButtonCodeCopied: "已复制按钮代码",
    toastCopiedSimple: "已复制",
    toastInlineCodeCopied: "已复制内嵌代码",
    notFound: "找不到此直播间",
    placeholderTitle: "直播标题",
    placeholderVimeoUrl: "Vimeo 网址",
    placeholderDescription: "直播描述（选填）",
    labelCoverImage: "封面图片",
    altCoverPreview: "封面预览",
    clickUploadCover: "点击上传封面图片",
    uploading: "上传中...",
    placeholderImageUrl: "或输入图片网址",
    btnSave: "保存",
    btnCancel: "取消",
    btnEdit: "编辑",
    valClockFormat: "请用「分:秒」格式，例如 5:30 或 1:05:30",
    valPollOptionsMin: "投票至少要有 2 个选项，用逗号分隔",
    editCtaTitle: "编辑 CTA 按钮",
    editCtaAria: "编辑 CTA",
    editPollTitle: "编辑投票",
    editTipTitle: "编辑小提示",
    editFakeUserTitle: "编辑假人",
    editMessageTitle: "编辑预排消息",
    toastPollUpdated: "投票已更新",
    toastTipUpdated: "小提示已更新",
    toastFakeUserUpdated: "假人已更新",
    toastMessageUpdated: "预排消息已更新",
    toastSessionMoved: "场次时间已更新",
    toastSurveyUpdated: "问卷已更新",
    toastSurveyOn: "问卷已启用",
    toastSurveyOff: "问卷已停用",
    sessionNewTimeAria: "新的场次时间",
    sessionEditAria: "修改场次时间",
    surveyEnableAria: "启用反馈问卷",
    surveyEditTitle: "编辑反馈问卷",
    surveyEditDesc: "题目改了之后，旧的统计仍按原题目编号计算；删掉的题目不再显示统计。",
    surveyTitleLabel: "问卷标题",
    surveyQuestionPrefix: "第 ",
    surveyQuestionSuffix: " 题",
    surveyDeleteQuestion: "删除这题",
    surveyQuestionPlaceholder: "题目",
    surveyOptionsPlaceholder: "选项，用逗号分隔",
    surveyAddQuestion: "新增题目",
    surveyNeedTitle: "请填写问卷标题",
    surveyNeedQuestion: "问卷至少要有 1 题",
    surveyQuestionEmpty: "每一题都要填写题目",
    surveyOptionsMin: "选择题至少要有 2 个选项：",
    confirmDeleteTitle: "确定要删除吗？",
    confirmDeleteDesc: "删除后无法恢复。",
    confirmDeleteSessionTitle: "这个场次已经有人报名",
    confirmDeleteSessionDesc: "已有 {n} 人报名这个场次。删除后，他们不会收到这个场次的提醒，也无法在这个时间观看。确定要删除吗？",
    btnDeleteConfirm: "删除",
    headerSubtitle: "直播间设置",
    btnLiveControl: "实时控制台",
    tabSchedule: "排程",
    tabNotifications: "通知",
    tabInteractions: "互动",
    tabChat: "聊天",
    tabRegistrations: "报名",
    tabAnalytics: "分析",
    tabSettings: "设置",
    tabAi: "AI 助教",
    aiTrainingTitle: "AI 训练区",
    aiTrainingDesc: "确认 AI 助教已具备足够知识，并快速完成上线前的必要设置。",
    aiTrainingReady: "已准备好启用",
    aiTrainingNeedsDocs: "需要加入知识内容",
    aiTrainingActive: "AI 回复已启用",
    aiTrainingInactive: "AI 回复尚未启用",
    aiTrainingDocs: "知识文档",
    aiTrainingCharacters: "训练字数",
    aiTrainingPoints: "可用 AI 点数",
    aiTrainingUnlimited: "无限",
    aiTrainingAddKnowledge: "管理知识文档",
    aiTrainingConfigure: "调整回复设置",
    aiTestTitle: "试问 AI",
    aiTestDesc: "使用当前知识文档与回复设置预览答案；内容不会出现在聊天室或观众端。",
    aiTestPlaceholder: "输入观众可能会问的问题...",
    aiTestSubmit: "发送试问",
    aiTestCost: "每次试问消耗 1 点 AI 点数；模型失败会自动退回。",
    aiTestNoDocs: "请先新增知识文档后再试问。",
    aiTestAnswer: "AI 预览回答",
    aiTitle: "AI 自动回复设置",
    aiDesc: "启用后，当观众在聊天室提问，AI 会根据你提供的资料，以老师名义自动回复该观众。",
    aiEnabledLabel: "启用 AI 自动回复",
    aiEnabledHint: "只会回复「看起来像问题」的消息，节省成本。",
    aiTeacherName: "回复时显示的老师名称",
    aiTeacherNamePlaceholder: "例如：王老师",
    aiSaveSettings: "保存设置",
    aiDocsTitle: "知识文档",
    aiDocsDesc: "粘贴课程讲义、产品资料、常见问答等内容，AI 会根据这些资料回答观众。",
    aiAddDoc: "新增文档",
    aiDocDialogTitle: "新增知识文档",
    aiDocTitle: "标题",
    aiDocTitlePlaceholder: "例如：课程大纲",
    aiDocContent: "内容（直接粘贴文字）",
    aiDocContentPlaceholder: "在此粘贴文字内容...",
    aiSrtUpload: "上传 SRT 字幕档",
    aiSrtHint: "上传整部视频的 .srt 字幕，系统自动去除时间码与编号，转成 AI 知识内容",
    aiSrtLoaded: "字幕已载入，可编辑后保存",
    aiSrtInvalid: "无法读取字幕档",
    aiNoDocs: "尚未新增任何文档",
    aiDocSaved: "文档已新增",
    aiSettingsSaved: "AI 设置已保存",
    aiFallbackLabel: "答不出来时的自订回复",
    aiFallbackHint: "AI 无法从文档找到答案时，会改用这段话回复（留空则用预设行为）。",
    aiFallbackPlaceholder: "例如：这题我等等私讯您详细说明～",
    cfTitle: "报名表单自订栏位",
    cfDesc: "除了姓名/Email/电话，可额外搜集公司、职称、问题等资讯。",
    cfAddField: "新增栏位",
    cfLabel: "栏位名称",
    cfLabelPlaceholder: "例如：公司名称",
    cfType: "栏位类型",
    cfTypeText: "单行文字",
    cfTypeTextarea: "多行文字",
    cfTypeSelect: "下拉选单",
    cfTypeCheckbox: "勾选框",
    cfRequired: "必填",
    cfOptions: "选项（逗号分隔）",
    cfOptionsPlaceholder: "选项A, 选项B, 选项C",
    cfSave: "储存栏位",
    cfSaved: "自订栏位已储存",
    cfNoFields: "尚未新增自订栏位",
    scTitle: "稀缺感 / 倒数",
    scDesc: "在报名页营造急迫感，提升报名与出席率。",
    scCountdown: "显示距开始倒数",
    scCountdownHint: "报名页显示「距开始 03:42」倒数计时。",
    scSeats: "显示名额有限",
    scSeatsHint: "显示剩余名额，营造稀缺感。",
    scTotalSeats: "总名额",
    scUrgency: "自订催促文字",
    scUrgencyPlaceholder: "例如：名额有限，立即报名！",
    scSave: "储存设置",
    scSaved: "稀缺感设置已保存",
    pgTitle: "感谢页 / 重播页",
    pgThankYou: "感谢页（报名完成后）",
    pgThankYouEnable: "启用自订感谢页",
    pgReplay: "重播 / 结束页",
    pgHeadline: "标题",
    pgMessage: "讯息内容",
    pgCtaText: "按钮文字",
    pgCtaUrl: "按钮连结",
    pgSave: "储存页面设置",
    pgSaved: "页面设置已保存",
    ntQuestionNotify: "有人发问时通知我",
    ntQuestionNotifyHint: "观众提交问题时，寄 Email 通知主持人。",
    ntEmail: "通知 Email（留空则寄到账号 Email）",
    ntSave: "储存通知设置",
    ntSaved: "通知设置已保存",
    tagLabel: "标签",
    tagEdit: "编辑标签",
    tagPlaceholder: "标签以逗号分隔，例如：VIP, 已联络",
    tagSave: "储存",
    tagCancel: "取消",
    tagSaved: "标签已更新",
    tagFilter: "依标签筛选",
    tagAll: "全部",
    schedNavTitle: "排程",
    schedNavEventSettings: "活动设置",
    schedNavScheduledWebinars: "排程场次",
    schedNavOnDemand: "随选观看",
    schedNavJustInTime: "即时开始",
    schedNavReplays: "重播设置",
    schedNavSessionMgmt: "场次管理",
    schedEventSettingsTitle: "活动设置",
    schedEventType: "活动类型",
    schedRecurring: "循环排程",
    schedOneTime: "单次活动",
    schedSpecificDates: "指定日期时间",
    schedOnDemandOnly: "仅随选",
    schedStartDate: "开始日期",
    schedEndDate: "结束日期",
    schedNeverEnd: "永不结束",
    schedSpecifyEndDate: "指定结束日期",
    schedTimezone: "时区",
    schedAttendeeTimezone: "观众所在时区",
    schedFixedTimezone: "固定时区",
    schedShowTimezoneOnForm: "在报名表单显示时区",
    schedSaveEventSettings: "保存活动设置",
    tzTaipei: "台北",
    tzTokyo: "东京",
    tzShanghai: "上海",
    tzHongKong: "香港",
    tzNewYork: "纽约",
    tzLosAngeles: "洛杉矶",
    tzLondon: "伦敦",
    tzParis: "巴黎",
    tzSydney: "悉尼",
    schedScheduledTitle: "排程场次",
    schedScheduledDesc: "保存后会自动排出接下来 14 天的场次；每一场时间一过，报名表就自动改成下一场，不需要手动生成。",
    schedJitOverridesRecurring: "「即时开始」目前是开启的，报名表会先列出「即时开始」场次。只想用上面的固定时段，请到左侧「即时开始」停用。",
    schedJitDisable: "停用即时开始",
    schedNeedDaysAndTimes: "请至少勾选一天，并加入至少一个时段",
    schedBadExcludeDates: "排除日期格式要像 2026-01-01，多个日期用逗号分隔",
    schedEveryDay: "每天",
    schedEveryWeek: "每周",
    schedEveryTwoWeeks: "每两周",
    schedAt: "于",
    schedDayMon: "一",
    schedDayTue: "二",
    schedDayWed: "三",
    schedDayThu: "四",
    schedDayFri: "五",
    schedDaySat: "六",
    schedDaySun: "日",
    schedAtFollowingTimes: "于以下时间：",
    schedExcludeDates: "排除日期（用逗号分隔）",
    schedSaveRecurring: "保存排程设置",
    schedGenerateSessions: "生成未来 30 天场次",
    schedOnDemandTitle: "随选观看",
    schedOnDemandDesc: "观众可以随时观看直播录像",
    schedOnDemandNote: "启用随选观看模式后，观众无需等待特定时间即可观看。",
    schedEnableOnDemand: "启用随选观看",
    schedJitTitle: "即时开始",
    schedJitDesc: "观众进入后，在指定分钟内自动开始直播",
    schedJitWaitMinutes: "等待分钟数",
    schedJitNote: "观众进入后，下一场将在此分钟数内开始",
    schedSaveJit: "保存即时开始设置",
    schedReplaysTitle: "重播设置",
    schedReplaysDesc: "直播结束后的重播视频设置",
    schedEnableReplay: "启用重播",
    schedReplayHours: "重播可用时数",
    schedReplayNote: "直播结束后，重播视频的可用时数",
    schedSaveReplay: "保存重播设置",
    schedSessionMgmtTitle: "场次管理",
    schedSessionMgmtDesc: "新增直播场次让观众在报名时自行选择",
    schedAddSession: "新增场次",
    schedSessionUpcoming: "即将到来",
    schedSessionExpired: "已过期",
    schedNoSessions: "尚未新增场次，观众将无法选择时段",
    schedCurrentMode: "当前排程模式",
    schedModeFixed: "固定时间",
    schedModeRecurring: "循环排程",
    schedModeOnDemand: "随选观看",
    schedModeJustInTime: "即时开始",
    schedActiveBadge: "✓ 使用中",
    schedSessionNotNeeded: "可新增未来预约场次，并与「随到随看」、「即时开始」同时开放；观众可在报名时自行选择。",
    notifEmailTitle: "邮件设置",
    notifEmailDesc: "控制自动邮件通知的开关和内容",
    notifEmailConfirmation: "报名确认信",
    notifEmail24h: "24 小时前提醒",
    notifEmail1h: "1 小时前提醒",
    notifEmailFollowUp: "结束后跟进信",
    notifEmailSubject: "自定义邮件主旨（选填）",
    notifEmailSubjectPlaceholder: "留空使用默认主旨",
    notifEmailTemplate: "自定义邮件模板（选填）",
    notifEmailTemplatePlaceholder: "留空使用默认模板，支持 HTML",
    notifSaveEmail: "保存邮件设置",
    notifWebhookTitle: "Webhook 管理",
    notifWebhookDesc: "设置事件触发时自动通知的 Webhook",
    notifAddWebhook: "新增 Webhook",
    notifWebhookDialogTitle: "新增 Webhook",
    notifWebhookDialogDesc: "当指定事件发生时，系统会向目标网址发送 POST 请求",
    notifWebhookEventType: "事件类型",
    notifWebhookRegistration: "报名 (registration)",
    notifWebhookAttendance: "出席 (attendance)",
    notifWebhookCompletion: "完播 (completion)",
    notifWebhookTargetUrl: "目标网址",
    notifWebhookSecret: "密钥（选填）",
    notifWebhookSecretPlaceholder: "用于验证请求来源",
    btnCreate: "创建",
    notifWebhookEnabled: "启用",
    notifWebhookDisabled: "停用",
    notifNoWebhooks: "尚无 Webhook",
    interCtaTitle: "CTA 按钮",
    interCtaDesc: "在视频上显示行动呼吁按钮",
    interAddCta: "新增 CTA",
    interCtaDialogTitle: "新增 CTA 按钮",
    interCtaButtonText: "按钮文字",
    interCtaButtonTextPlaceholder: "立即报名",
    interCtaLinkUrl: "链接网址",
    interCtaStartTime: "开始时间 (分:秒)",
    interCtaEndTime: "结束时间（选填）",
    interCtaStyle: "样式",
    interCtaStylePrimary: "主要（品牌主色，未设置则蓝色）",
    interCtaStyleSecondary: "次要（灰色）",
    interCtaStyleDanger: "强调（红色）",
    interCtaEnd: "结束",
    interNoCtaButtons: "尚无 CTA 按钮",
    interPollTitle: "投票管理",
    interPollDesc: "设置在特定时间弹出的投票问题",
    interAddPoll: "新增投票",
    interPollDialogTitle: "新增投票",
    interPollQuestion: "问题",
    interPollQuestionPlaceholder: "您觉得这个课程如何？",
    interPollOptions: "选项（用逗号分隔）",
    interPollOptionsPlaceholder: "非常好, 还可以, 需要改进",
    interPollTriggerTime: "触发时间 (分:秒)",
    interPollDuration: "持续时间（秒）",
    interNoPolls: "尚无投票",
    interTipTitle: "小提示卡",
    interTipDesc: "在特定时间点显示的提示消息",
    interAddTip: "新增提示",
    interTipDialogTitle: "新增小提示",
    interTipTitleLabel: "标题",
    interTipTitlePlaceholder: "重要提示",
    interTipContent: "内容",
    interTipContentPlaceholder: "输入提示内容...",
    interTipTriggerTime: "触发时间 (分:秒)",
    interTipDisplayDuration: "显示时间（秒）",
    interTipSeconds: "秒",
    interNoTips: "尚无提示",
    interFeedbackTitle: "反馈问卷",
    interFeedbackDesc: "直播结束后向观众收集反馈",
    interFeedbackActive: "启用中",
    interFeedbackInactive: "已停用",
    interFeedbackRating: "评分",
    interFeedbackText: "文字",
    interFeedbackChoice: "选择",
    interFeedbackRequired: "必填",
    interNoSurvey: "尚未设置问卷",
    interDefaultSurveyTitle: "请给我们反馈",
    interDefaultQ1: "您对本次直播的整体评价？",
    interDefaultQ2: "您最喜欢哪个部分？",
    interDefaultQ3: "您会推荐给朋友吗？",
    interDefaultOpt1: "一定会",
    interDefaultOpt2: "可能会",
    interDefaultOpt3: "不确定",
    interDefaultOpt4: "不会",
    interCreateDefaultSurvey: "创建默认问卷",
    interFeedbackStatsTitle: "问卷回复统计",
    interFeedbackResponseCount: "份回复",
    interNoFeedbackResponses: "尚无问卷回复",
    interQaTitle: "观众问答",
    interQaDesc: "观众在直播中提交的问题",
    interQaAnonymous: "匿名",
    interQaAnswered: "已回复",
    interQaPending: "待回复",
    interQaReply: "回复",
    interQaReplyPlaceholder: "输入回复...",
    interQaSubmit: "提交",
    interNoQuestions: "尚无问题",
    chatFakeUserTitle: "假人管理",
    chatFakeUserDesc: "创建虚拟观众以营造热烈气氛",
    chatAddFakeUser: "新增假人",
    chatFakeUserDialogTitle: "新增假人",
    chatFakeUserName: "名称",
    chatFakeUserNamePlaceholder: "小明",
    chatNoFakeUsers: "尚无假人",
    chatScheduledMsgTitle: "预排消息",
    chatScheduledMsgDesc: "设置在特定时间自动发送的消息",
    chatAddMessage: "新增消息",
    chatMsgDialogTitle: "新增预排消息",
    chatMsgSender: "发送者",
    chatMsgSelectFakeUser: "选择假人",
    chatMsgContent: "消息内容",
    chatMsgContentPlaceholder: "太棒了！",
    chatMsgTriggerTime: "触发时间 (分:秒)",
    chatMsgUnknown: "未知",
    chatNoScheduledMessages: "尚无预排消息",
    regTitle: "报名名单",
    regDesc: "已报名参加此直播的观众",
    regExportCsv: "导出 CSV",
    regSource: "来源:",
    regMedium: "媒介:",
    regCampaign: "活动:",
    regAttended: "已参加",
    regNoRegistrations: "尚无报名",
    analyticsRegistrations: "报名人数",
    analyticsAttended: "参加人数",
    analyticsAttendanceRate: "出席率",
    analyticsAvgWatchTime: "平均观看时间",
    analyticsCompletionRate: "完播率",
    analyticsAvgCompletion: "平均观看比例",
    analyticsRegVsAttend: "报名 vs 出席",
    analyticsAttendedLabel: "已出席",
    analyticsNotAttendedLabel: "未出席",
    analyticsNoData: "尚无数据",
    analyticsWatchDuration: "观看时长分布",
    analyticsViewerCount: "观众数",
    analyticsRetention: "观众留存曲线",
    analyticsRetentionDesc: "观众在视频各时间点的留存比例",
    analyticsRetentionRate: "留存率",
    analyticsViewerDetail: "观众出席详情",
    analyticsViewerDetailDesc: "每位观众的观看时长、跳出时间及完播状态",
    analyticsNoAttendance: "尚无出席记录",
    analyticsCompleted: "已完播",
    analyticsWatchPct: "观看",
    analyticsEntered: "进入:",
    analyticsLeft: "离开:",
    analyticsDropOff: "跳出于视频",
    analyticsDropOffSuffix: "处",
    analyticsNoAnalytics: "尚无分析数据",
    settingsWebinarInfo: "直播信息",
    settingsWebinarInfoDesc: "编辑直播标题、描述、视频网址与封面图片",
    settingsTitle: "直播标题",
    settingsDescription: "直播描述",
    settingsVimeoUrl: "Vimeo 网址",
    settingsStartTime: "开始时间",
    settingsCoverImage: "封面图片",
    settingsSaveWebinarInfo: "保存直播信息",
    settingsBrandTitle: "品牌设置",
    settingsBrandDesc: "自定义直播间的外观和品牌元素",
    settingsLogoUrl: "Logo 网址",
    settingsPrimaryColor: "主色调",
    settingsSecondaryColor: "副色调",
    settingsBgColor: "背景色",
    settingsLogoPreview: "Logo 预览：",
    settingsSaveBrand: "保存品牌设置",
    settingsLinksTitle: "直播链接",
    settingsLinksDesc: "分享报名链接给观众",
    settingsShareLink: "将此报名链接分享给观众",
    settingsEmbedRegTitle: "嵌入报名表单",
    settingsEmbedRegDesc: "将报名表单嵌入到其他网站，访客可以直接在你的网站上报名",
    settingsPreviewEffect: "预览效果：",
    settingsRegFormPreview: "报名表单预览",
    settingsEmbedWebinarTitle: "嵌入直播间播放器",
    settingsEmbedWebinarDesc: "将直播间嵌入到其他网站，观众可直接在你的网站上观看直播",
    settingsPopupTitle: "弹出式报名按钮",
    settingsPopupDesc: "在其他网站加入一段 JavaScript，访客点击按钮后弹出报名窗口",
    settingsAllInOne: "完整代码（一键复制，直接粘贴）",
    settingsAllInOneDesc: "复制这段贴到你的网页，就会出现报名按钮，点击弹出报名窗口 → 报名 → 感谢页 → 自动寄信",
    settingsCopyAll: "一键复制完整代码",
    settingsStep1Script: "步骤 1：加入 Script 标签（放在 </body> 前）",
    settingsStep2Button: "步骤 2：在按钮上加入属性",
    settingsOrJsCall: "或用 JavaScript 直接调用",
    settingsRegisterNow: "立即报名",
    settingsInlineTitle: "内嵌报名组件（Inline Widget）",
    settingsInlineDesc: "直接嵌入到其他网页中，访客可以选择时段并报名，无需弹出窗口",
    settingsStep2Container: "步骤 2：在页面中放入容器元素",
    settingsInlineNote: "报名表单会自动嵌入到该容器中，支持时段选择、品牌设置，并且会自动调整高度。",
    totalResponsesPrefix: "共 ",
    totalResponsesSuffix: " 份回复",
    aiGenInterTitle: "AI 一键生成互动",
    aiGenInterDesc: "根据逐字稿（AI 助教知识文档），自动生成假观众聊天、CTA、投票、提示卡，并标好时间点。",
    aiGenInterBtn: "AI 一键生成互动",
    aiGenGoalLabel: "目标 / 补充（选填）",
    aiGenGoalPlaceholder: "例：推广年度方案、引导加微信、强调限时优惠…",
    aiGenReplace: "生成前先清除现有内容",
    aiGenerating: "AI 生成中…可能需要 10-30 秒",
    aiGenInterSuccess: "已生成互动内容",
    aiGenFail: "AI 生成失败，请稍后再试",
    aiGenNoPoints: "AI 点数不足，请先储值",
    aiGenCostHint: "每次生成消耗 5 点 AI 点数",
    seqTitle: "AI 销售追踪电子报",
    seqDesc: "研讨会结束后，依观众行为（看完 / 没看完 / 没出席）自动分众寄送追踪信，提升转换。",
    seqGenBtn: "AI 生成追踪序列",
    seqEmpty: "尚无追踪邮件，点上方按钮让 AI 生成。",
    seqSegAll: "全部",
    seqSegWatched: "有看完",
    seqSegNotWatched: "没看完",
    seqSegNoShow: "没出席",
    seqDelayLabel: "结束后几分钟寄出",
    btnPreview: "预览",
    seqSendAfter: "研讨会结束后",
    emailCustomNote: "有填自定义主旨和内容时，上面 4 封信都会改用这份内容。可用 {{name}} {{title}} {{date}} {{url}}（观众专属直播间链接）{{cta_url}}（报名 / 购买页）。",
    seqLinkNote: "信里的 {{url}} 会自动换成每位观众自己的直播间 / 回放链接；{{cta_url}} 会换成「互动」里第一个有网址的 CTA 按钮（课程报名或购买页）。",
    seqEnabledLabel: "启用",
    seqDelete: "删除",
    seqGenSuccess: "已生成追踪邮件序列",
    postTitle: "AI 营销贴文",
    postDesc: "AI 生成各平台社群宣传贴文草稿（无对接社群 API，请复制后自行贴到平台发布）。",
    postGenBtn: "AI 生成贴文",
    postEmpty: "尚无贴文，点上方按钮让 AI 生成。",
    postCopy: "复制",
    postCopied: "已复制贴文",
    postDelete: "删除",
    postGenSuccess: "已生成营销贴文",
  },
};

function createSchemas(s: Record<string, string>) {
  return {
    fakeUser: z.object({
      name: z.string().min(1, s.valEnterName),
      avatar: z.string().optional(),
    }),
    scheduledMessage: z.object({
      fakeUserId: z.string().min(1, s.valSelectFakeUser),
      message: z.string().min(1, s.valEnterMessage),
      triggerTime: z.string().min(1, s.valEnterTriggerTime).refine(value => parseClock(value) !== null, s.valClockFormat),
    }),
    cta: z.object({
      text: z.string().min(1, s.valEnterButtonText),
      url: z.string().optional(),
      offerId: z.string().optional(),
      salesPageId: z.string().optional(),
      startTime: z.string().min(1, s.valEnterStartTime).refine(value => parseClock(value) !== null, s.valClockFormat),
      endTime: z.string().optional().refine(value => !value || parseClock(value) !== null, s.valClockFormat),
      style: z.string().default("primary"),
    }).superRefine((value, context) => {
      if (!value.offerId && !value.salesPageId && !z.string().url().safeParse(value.url).success) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["url"], message: s.valEnterValidUrl });
      }
    }),
    poll: z.object({
      question: z.string().min(1, s.valEnterQuestion),
      options: z.string().min(1, s.valEnterOptions),
      triggerTime: z.string().min(1, s.valEnterTriggerTime).refine(value => parseClock(value) !== null, s.valClockFormat),
      duration: z.string().default("60"),
    }),
    tip: z.object({
      title: z.string().min(1, s.valEnterTitle),
      content: z.string().min(1, s.valEnterContent),
      triggerTime: z.string().min(1, s.valEnterTriggerTime).refine(value => parseClock(value) !== null, s.valClockFormat),
      duration: z.string().default("30"),
    }),
  };
}

/** "1 小時", "2 天 3 小時" — easier to read than a count of minutes. */
function formatDelayMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes} 分鐘`;
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  return [days ? `${days} 天` : "", hours ? `${hours} 小時` : "", mins ? `${mins} 分鐘` : ""].filter(Boolean).join(" ");
}

/** The words of an email body, for a short summary under its subject. */
function htmlToPlainText(html: string): string {
  return html.replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Where a registration came from, in words a host recognises: the ad/UTM tag
 * when there is one, otherwise the page the form was on.
 */
function registrationSource(reg: { utmSource?: string | null; utmMedium?: string | null; utmCampaign?: string | null; source?: string | null; landingUrl?: string | null }): { label: string; detail: string } {
  const utm = reg.utmSource || reg.source;
  if (utm) {
    return {
      label: reg.utmMedium ? `${utm} / ${reg.utmMedium}` : utm,
      detail: reg.utmCampaign ? `活動：${reg.utmCampaign}` : "",
    };
  }
  if (reg.landingUrl) {
    try {
      const url = new URL(reg.landingUrl);
      const path = url.pathname.replace(/\/$/, "");
      if (url.host === window.location.host) {
        if (path.startsWith("/embed/register")) return { label: "嵌入表單", detail: "網站未提供上層頁面" };
        if (path.startsWith("/form") || path.startsWith("/register")) return { label: "SellCase 報名頁", detail: "" };
        return { label: "SellCase 頁面", detail: path || "/" };
      }
      return { label: url.host.replace(/^www\./, ""), detail: path && path !== "/" ? path : "" };
    } catch {
      return { label: "直接報名", detail: "" };
    }
  }
  return { label: "直接報名", detail: "" };
}

/**
 * Numbers that change while the page is open (registrations, viewers, leads,
 * funnel): refresh every 30 s while the tab is visible and on return to it.
 */
const LIVE_REFRESH = {
  refetchInterval: 30_000,
  refetchIntervalInBackground: false,
  refetchOnWindowFocus: true,
  staleTime: 0,
} as const;

/** "2026-11-06" for the admin's local calendar day. */
function localDateInput(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Start or end of a local calendar day as an exact moment for the server. */
function localDayBoundary(day: string, end: boolean): string {
  const [year, month, date] = day.split("-").map(Number);
  if (!year || !month || !date) return day;
  return (end ? new Date(year, month - 1, date, 23, 59, 59, 999) : new Date(year, month - 1, date)).toISOString();
}

type SurveyDraftQuestion = {
  id: string;
  type: "rating" | "text" | "multiChoice";
  question: string;
  options: string;
  required: boolean;
};
type SurveyDraft = { title: string; questions: SurveyDraftQuestion[] };

export default function AdminWebinarDetail() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { lang, setLang } = useAdminLang();
  const s = t[lang];
  const schemas = useMemo(() => createSchemas(s), [s]);
  const contextualRail = (
    items: Array<{ id: string; label: string; icon: any }>,
    selected: string,
    setSelected: (value: string) => void,
  ) => (
    <aside className="admin-workspace-rail" aria-label="Section navigation">
      <div className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Sections</div>
      {items.map((item) => (
        <button key={item.id} type="button" onClick={() => {
          setSelected(item.id);
          document.getElementById(`webinar-section-${item.id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
        }} aria-current={selected === item.id ? "location" : undefined} className={cn("admin-workspace-rail-item", selected === item.id && "admin-workspace-rail-item-active")}>
          <item.icon className="h-4 w-4" />{item.label}
        </button>
      ))}
    </aside>
  );
  
  const [isFakeUserOpen, setIsFakeUserOpen] = useState(false);
  const [isMessageOpen, setIsMessageOpen] = useState(false);
  const [isCtaOpen, setIsCtaOpen] = useState(false);
  const [editingCta, setEditingCta] = useState<CtaButton | null>(null);
  const [isOfferOpen, setIsOfferOpen] = useState(false);
  const [offerName, setOfferName] = useState("");
  const [offerAmountMinor, setOfferAmountMinor] = useState("");
  const offerProvider = "ecpay" as const;
  const [isPollOpen, setIsPollOpen] = useState(false);
  const [isTipOpen, setIsTipOpen] = useState(false);
  const [editingPoll, setEditingPoll] = useState<Poll | null>(null);
  const [editingTip, setEditingTip] = useState<Tip | null>(null);
  const [editingFakeUser, setEditingFakeUser] = useState<FakeUser | null>(null);
  const [editingMessage, setEditingMessage] = useState<ScheduledMessage | null>(null);
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editingSessionDate, setEditingSessionDate] = useState("");
  const [surveyDraft, setSurveyDraft] = useState<SurveyDraft | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<{ title: string; description: string; run: () => void } | null>(null);
  const confirmDelete = (run: () => void) => setPendingConfirm({ title: s.confirmDeleteTitle, description: s.confirmDeleteDesc, run });
  // Dates are the admin's own calendar days (toISOString would give the UTC
  // day, which in Taiwan is still "yesterday" until 8 a.m.).
  const [funnelFrom, setFunnelFrom] = useState(() => {
    const date = new Date();
    date.setDate(date.getDate() - 30);
    return localDateInput(date);
  });
  const [funnelTo, setFunnelTo] = useState(() => localDateInput(new Date()));
  const [sourceFilter, setSourceFilter] = useState("__all__");
  const [answeringQuestionId, setAnsweringQuestionId] = useState<string | null>(null);
  const [answerInput, setAnswerInput] = useState("");

  const [settingsScheduleMode, setSettingsScheduleMode] = useState("fixed");
  const [settingsJitMinutes, setSettingsJitMinutes] = useState("15");
  const [settingsTimezone, setSettingsTimezone] = useState("Asia/Taipei");
  const [settingsReplayEnabled, setSettingsReplayEnabled] = useState(true);
  const [settingsReplayHours, setSettingsReplayHours] = useState("48");

  const [isEditingInfo, setIsEditingInfo] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editVimeoUrl, setEditVimeoUrl] = useState("");
  const [editVideoProvider, setEditVideoProvider] = useState<"vimeo" | "bunny">("vimeo");
  const [editVideoAssetId, setEditVideoAssetId] = useState<string | undefined>();
  const [editStartTime, setEditStartTime] = useState("");
  const [editCoverImage, setEditCoverImage] = useState("");
  const [uploadingCover, setUploadingCover] = useState(false);
  const coverFileRef = useRef<HTMLInputElement>(null);

  const [brandLogo, setBrandLogo] = useState("");
  const [brandPrimaryColor, setBrandPrimaryColor] = useState("#667eea");
  const [brandSecondaryColor, setBrandSecondaryColor] = useState("#764ba2");
  const [brandBackgroundColor, setBrandBackgroundColor] = useState("#1a1a2e");

  const [emailConfirmation, setEmailConfirmation] = useState(true);
  const [emailReminder24h, setEmailReminder24h] = useState(true);
  const [emailReminder1h, setEmailReminder1h] = useState(true);
  const [emailFollowUp, setEmailFollowUp] = useState(true);
  const [emailCustomSubject, setEmailCustomSubject] = useState("");
  const [emailCustomTemplate, setEmailCustomTemplate] = useState("");

  const [recurringEnabled, setRecurringEnabled] = useState(false);
  const [recurringDays, setRecurringDays] = useState<number[]>([]);
  const [recurringTimes, setRecurringTimes] = useState("");
  const [recurringExcludeDates, setRecurringExcludeDates] = useState("");

  const [newSessionDate, setNewSessionDate] = useState("");

  const [scheduleSubSection, setScheduleSubSection] = useState("eventSettings");
  const scheduleTabInitialized = useRef(false);
  const [eventType, setEventType] = useState<"recurring" | "oneTime" | "specificDates">("recurring");
  const [onDemandEnabled, setOnDemandEnabled] = useState(false);
  const [eventStartDate, setEventStartDate] = useState("");
  const [eventEndType, setEventEndType] = useState<"never" | "endDate">("never");
  const [eventEndDate, setEventEndDate] = useState("");
  const [timezoneType, setTimezoneType] = useState<"attendee" | "fixed">("fixed");
  const [showTimezoneOnForm, setShowTimezoneOnForm] = useState(true);
  const [scheduledTimeSlots, setScheduledTimeSlots] = useState<string[]>(["11:00", "14:00", "18:00"]);
  const [scheduleFrequency, setScheduleFrequency] = useState("everyDay");
  const [newTimeSlot, setNewTimeSlot] = useState("09:00");

  const [isWebhookOpen, setIsWebhookOpen] = useState(false);
  const [newWebhookEvent, setNewWebhookEvent] = useState("registration");
  const [newWebhookUrl, setNewWebhookUrl] = useState("");
  const [newWebhookSecret, setNewWebhookSecret] = useState("");

  const [aiEnabled, setAiEnabled] = useState(false);
  const [aiTeacherName, setAiTeacherName] = useState("");
  const [aiFallback, setAiFallback] = useState("");
  const [aiTestQuestion, setAiTestQuestion] = useState("");
  const [aiTestAnswer, setAiTestAnswer] = useState("");
  const [isDocOpen, setIsDocOpen] = useState(false);
  const [newDocTitle, setNewDocTitle] = useState("");
  const [newDocContent, setNewDocContent] = useState("");

  type CustomField = { id: string; label: string; type: "text" | "textarea" | "select" | "checkbox"; required: boolean; options?: string[] };
  const [customFields, setCustomFields] = useState<CustomField[]>([]);

  const [scarcityCountdown, setScarcityCountdown] = useState(false);
  const [scarcitySeats, setScarcitySeats] = useState(false);
  const [scarcityTotalSeats, setScarcityTotalSeats] = useState("100");
  const [scarcityUrgency, setScarcityUrgency] = useState("");

  const [thankYouEnabled, setThankYouEnabled] = useState(false);
  const [thankYouHeadline, setThankYouHeadline] = useState("");
  const [thankYouMessage, setThankYouMessage] = useState("");
  const [thankYouCtaText, setThankYouCtaText] = useState("");
  const [thankYouCtaUrl, setThankYouCtaUrl] = useState("");

  const [replayHeadline, setReplayHeadline] = useState("");
  const [replayMessage, setReplayMessage] = useState("");
  const [replayCtaText, setReplayCtaText] = useState("");
  const [replayCtaUrl, setReplayCtaUrl] = useState("");

  const [notifyQuestionEmail, setNotifyQuestionEmail] = useState(false);
  const [notifyEmail, setNotifyEmail] = useState("");
  const [metaPixelId, setMetaPixelId] = useState("");
  const [gtmContainerId, setGtmContainerId] = useState("");

  const [editTagsRegId, setEditTagsRegId] = useState<string | null>(null);
  const [editTagsValue, setEditTagsValue] = useState("");
  const [tagFilter, setTagFilter] = useState("__all__");
  const [leadTemperature, setLeadTemperature] = useState("all");
  const [leadStage, setLeadStage] = useState("all");
  const [leadPage, setLeadPage] = useState(0);
  const [selectedLead, setSelectedLead] = useState<LeadInsight | null>(null);
  const [activeTab, setActiveTab] = useState("analytics");
  const [selectedChatRegistrantId, setSelectedChatRegistrantId] = useState<string | null>(null);
  const [selectedChatSessionId, setSelectedChatSessionId] = useState<string>("__all__");
  const [analyticsSection, setAnalyticsSection] = useState("overview");
  const [notificationsSection, setNotificationsSection] = useState("notifications");
  const [interactionsSection, setInteractionsSection] = useState("cta");
  const [registrationsSection, setRegistrationsSection] = useState("registrants");
  const [settingsSection, setSettingsSection] = useState("tracking");
  const [aiSection, setAiSection] = useState("assistant");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("setupProduct") !== "1") return;
    setActiveTab("commerce");
    setOfferName(params.get("productName")?.trim().slice(0, 200) || "");
    setIsOfferOpen(true);
    window.history.replaceState({}, "", window.location.pathname);
  }, []);

  const { data: webinar, isLoading: webinarLoading } = useQuery<Webinar & TrackingWebinar>({
    queryKey: ["/api/webinars", id],
    enabled: !!id,
  });
  const courseMarketplace = useQuery<CourseMarketplaceOwnerDto | null>({
    queryKey: ["/api/webinars", id, "course-marketplace"],
    enabled: !!id,
  });
  const courseMarketplaceMutation = useMutation({
    mutationFn: (optedIn: boolean) =>
      apiRequest("PUT", `/api/webinars/${id}/course-marketplace`, { optedIn }).then((response) => response.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/webinars", id, "course-marketplace"] });
      toast({ title: "課程廣場申請已更新" });
    },
    onError: (error: Error) => toast({ title: "課程廣場申請失敗", description: error.message, variant: "destructive" }),
  });

  const { data: fakeUsers } = useQuery<FakeUser[]>({
    queryKey: ["/api/webinars", id, "fake-users"],
    enabled: !!id,
  });

  const { data: scheduledMessages } = useQuery<ScheduledMessage[]>({
    queryKey: ["/api/webinars", id, "scheduled-messages"],
    select: messages => messages.filter(message => message.messageType !== "assistant"),
    enabled: !!id,
  });

  const { data: chatMessages } = useQuery<ChatMessage[]>({
    queryKey: ["/api/webinars", id, "chat-messages"],
    enabled: !!id,
  });

  const chatConversations = useMemo(() => {
    const grouped = new Map<string, { sessionId: string; senderName: string; count: number; lastAt: Date | null }>();
    for (const message of chatMessages || []) {
      const sessionId = message.sessionId || "__public__";
      const existing = grouped.get(sessionId);
      const sentAt = message.sentAt ? new Date(message.sentAt) : null;
      grouped.set(sessionId, {
        sessionId,
        senderName: message.senderType === "viewer" ? message.senderName : existing?.senderName || "公開頻道",
        count: (existing?.count || 0) + 1,
        lastAt: sentAt && (!existing?.lastAt || sentAt > existing.lastAt) ? sentAt : existing?.lastAt || null,
      });
    }
    return Array.from(grouped.values()).sort((a, b) => (b.lastAt?.getTime() || 0) - (a.lastAt?.getTime() || 0));
  }, [chatMessages]);

  const { data: ctas } = useQuery<CtaButton[]>({
    queryKey: ["/api/webinars", id, "ctas"],
    enabled: !!id,
  });

  const { data: offers } = useQuery<WebinarOfferView[]>({
    queryKey: ["/api/webinars", id, "offers"],
    enabled: !!id,
  });
  const { data: salesPages } = useQuery<SalesPageView[]>({
    queryKey: ["/api/webinars", id, "sales-pages"],
    enabled: !!id,
  });
  const { data: memberProducts } = useQuery<WebinarOfferView[]>({ queryKey: ["/api/products"] });
  const { data: productSalesPages } = useQuery<SalesPageView[]>({ queryKey: ["/api/product-sales-pages"] });
  const [salesTemplateOffer, setSalesTemplateOffer] = useState<WebinarOfferView | null>(null);

  const { data: polls } = useQuery<Poll[]>({
    queryKey: ["/api/webinars", id, "polls"],
    enabled: !!id,
  });

  const { data: registrations, isLoading: registrationsLoading, isError: registrationsError } = useQuery<Registration[]>({
    queryKey: ["/api/webinars", id, "registrations"],
    enabled: !!id,
    ...LIVE_REFRESH,
  });

  const leadInsightsQuery = useQuery<LeadInsightsResponse>({
    queryKey: [`/api/webinars/${id}/lead-insights?limit=50&offset=${leadPage * 50}`],
    enabled: !!id,
    ...LIVE_REFRESH,
  });
  const leadDetailQuery = useQuery<LeadInsightDetail>({
    queryKey: ["/api/webinars", id, "registrations", selectedLead?.registrationId, "insights"],
    enabled: !!id && !!selectedLead?.registrationId,
    ...LIVE_REFRESH,
  });

  const { data: tips } = useQuery<Tip[]>({
    queryKey: ["/api/webinars", id, "tips"],
    enabled: !!id,
  });

  const { data: questions } = useQuery<Question[]>({
    queryKey: ["/api/webinars", id, "questions"],
    enabled: !!id,
  });

  const { data: analytics } = useQuery<AnalyticsResponse>({
    queryKey: ["/api/webinars", id, "analytics"],
    enabled: !!id,
    ...LIVE_REFRESH,
  });

  const sessionRegistrationCountsQuery = useQuery<SessionRegistrationCountsDto>({
    queryKey: ["/api/webinars", id, "session-registration-counts"],
    enabled: !!id,
    refetchInterval: 15_000,
    refetchIntervalInBackground: false,
    staleTime: 0,
    retry: false,
  });

  const funnelQuery = useQuery<FunnelAnalyticsResponse>({
    queryKey: [`/api/webinars/${id}/funnel-analytics?from=${encodeURIComponent(localDayBoundary(funnelFrom, false))}&to=${encodeURIComponent(localDayBoundary(funnelTo, true))}`],
    enabled: !!id && !!funnelFrom && !!funnelTo,
    ...LIVE_REFRESH,
  });

  const { data: webinarSessions } = useQuery<Array<{ id: string; scheduledStart: string; status: string }>>({
    queryKey: ["/api/webinars", id, "sessions"],
    enabled: !!id,
  });

  const { data: feedbackSurvey } = useQuery<any>({
    queryKey: ["/api/webinars", id, "feedback-survey"],
    enabled: !!id,
  });

  const { data: feedbackResponses } = useQuery<FeedbackResponse[]>({
    queryKey: ["/api/feedback-surveys", feedbackSurvey?.id, "responses"],
    enabled: !!feedbackSurvey?.id,
  });

  const { data: webhooks } = useQuery<Webhook[]>({
    queryKey: ["/api/webinars", id, "webhooks"],
    enabled: !!id,
  });

  const { data: documents } = useQuery<WebinarDocument[]>({
    queryKey: ["/api/webinars", id, "documents"],
    enabled: !!id,
  });

  const { data: emailSequences } = useQuery<EmailSequence[]>({
    queryKey: ["/api/webinars", id, "email-sequences"],
    enabled: !!id,
  });

  const { data: socialPosts } = useQuery<SocialPost[]>({
    queryKey: ["/api/webinars", id, "social-posts"],
    enabled: !!id,
  });

  const { data: aiPointBalance, isLoading: isAiPointBalanceLoading } = useQuery<{ points: number; unlimited: boolean }>({
    queryKey: ["/api/ai-points"],
  });
  const { data: noCardTrial } = useQuery<{ state: string; remainingAI: number }>({
    queryKey: ["/api/trial"],
  });
  const aiKnowledgeCharacters = (documents || []).reduce((total, document) => total + document.content.length, 0);
  const aiTrainingReady = (documents?.length || 0) > 0;

  // AI 生成相關狀態
  const [aiGenGoal, setAiGenGoal] = useState("");
  const [aiGenReplace, setAiGenReplace] = useState(false);
  const [seqGoal, setSeqGoal] = useState("");
  const [emailPreview, setEmailPreview] = useState<EmailPreviewRequest | null>(null);
  const [postGoal, setPostGoal] = useState("");

  const isAiPointsError = (err: any) => {
    const msg = String(err?.message || "");
    return msg.includes("402") || msg.includes("點數") || msg.includes("点数");
  };

  const handleAiError = (err: any) => {
    if (isAiPointsError(err)) {
      if (noCardTrial?.state === "active") {
        toast({ title: "試用 AI 次數不足", description: `免信用卡試用剩餘 ${noCardTrial.remainingAI} 次 AI；升級後可使用付費 AI 點數。`, variant: "destructive" });
        return;
      }
      toast({ title: s.aiGenNoPoints, description: "請先購買 AI 點數後再使用此功能。", variant: "destructive" });
      setLocation("/admin/dashboard?buy-points=1");
      return;
    }
    toast({ title: s.aiGenFail, description: String(err?.message || ""), variant: "destructive" });
  };

  const testAiQuestion = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", `/api/webinars/${id}/ai/test-question`, {
        question: aiTestQuestion,
      });
      return await response.json() as { answer: string; pointsCharged: number; unlimited: boolean };
    },
    onSuccess: (result) => {
      setAiTestAnswer(result.answer);
      queryClient.invalidateQueries({ queryKey: ["/api/ai-points"] });
      queryClient.invalidateQueries({ queryKey: ["/api/trial"] });
    },
    onError: (error: any) => {
      setAiTestAnswer("");
      handleAiError(error);
    },
  });

  const generateInteractions = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", `/api/webinars/${id}/ai/generate-interactions`, {
        goal: aiGenGoal,
        replace: aiGenReplace,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/trial"] });
      queryClient.invalidateQueries({ queryKey: ["/api/webinars", id, "scheduled-messages"] });
      queryClient.invalidateQueries({ queryKey: ["/api/webinars", id, "ctas"] });
      queryClient.invalidateQueries({ queryKey: ["/api/webinars", id, "polls"] });
      queryClient.invalidateQueries({ queryKey: ["/api/webinars", id, "tips"] });
      queryClient.invalidateQueries({ queryKey: ["/api/webinars", id, "fake-users"] });
      toast({ title: s.aiGenInterSuccess });
    },
    onError: handleAiError,
  });

  const generateEmailSequence = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", `/api/webinars/${id}/ai/generate-email-sequence`, {
        goal: seqGoal,
        replace: true,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/trial"] });
      queryClient.invalidateQueries({ queryKey: ["/api/webinars", id, "email-sequences"] });
      toast({ title: s.seqGenSuccess });
    },
    onError: handleAiError,
  });

  const generateSocialPosts = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", `/api/webinars/${id}/ai/generate-social-posts`, {
        goal: postGoal,
        replace: true,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/trial"] });
      queryClient.invalidateQueries({ queryKey: ["/api/webinars", id, "social-posts"] });
      toast({ title: s.postGenSuccess });
    },
    onError: handleAiError,
  });

  const updateSequence = useMutation({
    mutationFn: async ({ seqId, patch }: { seqId: string; patch: Partial<EmailSequence> }) => {
      return apiRequest("PATCH", `/api/webinars/${id}/email-sequences/${seqId}`, patch);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/webinars", id, "email-sequences"] }),
  });

  const deleteSequence = useMutation({
    mutationFn: async (seqId: string) => apiRequest("DELETE", `/api/webinars/${id}/email-sequences/${seqId}`, {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/webinars", id, "email-sequences"] }),
  });

  const deletePost = useMutation({
    mutationFn: async (postId: string) => apiRequest("DELETE", `/api/webinars/${id}/social-posts/${postId}`, {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/webinars", id, "social-posts"] }),
  });

  useEffect(() => {
    if (webinar) {
      const sm = webinar.scheduleMode as any;
      if (sm?.justInTime) {
        setSettingsScheduleMode("justInTime");
        setSettingsJitMinutes(String(sm.justInTimeMinutes || 15));
      } else if (sm?.onDemand) {
        setSettingsScheduleMode("onDemand");
      } else {
        setSettingsScheduleMode("fixed");
      }
      setSettingsTimezone(webinar.timezone || "Asia/Taipei");
      setSettingsReplayEnabled(webinar.replayEnabled ?? true);
      setSettingsReplayHours(String(webinar.replayAvailableHours ?? 48));

      setEditTitle(webinar.title);
      setEditDescription(webinar.description || "");
      setEditVimeoUrl(webinar.vimeoUrl);
      setEditVideoProvider(((webinar as any).videoProvider || "vimeo") as "vimeo" | "bunny");
      setEditVideoAssetId((webinar as any).videoAssetId || undefined);
      setEditStartTime(toLocalDateTimeInput(webinar.startTime));
      setEditCoverImage(webinar.coverImage || "");
      setMetaPixelId(webinar.metaPixelId || "");
      setGtmContainerId(webinar.gtmContainerId || "");

      const bs = webinar.brandSettings as any;
      if (bs) {
        setBrandLogo(bs.logo || "");
        setBrandPrimaryColor(bs.primaryColor || "#667eea");
        setBrandSecondaryColor(bs.secondaryColor || "#764ba2");
        setBrandBackgroundColor(bs.backgroundColor || "#1a1a2e");
      }

      const ai = webinar.aiSettings as any;
      if (ai) {
        setAiEnabled(ai.enabled ?? false);
        setAiTeacherName(ai.teacherName || "");
        setAiFallback(ai.fallbackMessage || "");
      }

      setCustomFields(((webinar.customFields as CustomField[]) || []));

      const sc = webinar.scarcitySettings as any;
      if (sc) {
        setScarcityCountdown(sc.countdownEnabled ?? false);
        setScarcitySeats(sc.seatsEnabled ?? false);
        setScarcityTotalSeats(String(sc.totalSeats ?? 100));
        setScarcityUrgency(sc.urgencyText || "");
      }

      const ty = webinar.thankYouSettings as any;
      if (ty) {
        setThankYouEnabled(ty.enabled ?? false);
        setThankYouHeadline(ty.headline || "");
        setThankYouMessage(ty.message || "");
        setThankYouCtaText(ty.ctaText || "");
        setThankYouCtaUrl(ty.ctaUrl || "");
      }

      const rp = webinar.replaySettings as any;
      if (rp) {
        setReplayHeadline(rp.headline || "");
        setReplayMessage(rp.message || "");
        setReplayCtaText(rp.ctaText || "");
        setReplayCtaUrl(rp.ctaUrl || "");
      }

      const ns = webinar.notifySettings as any;
      if (ns) {
        setNotifyQuestionEmail(ns.questionEmailEnabled ?? false);
        setNotifyEmail(ns.notifyEmail || "");
      }

      const es = webinar.emailSettings as any;
      if (es) {
        setEmailConfirmation(es.confirmationEnabled ?? true);
        setEmailReminder24h(es.reminder24hEnabled ?? true);
        setEmailReminder1h(es.reminder1hEnabled ?? true);
        setEmailFollowUp(es.followUpEnabled ?? true);
        setEmailCustomSubject(es.customSubject || "");
        setEmailCustomTemplate(es.customTemplate || "");
      }

      const rs = webinar.recurringSchedule as any;
      if (rs) {
        setRecurringEnabled(rs.enabled ?? false);
        setRecurringDays(rs.days || []);
        setRecurringTimes((rs.times || []).join(", "));
        setRecurringExcludeDates((rs.excludeDates || []).join(", "));
        if (rs.times && rs.times.length > 0) {
          setScheduledTimeSlots(rs.times);
        }
      }

      const sm2 = webinar.scheduleMode as any;
      setOnDemandEnabled(sm2?.onDemand ?? false);
      if (sm2?.justInTime) {
        setEventType(rs?.enabled ? "recurring" : "oneTime");
        // Open the just-in-time tab once, on arrival; never after a save.
        if (!scheduleTabInitialized.current) setScheduleSubSection("justInTime");
      } else if (rs?.enabled) {
        setEventType("recurring");
      } else {
        setEventType(sm2?.eventType === "specificDates" ? "specificDates" : "oneTime");
      }
      scheduleTabInitialized.current = true;

      if (sm2?.eventEndType) {
        setEventEndType(sm2.eventEndType);
      }
      if (sm2?.eventEndDate) {
        setEventEndDate(sm2.eventEndDate);
      }
      if (sm2?.timezoneType) {
        setTimezoneType(sm2.timezoneType);
      }
      if (sm2?.showTimezoneOnForm !== undefined) {
        setShowTimezoneOnForm(sm2.showTimezoneOnForm);
      }

      if (rs?.frequency) {
        setScheduleFrequency(rs.frequency);
      }

      if (webinar.startTime) {
        setEventStartDate(dateKeyInTimeZone(webinar.startTime, webinar.timezone || "Asia/Taipei"));
      }
    }
  }, [webinar]);

  const fakeUserForm = useForm({
    resolver: zodResolver(schemas.fakeUser),
    defaultValues: { name: "", avatar: "" },
  });

  const messageForm = useForm({
    resolver: zodResolver(schemas.scheduledMessage),
    defaultValues: { fakeUserId: "", message: "", triggerTime: "" },
  });

  const ctaForm = useForm({
    resolver: zodResolver(schemas.cta),
    defaultValues: { text: "", url: "", offerId: "", salesPageId: "", startTime: "", endTime: "", style: "primary" },
  });

  const pollForm = useForm({
    resolver: zodResolver(schemas.poll),
    defaultValues: { question: "", options: "", triggerTime: "", duration: "60" },
  });

  const tipForm = useForm({
    resolver: zodResolver(schemas.tip),
    defaultValues: { title: "", content: "", triggerTime: "", duration: "30" },
  });

  const createFakeUser = useMutation({
    mutationFn: async (data: z.infer<typeof schemas.fakeUser>) => {
      return editingFakeUser
        ? apiRequest("PATCH", `/api/webinars/${id}/fake-users/${editingFakeUser.id}`, { name: data.name })
        : apiRequest("POST", `/api/webinars/${id}/fake-users`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/webinars", id, "fake-users"] });
      setIsFakeUserOpen(false);
      toast({ title: editingFakeUser ? s.toastFakeUserUpdated : s.toastFakeUserCreated });
      setEditingFakeUser(null);
      fakeUserForm.reset();
    },
    onError: (error: Error) => toast({ title: s.toastSaveFailed, description: error.message, variant: "destructive" }),
  });

  const createMessage = useMutation({
    mutationFn: async (data: z.infer<typeof schemas.scheduledMessage>) => {
      return apiRequest(
        editingMessage ? "PATCH" : "POST",
        editingMessage ? `/api/webinars/${id}/scheduled-messages/${editingMessage.id}` : `/api/webinars/${id}/scheduled-messages`,
        { ...data, triggerTime: parseClock(data.triggerTime) ?? 0 },
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/webinars", id, "scheduled-messages"] });
      setIsMessageOpen(false);
      toast({ title: editingMessage ? s.toastMessageUpdated : s.toastScheduledMsgCreated });
      setEditingMessage(null);
      messageForm.reset();
    },
    onError: (error: Error) => toast({ title: s.toastSaveFailed, description: error.message, variant: "destructive" }),
  });

  const createCta = useMutation({
    mutationFn: async (data: z.infer<typeof schemas.cta>) => {
      const parseTime = (t: string) => parseClock(t) ?? 0;
      return apiRequest(editingCta ? "PATCH" : "POST", editingCta ? `/api/webinars/${id}/ctas/${editingCta.id}` : `/api/webinars/${id}/ctas`, {
        text: data.text,
        url: data.offerId || data.salesPageId ? null : data.url,
        offerId: data.offerId || null,
        salesPageId: data.salesPageId || null,
        startTime: parseTime(data.startTime),
        endTime: data.endTime ? parseTime(data.endTime) : null,
        style: data.style,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/webinars", id, "ctas"] });
      setIsCtaOpen(false);
      setEditingCta(null);
      ctaForm.reset();
      toast({ title: s.toastCtaCreated });
    },
  });

  const createOffer = useMutation({
    mutationFn: async () => {
      const amountTwd = Number(offerAmountMinor);
      if (!offerName.trim() || !Number.isInteger(amountTwd) || amountTwd <= 0) {
        throw new Error("請輸入有效的商品名稱與新台幣整數金額");
      }
      const response = await apiRequest("POST", `/api/webinars/${id}/offers`, {
        paymentProvider: offerProvider,
        name: offerName.trim(),
        amountMinor: amountTwd * 100,
        currency: "TWD",
        checkoutMode: "payment",
      });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/webinars", id, "offers"] });
      setIsOfferOpen(false);
      setOfferName("");
      setOfferAmountMinor("");
      toast({ title: "綠界商品已建立" });
    },
    onError: (error: any) => toast({ title: error.message, variant: "destructive" }),
  });
  const createSalesPage = useMutation({
    mutationFn: async ({ offer, template }: { offer: WebinarOfferView; template: SalesTemplate }) => {
      const safe = offer.name.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "course";
      const slug = `${safe.slice(0, 58)}-${Date.now().toString(36)}`;
      const response = await apiRequest("POST", `/api/webinars/${id}/sales-pages`, { offerId: offer.id, slug, title: `${offer.name} 銷售頁`, template, blocks: createSalesPageTemplate(template, { name: offer.name }) });
      return response.json() as Promise<SalesPageView>;
    },
    onSuccess: (page) => {
      queryClient.invalidateQueries({ queryKey: ["/api/webinars", id, "sales-pages"] });
      setLocation(`/admin/webinar/${id}/sales/${page.id}`);
    },
    onError: (error: any) => toast({ title: "建立銷售頁失敗", description: error.message, variant: "destructive" }),
  });

  const createPoll = useMutation({
    mutationFn: async (data: z.infer<typeof schemas.poll>) => {
      const options = data.options.split(/[,，]/).map(o => o.trim()).filter(Boolean);
      if (options.length < 2) throw new Error(s.valPollOptionsMin);
      const duration = parseInt(data.duration, 10);
      return apiRequest(editingPoll ? "PATCH" : "POST", editingPoll ? `/api/webinars/${id}/polls/${editingPoll.id}` : `/api/webinars/${id}/polls`, {
        question: data.question,
        options,
        triggerTime: parseClock(data.triggerTime) ?? 0,
        duration: Number.isFinite(duration) ? duration : 60,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/webinars", id, "polls"] });
      setIsPollOpen(false);
      toast({ title: editingPoll ? s.toastPollUpdated : s.toastPollCreated });
      setEditingPoll(null);
      pollForm.reset();
    },
    onError: (error: Error) => toast({ title: s.toastSaveFailed, description: apiErrorMessage(error), variant: "destructive" }),
  });

  const createTip = useMutation({
    mutationFn: async (data: z.infer<typeof schemas.tip>) => {
      const duration = parseInt(data.duration, 10);
      return apiRequest(editingTip ? "PATCH" : "POST", editingTip ? `/api/webinars/${id}/tips/${editingTip.id}` : `/api/webinars/${id}/tips`, {
        title: data.title,
        content: data.content,
        triggerTime: parseClock(data.triggerTime) ?? 0,
        duration: Number.isFinite(duration) ? duration : 30,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/webinars", id, "tips"] });
      setIsTipOpen(false);
      toast({ title: editingTip ? s.toastTipUpdated : s.toastTipCreated });
      setEditingTip(null);
      tipForm.reset();
    },
    onError: (error: Error) => toast({ title: s.toastSaveFailed, description: error.message, variant: "destructive" }),
  });

  const moveSession = useMutation({
    mutationFn: async ({ sessionId, date }: { sessionId: string; date: string }) =>
      apiRequest("PATCH", `/api/webinars/${id}/sessions/${sessionId}`, { scheduledStart: new Date(date).toISOString() }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/webinars", id, "sessions"] });
      setEditingSessionId(null);
      toast({ title: s.toastSessionMoved });
    },
    onError: (error: Error) => toast({
      title: s.toastSaveFailed,
      description: error.message.replace(/^\d+:\s*/, "").replace(/^\{"message":"(.*)"\}$/, "$1"),
      variant: "destructive",
    }),
  });

  const saveSurvey = useMutation({
    mutationFn: async ({ surveyId, draft }: { surveyId: string; draft: SurveyDraft }) => {
      const questions = draft.questions.map((q) => {
        const options = q.options.split(/[,，]/).map((o) => o.trim()).filter(Boolean);
        if (!q.question.trim()) throw new Error(s.surveyQuestionEmpty);
        if (q.type === "multiChoice" && options.length < 2) throw new Error(`${s.surveyOptionsMin}${q.question}`);
        return {
          id: q.id,
          type: q.type,
          question: q.question.trim(),
          required: q.required,
          ...(q.type === "multiChoice" ? { options } : {}),
        };
      });
      if (!draft.title.trim()) throw new Error(s.surveyNeedTitle);
      if (questions.length === 0) throw new Error(s.surveyNeedQuestion);
      return apiRequest("PATCH", `/api/webinars/${id}/feedback-survey/${surveyId}`, { title: draft.title.trim(), questions });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/webinars", id, "feedback-survey"] });
      setSurveyDraft(null);
      toast({ title: s.toastSurveyUpdated });
    },
    onError: (error: Error) => toast({ title: s.toastSaveFailed, description: error.message, variant: "destructive" }),
  });

  const toggleSurvey = useMutation({
    mutationFn: async ({ surveyId, isActive }: { surveyId: string; isActive: boolean }) =>
      apiRequest("PATCH", `/api/webinars/${id}/feedback-survey/${surveyId}`, { isActive }),
    onSuccess: (_, { isActive }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/webinars", id, "feedback-survey"] });
      toast({ title: isActive ? s.toastSurveyOn : s.toastSurveyOff });
    },
    onError: (error: Error) => toast({ title: s.toastSaveFailed, description: error.message, variant: "destructive" }),
  });

  const updateWebinar = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("PATCH", `/api/webinars/${id}`, data);
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/webinars", id] });
      queryClient.invalidateQueries({ queryKey: ["/api/webinars"] });
      setIsEditingInfo(false);
      toast({ title: s.toastSettingsSaved });
    },
    onError: (error: Error) => {
      toast({ title: s.toastSaveFailed, description: error.message, variant: "destructive" });
    },
  });

  const answerQuestion = useMutation({
    mutationFn: async ({ questionId, answer }: { questionId: string; answer: string }) => {
      return apiRequest("PATCH", `/api/webinars/${id}/questions/${questionId}`, {
        answer,
        answeredBy: "admin",
        answeredAt: new Date().toISOString(),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/webinars", id, "questions"] });
      setAnsweringQuestionId(null);
      setAnswerInput("");
      toast({ title: s.toastQuestionAnswered });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async ({ type, itemId }: { type: string; itemId: string }) => {
      return apiRequest("DELETE", `/api/webinars/${id}/${type}/${itemId}`, {});
    },
    onSuccess: (_, { type }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/webinars", id, type] });
      toast({ title: s.toastDeleted });
    },
  });

  const createWebhook = useMutation({
    mutationFn: async (data: { webinarId: string; eventType: string; targetUrl: string; secret: string; enabled: boolean }) => {
      return apiRequest("POST", `/api/webinars/${id}/webhooks`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/webinars", id, "webhooks"] });
      setIsWebhookOpen(false);
      setNewWebhookEvent("registration");
      setNewWebhookUrl("");
      setNewWebhookSecret("");
      toast({ title: s.toastWebhookCreated });
    },
    onError: (error: Error) => {
      toast({ title: s.toastCreateFailed, description: error.message, variant: "destructive" });
    },
  });

  const deleteWebhook = useMutation({
    mutationFn: async (hookId: string) => {
      return apiRequest("DELETE", `/api/webinars/${id}/webhooks/${hookId}`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/webinars", id, "webhooks"] });
      toast({ title: s.toastWebhookDeleted });
    },
  });

  const saveAiSettings = useMutation({
    mutationFn: async () => {
      return apiRequest("PATCH", `/api/webinars/${id}`, {
        aiSettings: { enabled: aiEnabled, teacherName: aiTeacherName.trim(), fallbackMessage: aiFallback.trim() },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/webinars", id] });
      toast({ title: s.aiSettingsSaved });
    },
    onError: (error: Error) => {
      toast({ title: s.toastSaveFailed, description: error.message, variant: "destructive" });
    },
  });

  const saveCustomFields = useMutation({
    mutationFn: async (fields: CustomField[]) => {
      return apiRequest("PATCH", `/api/webinars/${id}`, { customFields: fields });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/webinars", id] });
      toast({ title: s.cfSaved });
    },
    onError: (error: Error) => {
      toast({ title: s.toastSaveFailed, description: error.message, variant: "destructive" });
    },
  });

  const saveScarcity = useMutation({
    mutationFn: async () => {
      return apiRequest("PATCH", `/api/webinars/${id}`, {
        scarcitySettings: {
          countdownEnabled: scarcityCountdown,
          seatsEnabled: scarcitySeats,
          totalSeats: parseInt(scarcityTotalSeats) || 100,
          urgencyText: scarcityUrgency.trim(),
        },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/webinars", id] });
      toast({ title: s.scSaved });
    },
    onError: (error: Error) => {
      toast({ title: s.toastSaveFailed, description: error.message, variant: "destructive" });
    },
  });

  const savePages = useMutation({
    mutationFn: async () => {
      return apiRequest("PATCH", `/api/webinars/${id}`, {
        thankYouSettings: {
          enabled: thankYouEnabled,
          headline: thankYouHeadline.trim(),
          message: thankYouMessage.trim(),
          ctaText: thankYouCtaText.trim(),
          ctaUrl: thankYouCtaUrl.trim(),
        },
        replaySettings: {
          headline: replayHeadline.trim(),
          message: replayMessage.trim(),
          ctaText: replayCtaText.trim(),
          ctaUrl: replayCtaUrl.trim(),
        },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/webinars", id] });
      toast({ title: s.pgSaved });
    },
    onError: (error: Error) => {
      toast({ title: s.toastSaveFailed, description: error.message, variant: "destructive" });
    },
  });

  const saveNotify = useMutation({
    mutationFn: async () => {
      return apiRequest("PATCH", `/api/webinars/${id}`, {
        notifySettings: { questionEmailEnabled: notifyQuestionEmail, notifyEmail: notifyEmail.trim() },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/webinars", id] });
      toast({ title: s.ntSaved });
    },
    onError: (error: Error) => {
      toast({ title: s.toastSaveFailed, description: error.message, variant: "destructive" });
    },
  });

  const saveTrackingSettings = useMutation({
    mutationFn: async () => {
      const pixel = metaPixelId.trim();
      const gtm = gtmContainerId.trim().toUpperCase();
      if (pixel && !isValidMetaPixelId(pixel)) {
        throw new Error("Meta Pixel ID 必須為 5–32 位數字");
      }
      if (gtm && !isValidGtmContainerId(gtm)) {
        throw new Error("GTM Container ID 必須為 GTM- 開頭的大寫英數字，總長 8–24 字元");
      }
      return apiRequest("PATCH", `/api/webinars/${id}`, {
        metaPixelId: pixel || null,
        gtmContainerId: gtm || null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/webinars", id] });
      toast({ title: s.toastSettingsSaved });
    },
    onError: (error: Error) => {
      toast({ title: s.toastSaveFailed, description: error.message, variant: "destructive" });
    },
  });

  const saveRegTags = useMutation({
    mutationFn: async ({ regId, tags }: { regId: string; tags: string[] }) => {
      return apiRequest("PATCH", `/api/webinars/${id}/registrations/${regId}/tags`, { tags });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/webinars", id, "registrations"] });
      setEditTagsRegId(null);
      setEditTagsValue("");
      toast({ title: s.tagSaved });
    },
    onError: (error: Error) => {
      toast({ title: s.toastSaveFailed, description: error.message, variant: "destructive" });
    },
  });

  const handleSrtUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const raw = await file.text();
      const text = raw
        .replace(/\r/g, "")
        .split("\n\n")
        .map((block) =>
          block
            .split("\n")
            .filter((line) => {
              const t = line.trim();
              if (/^\d+$/.test(t)) return false;
              if (/-->/.test(t)) return false;
              return t.length > 0;
            })
            .join(" ")
        )
        .filter((s) => s.trim().length > 0)
        .join("\n")
        .replace(/<[^>]+>/g, "")
        .trim();
      if (!text) {
        toast({ title: s.aiSrtInvalid, variant: "destructive" });
        return;
      }
      if (!newDocTitle.trim()) {
        setNewDocTitle(file.name.replace(/\.srt$/i, ""));
      }
      setNewDocContent(text);
      toast({ title: s.aiSrtLoaded });
    } catch {
      toast({ title: s.aiSrtInvalid, variant: "destructive" });
    }
  };

  const createDocument = useMutation({
    mutationFn: async (data: { title: string; content: string }) => {
      return apiRequest("POST", `/api/webinars/${id}/documents`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/webinars", id, "documents"] });
      setIsDocOpen(false);
      setNewDocTitle("");
      setNewDocContent("");
      toast({ title: s.aiDocSaved });
    },
    onError: (error: Error) => {
      toast({ title: s.toastCreateFailed, description: error.message, variant: "destructive" });
    },
  });

  const deleteDocument = useMutation({
    mutationFn: async (docId: string) => {
      return apiRequest("DELETE", `/api/webinars/${id}/documents/${docId}`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/webinars", id, "documents"] });
      toast({ title: s.toastDeleted });
    },
  });

  const formatTime = (seconds: number) => {
    const min = Math.floor(seconds / 60);
    const sec = seconds % 60;
    return `${min}:${sec.toString().padStart(2, "0")}`;
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: s.toastCopied });
  };

  if (webinarLoading) {
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

  const registrationUrl = `${window.location.origin}/register/${id}`;
  const webinarUrl = `${window.location.origin}/webinar/${id}`;
  const leadData = leadInsightsQuery.data;
  const visibleLeads = (leadData?.leads || []).filter((lead) =>
    (leadTemperature === "all" || lead.temperature === leadTemperature) &&
    (leadStage === "all" || lead.stage === leadStage)
  );
  const selectedRegistration = registrations?.find((registration) =>
    String(registration.id) === String(selectedLead?.registrationId)
  );
  const formatLeadDate = (value: string | null | undefined) => value
    ? new Date(value).toLocaleString(lang, { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })
    : "尚無活動";
  const temperatureLabel = (temperature: string) => ({
    hot: "高意圖", warm: "觀望中", cold: "低意圖", customer: "已成交客戶",
  }[temperature] || temperature);
  const stageLabel = (stage: string) => ({
    registered: "已報名", engaged: "已互動", considering: "考慮中",
    checkout: "結帳中", converted: "已成交", refunded: "已退款",
  }[stage] || stage);
  const temperatureClass = (temperature: string) => ({
    hot: "border-rose-200 bg-rose-50 text-rose-700",
    warm: "border-amber-200 bg-amber-50 text-amber-700",
    cold: "border-slate-200 bg-slate-50 text-slate-600",
    customer: "border-teal-200 bg-teal-50 text-teal-700",
  }[temperature] || "border-border bg-muted text-muted-foreground");

  return (
    <div className="admin-shell admin-webinar-detail">
      <header className="border-b bg-card sticky top-0 z-10">
        <div className="container mx-auto px-4 py-4 flex flex-wrap items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => setLocation("/admin/dashboard")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="min-w-[240px] flex-1">
            {isEditingInfo ? (
              <div className="space-y-2">
                <Input
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  placeholder={s.placeholderTitle}
                  data-testid="input-edit-title"
                />
                <div className="flex items-start gap-2 flex-wrap">
                  <div className="min-w-[260px] flex-1">
                    <VideoSourcePicker vimeoUrl={editVimeoUrl} videoAssetId={editVideoAssetId} onChange={(source) => {
                      setEditVimeoUrl(source.vimeoUrl);
                      setEditVideoProvider(source.videoProvider);
                      setEditVideoAssetId(source.videoAssetId);
                    }} />
                  </div>
                  <Input
                    type="datetime-local"
                    value={editStartTime}
                    onChange={(e) => setEditStartTime(e.target.value)}
                    className="w-auto"
                    data-testid="input-edit-start-time"
                  />
                </div>
                <Textarea
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  placeholder={s.placeholderDescription}
                  className="resize-none"
                  rows={2}
                  data-testid="input-edit-description"
                />
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">{s.labelCoverImage}</Label>
                  {editCoverImage ? (
                    <div className="relative rounded-md overflow-hidden border">
                      <img src={editCoverImage} alt={s.altCoverPreview} className="w-full h-32 object-cover" />
                      <Button
                        variant="outline"
                        size="icon"
                        className="absolute top-2 right-2 bg-background/80 backdrop-blur-sm"
                        onClick={() => setEditCoverImage("")}
                        data-testid="button-remove-cover"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ) : (
                    <div
                      className="border-2 border-dashed rounded-md p-4 flex flex-col items-center justify-center gap-2 cursor-pointer hover-elevate"
                      onClick={() => coverFileRef.current?.click()}
                      data-testid="button-upload-cover-area"
                    >
                      <ImagePlus className="h-6 w-6 text-muted-foreground" />
                      <span className="text-xs text-muted-foreground">{s.clickUploadCover}</span>
                    </div>
                  )}
                  <input
                    ref={coverFileRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      setUploadingCover(true);
                      try {
                        const formData = new FormData();
                        formData.append("file", file);
                        const res = await fetch("/api/upload", {
                          method: "POST",
                          body: formData,
                        });
                        if (!res.ok) {
                          const errData = await res.json();
                          throw new Error(errData.message || s.toastUploadFailed);
                        }
                        const { url } = await res.json();
                        setEditCoverImage(url);
                        toast({ title: s.toastCoverUploaded });
                      } catch (err: any) {
                        toast({ title: s.toastUploadFailed, description: err.message, variant: "destructive" });
                      } finally {
                        setUploadingCover(false);
                        if (coverFileRef.current) coverFileRef.current.value = "";
                      }
                    }}
                    data-testid="input-upload-cover-file"
                  />
                  {uploadingCover && (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      {s.uploading}
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <Input
                      value={editCoverImage}
                      onChange={(e) => setEditCoverImage(e.target.value)}
                      placeholder={s.placeholderImageUrl}
                      className="flex-1 text-xs"
                      data-testid="input-edit-cover"
                    />
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => coverFileRef.current?.click()}
                      disabled={uploadingCover}
                      data-testid="button-upload-cover"
                    >
                      <Upload className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    onClick={async () => {
                      const oldCover = webinar.coverImage;
                      const newCover = editCoverImage || null;
                      if (oldCover && oldCover.startsWith("/uploads/") && oldCover !== newCover) {
                        try {
                          await fetch("/api/upload", {
                            method: "DELETE",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ url: oldCover }),
                          });
                        } catch {}
                      }
                      updateWebinar.mutate({
                        title: editTitle,
                        description: editDescription || null,
                        vimeoUrl: editVimeoUrl,
                        videoProvider: editVideoProvider,
                        videoAssetId: editVideoAssetId || null,
                        startTime: new Date(editStartTime).toISOString(),
                        coverImage: newCover,
                      });
                    }}
                    disabled={updateWebinar.isPending || !editTitle || (editVideoProvider === "vimeo" ? !editVimeoUrl : !editVideoAssetId)}
                    data-testid="button-save-info"
                  >
                    <Save className="h-4 w-4 mr-1" />
                    {s.btnSave}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setIsEditingInfo(false)}>
                    {s.btnCancel}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <SellCaseLogo className="admin-detail-brand-logo" />
                {webinar.coverImage && (
                  <img
                    src={webinar.coverImage}
                    alt={webinar.title}
                    className="w-16 h-10 object-cover rounded-md flex-shrink-0 border"
                    data-testid="img-cover-preview"
                  />
                )}
                <div>
                  <h1 className="text-lg font-bold">{webinar.title}</h1>
                  <p className="text-sm text-muted-foreground">{s.headerSubtitle}</p>
                </div>
                <Button variant="ghost" size="icon" onClick={() => setIsEditingInfo(true)} data-testid="button-edit-info">
                  <Edit className="h-4 w-4" />
                </Button>
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => setLocation(`/admin/webinar/${id}/landing-page`)} data-testid="button-edit-landing-page">
              <Edit className="h-4 w-4 mr-2" />編輯報名頁
            </Button>
            <Button variant="outline" onClick={() => setLocation(`/admin/webinar/${id}/control`)} data-testid="button-go-control">
              <Radio className="h-4 w-4 mr-2" />
              {s.btnLiveControl}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setLang(lang === "zh-TW" ? "zh-CN" : "zh-TW")}
              data-testid="button-detail-lang-toggle"
            >
              <Languages className="h-4 w-4 mr-1" />
              {lang === "zh-TW" ? "繁" : "简"}
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto max-w-[1536px] px-4 py-6 lg:px-7">
        <style>{`
          .admin-webinar-detail{background:radial-gradient(circle at 84% 0%,hsl(187 50% 88%/.44),transparent 29%),linear-gradient(150deg,hsl(199 36% 96%),hsl(188 28% 94%));min-height:100dvh}
          .admin-webinar-detail .admin-detail-tabs{scrollbar-width:thin}
          .admin-webinar-detail [role=tab]{border-radius:.55rem;padding:.58rem .8rem}
          .admin-webinar-detail [role=tab][data-state=active]{background:hsl(var(--primary));color:hsl(var(--primary-foreground));box-shadow:0 2px 8px hsl(201 52% 23%/.15)}
          .admin-workspace-grid{display:grid;grid-template-columns:190px minmax(0,1fr);gap:20px;align-items:start}
          .admin-workspace-rail{position:sticky;top:92px;border:1px solid hsl(var(--border)/.75);border-radius:14px;background:hsl(var(--card)/.82);padding:12px 8px;box-shadow:0 8px 30px hsl(202 36% 30%/.05)}
          .admin-workspace-rail-item{width:100%;display:flex;align-items:center;gap:10px;border-radius:8px;padding:9px 10px;color:hsl(var(--muted-foreground));font-size:13px;text-align:left;transition:background-color .16s ease,color .16s ease}
          .admin-workspace-rail-item:hover{background:hsl(var(--muted));color:hsl(var(--foreground))}
          .admin-workspace-rail-item-active{background:hsl(var(--primary)/.11);color:hsl(var(--primary));font-weight:650}
          .admin-webinar-detail [role=tabpanel]{margin-top:0}
          .admin-webinar-detail .shadcn-card{box-shadow:0 8px 24px hsl(202 35% 25%/.045)}
          .admin-detail-brand-logo{display:none}
          @media(max-width:767px){
            .admin-webinar-detail header .container{display:grid;grid-template-columns:auto minmax(0,1fr);align-items:center}
            .admin-webinar-detail header .container>.flex-1{min-width:0}
            .admin-webinar-detail header .container>.flex-1>div{gap:.55rem}
            .admin-webinar-detail header .container>.flex-1 img:not(.admin-detail-brand-logo){display:none}
            .admin-detail-brand-logo{display:block;width:112px;height:auto;flex:none}
            .admin-webinar-detail header h1{max-width:132px;font-size:.7rem;margin-top:.15rem}
            .admin-webinar-detail header p{display:none}
            .admin-webinar-detail header .container>div:last-child{grid-column:1/-1;display:grid;grid-template-columns:minmax(0,1fr) auto auto;width:100%;gap:.4rem}
            .admin-webinar-detail header [data-testid=button-edit-landing-page]{width:100%;min-width:0}
            .admin-webinar-detail header [data-testid=button-detail-lang-toggle]{min-width:2.75rem;padding:.5rem;font-size:0}
            .admin-webinar-detail header [data-testid=button-detail-lang-toggle] svg{margin:0}
            .admin-workspace-grid{display:block}
            .admin-workspace-rail{position:relative;top:auto;display:flex;gap:4px;overflow-x:auto;margin:0 -1rem 16px;padding:8px 1rem;border-width:1px 0;border-radius:0;box-shadow:none}
            .admin-workspace-rail>div{display:none}
            .admin-workspace-rail-item{width:auto;flex:none;white-space:nowrap}
            .admin-webinar-detail .admin-detail-tabs{display:grid!important;grid-template-columns:repeat(3,minmax(0,1fr));gap:.35rem;overflow:visible;width:100%;margin-left:0;padding:.45rem!important;border-radius:.8rem;border-width:1px}
            .admin-webinar-detail .admin-detail-tabs [role=tab]{min-width:0;min-height:3.25rem;padding:.4rem .2rem;display:flex;flex-direction:column;justify-content:center;gap:.15rem;font-size:.66rem;line-height:1.05;white-space:normal;text-align:center}
            .admin-webinar-detail .admin-detail-tabs [role=tab] svg{margin:0}
          }
        `}</style>
        <Tabs value={activeTab} onValueChange={value => {
          if (value === "ai") {
            setLocation(`/admin/webinar/${id}/ai`);
            return;
          }
          setActiveTab(value);
        }}>
          <TabsList className="admin-detail-tabs mb-5 flex h-auto w-full justify-start gap-1 overflow-x-auto rounded-xl border border-border/70 bg-card/80 p-1.5 shadow-sm">
            <TabsTrigger value="analytics" data-testid="tab-analytics">
              <TrendingUp className="h-4 w-4 mr-1" />
              {s.tabAnalytics}
            </TabsTrigger>
            <TabsTrigger value="schedule" data-testid="tab-schedule">
              <Calendar className="h-4 w-4 mr-1" />
              {s.tabSchedule}
            </TabsTrigger>
            <TabsTrigger value="commerce" data-testid="tab-commerce">
              <ShoppingBag className="h-4 w-4 mr-1" />
              商品與成交頁
            </TabsTrigger>
            <TabsTrigger value="notifications" data-testid="tab-notifications">
              <Bell className="h-4 w-4 mr-1" />
              {s.tabNotifications}
            </TabsTrigger>
            <TabsTrigger value="interactions" data-testid="tab-interactions">
              <MousePointerClick className="h-4 w-4 mr-1" />
              {s.tabInteractions}
            </TabsTrigger>
            <TabsTrigger value="chat" data-testid="tab-chat">
              <MessageSquare className="h-4 w-4 mr-1" />
              {s.tabChat}
            </TabsTrigger>
            <TabsTrigger value="registrations" data-testid="tab-registrations">
              <Users className="h-4 w-4 mr-1" />
              {s.tabRegistrations} ({registrations?.length || 0})
            </TabsTrigger>
            <TabsTrigger value="settings" data-testid="tab-settings">
              <Settings className="h-4 w-4 mr-1" />
              {s.tabSettings}
            </TabsTrigger>
            <TabsTrigger value="ai" data-testid="tab-ai">
              <Bot className="h-4 w-4 mr-1" />
              {s.tabAi}
            </TabsTrigger>
            <TabsTrigger value="salesScript" data-testid="tab-sales-script">
              <Sparkles className="h-4 w-4 mr-1" />
              銷售演講生成器
            </TabsTrigger>
          </TabsList>

          {/* ===== Schedule Tab ===== */}
          <TabsContent value="schedule">
            <div className="flex flex-col gap-5 lg:flex-row">
              <div className="md:w-52 shrink-0">
                <h3 className="font-semibold mb-3">{s.schedNavTitle}</h3>
                <nav className="flex md:flex-col gap-1 overflow-x-auto md:overflow-visible">
                  {[
                    { id: "eventSettings", label: s.schedNavEventSettings, icon: Settings },
                    { id: "scheduledWebinars", label: s.schedNavScheduledWebinars, icon: Calendar },
                    { id: "onDemand", label: s.schedNavOnDemand, icon: Eye },
                    { id: "justInTime", label: s.schedNavJustInTime, icon: Clock },
                    { id: "replays", label: s.schedNavReplays, icon: RefreshCw },
                    { id: "sessionManagement", label: s.schedNavSessionMgmt, icon: Calendar },
                  ].map(item => (
                    <button
                      key={item.id}
                      onClick={() => setScheduleSubSection(item.id)}
                      className={cn(
                        "flex items-center gap-2 px-3 py-2 text-sm text-left whitespace-nowrap transition-colors",
                        scheduleSubSection === item.id
                          ? "bg-primary/10 text-primary font-medium"
                          : "text-muted-foreground hover-elevate"
                      )}
                      data-testid={`button-schedule-nav-${item.id}`}
                    >
                      <item.icon className="h-4 w-4" />
                      {item.label}
                    </button>
                  ))}
                </nav>
              </div>

              <div className="flex-1 min-w-0">
                <Card>
                  <CardContent className="p-6">
                    {(() => {
                      const sm = webinar?.scheduleMode as any;
                      const rs = webinar?.recurringSchedule as any;
                      let modeLabel = s.schedModeFixed;
                      if (sm?.justInTime) modeLabel = s.schedModeJustInTime;
                      else if (rs?.enabled || sm?.recurring) modeLabel = s.schedModeRecurring;
                      if (sm?.onDemand && (rs?.enabled || sm?.recurring || sm?.eventType === "oneTime" || sm?.eventType === "specificDates")) {
                        modeLabel = `${modeLabel} + ${s.schedModeOnDemand}`;
                      } else if (sm?.onDemand) modeLabel = s.schedModeOnDemand;
                      return (
                        <div className="flex items-center gap-2 mb-6 p-3 bg-primary/5 border border-primary/20 rounded-md" data-testid="banner-current-mode">
                          <span className="text-sm text-muted-foreground">{s.schedCurrentMode}：</span>
                          <Badge variant="default" data-testid="badge-current-mode">{modeLabel}</Badge>
                        </div>
                      );
                    })()}
                    {scheduleSubSection === "eventSettings" && (
                      <div className="space-y-6">
                        <h2 className="text-lg font-semibold" data-testid="text-event-settings-title">{s.schedEventSettingsTitle}</h2>

                        <div className="space-y-3">
                          <Label className="font-medium">{s.schedEventType}</Label>
                          <div className="flex flex-wrap gap-4">
                            {[
                              { value: "recurring" as const, label: s.schedRecurring },
                              { value: "oneTime" as const, label: s.schedOneTime },
                              { value: "specificDates" as const, label: s.schedSpecificDates },
                            ].map(opt => (
                              <label key={opt.value} className="flex items-center gap-2 cursor-pointer">
                                <input
                                  type="radio"
                                  name="eventType"
                                  value={opt.value}
                                  checked={eventType === opt.value}
                                  onChange={() => setEventType(opt.value)}
                                  className="accent-primary"
                                  data-testid={`radio-event-type-${opt.value}`}
                                />
                                <span className="text-sm">{opt.label}</span>
                              </label>
                            ))}
                          </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div className="space-y-2">
                              <Label>{s.schedStartDate}</Label>
                              <Input
                                type="date"
                                value={eventStartDate}
                                onChange={(e) => setEventStartDate(e.target.value)}
                                data-testid="input-event-start-date"
                              />
                            </div>
                            <div className="space-y-2">
                              <Label>{s.schedEndDate}</Label>
                              <div className="flex items-center gap-4 flex-wrap">
                                <label className="flex items-center gap-2 cursor-pointer">
                                  <input
                                    type="radio"
                                    name="eventEndType"
                                    value="never"
                                    checked={eventEndType === "never"}
                                    onChange={() => setEventEndType("never")}
                                    className="accent-primary"
                                    data-testid="radio-end-type-never"
                                  />
                                  <span className="text-sm">{s.schedNeverEnd}</span>
                                </label>
                                <label className="flex items-center gap-2 cursor-pointer">
                                  <input
                                    type="radio"
                                    name="eventEndType"
                                    value="endDate"
                                    checked={eventEndType === "endDate"}
                                    onChange={() => setEventEndType("endDate")}
                                    className="accent-primary"
                                    data-testid="radio-end-type-date"
                                  />
                                  <span className="text-sm">{s.schedSpecifyEndDate}</span>
                                </label>
                              </div>
                              {eventEndType === "endDate" && (
                                <Input
                                  type="date"
                                  value={eventEndDate}
                                  onChange={(e) => setEventEndDate(e.target.value)}
                                  data-testid="input-event-end-date"
                                />
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center justify-between gap-4 rounded-md border border-primary/20 bg-primary/5 p-4">
                          <div>
                            <Label className="font-medium">{s.schedEnableOnDemand}</Label>
                            <p className="mt-1 text-sm text-muted-foreground">保留既有場次與排程，讓觀眾多一個報名後立即觀看的選項。</p>
                          </div>
                          <Switch checked={onDemandEnabled} onCheckedChange={setOnDemandEnabled} data-testid="switch-event-on-demand" />
                        </div>

                        <div className="space-y-4 border-t pt-6 mt-6">
                          <h3 className="text-base font-semibold">{s.schedTimezone}</h3>
                          <div className="flex items-center gap-6 flex-wrap">
                            <label className="flex items-center gap-2 cursor-pointer">
                              <input
                                type="radio"
                                name="timezoneType"
                                value="attendee"
                                checked={timezoneType === "attendee"}
                                onChange={() => setTimezoneType("attendee")}
                                className="accent-primary"
                                data-testid="radio-timezone-attendee"
                              />
                              <span className="text-sm">{s.schedAttendeeTimezone}</span>
                            </label>
                            <label className="flex items-center gap-2 cursor-pointer">
                              <input
                                type="radio"
                                name="timezoneType"
                                value="fixed"
                                checked={timezoneType === "fixed"}
                                onChange={() => setTimezoneType("fixed")}
                                className="accent-primary"
                                data-testid="radio-timezone-fixed"
                              />
                              <span className="text-sm">{s.schedFixedTimezone}</span>
                            </label>
                          </div>
                          {timezoneType === "fixed" && (
                            <Select value={settingsTimezone} onValueChange={setSettingsTimezone}>
                              <SelectTrigger data-testid="select-timezone">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="Asia/Taipei">Asia/Taipei ({s.tzTaipei})</SelectItem>
                                <SelectItem value="Asia/Tokyo">Asia/Tokyo ({s.tzTokyo})</SelectItem>
                                <SelectItem value="Asia/Shanghai">Asia/Shanghai ({s.tzShanghai})</SelectItem>
                                <SelectItem value="Asia/Hong_Kong">Asia/Hong_Kong ({s.tzHongKong})</SelectItem>
                                <SelectItem value="America/New_York">America/New_York ({s.tzNewYork})</SelectItem>
                                <SelectItem value="America/Los_Angeles">America/Los_Angeles ({s.tzLosAngeles})</SelectItem>
                                <SelectItem value="Europe/London">Europe/London ({s.tzLondon})</SelectItem>
                                <SelectItem value="Europe/Paris">Europe/Paris ({s.tzParis})</SelectItem>
                                <SelectItem value="Australia/Sydney">Australia/Sydney ({s.tzSydney})</SelectItem>
                              </SelectContent>
                            </Select>
                          )}
                          <div className="flex items-center justify-between gap-2">
                            <Label className="text-sm">{s.schedShowTimezoneOnForm}</Label>
                            <Switch
                              checked={showTimezoneOnForm}
                              onCheckedChange={setShowTimezoneOnForm}
                              data-testid="switch-show-timezone"
                            />
                          </div>
                        </div>

                        <Button
                          onClick={() => {
                            const existingSm = webinar?.scheduleMode as any;
                            const scheduleMode = {
                              recurring: eventType === "recurring",
                              onDemand: onDemandEnabled,
                              justInTime: existingSm?.justInTime || false,
                              justInTimeMinutes: existingSm?.justInTimeMinutes || 15,
                              eventType,
                              eventEndType,
                              eventStartDate: eventStartDate || null,
                              eventEndDate: eventEndType === "endDate" ? eventEndDate : null,
                              timezoneType,
                              showTimezoneOnForm,
                            };
                            const existingRs = webinar?.recurringSchedule as any;
                            updateWebinar.mutate({
                              scheduleMode,
                              // Choosing one-time or specific dates must actually stop the weekly pattern.
                              ...(existingRs ? { recurringSchedule: { ...existingRs, enabled: eventType === "recurring" } } : {}),
                              timezone: timezoneType === "fixed" ? settingsTimezone : (webinar?.timezone || "Asia/Taipei"),
                              startTime: eventStartDate && webinar?.startTime
                                ? applyDatePreservingTime(
                                    webinar.startTime,
                                    eventStartDate,
                                    timezoneType === "fixed" ? settingsTimezone : (webinar.timezone || "Asia/Taipei"),
                                  )
                                : undefined,
                            });
                          }}
                          disabled={updateWebinar.isPending}
                          data-testid="button-save-event-settings"
                        >
                          {updateWebinar.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                          {s.schedSaveEventSettings}
                        </Button>
                      </div>
                    )}

                    {scheduleSubSection === "scheduledWebinars" && (
                      <div className="space-y-6">
                        <h2 className="text-lg font-semibold" data-testid="text-scheduled-webinars-title">{s.schedScheduledTitle}</h2>
                        <p className="text-sm text-muted-foreground">{s.schedScheduledDesc}</p>
                        {(webinar?.scheduleMode as any)?.justInTime && (
                          <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200" data-testid="warning-jit-overrides-recurring">
                            {s.schedJitOverridesRecurring}
                          </p>
                        )}

                        <div className="space-y-4">
                          <div className="flex items-center gap-3 flex-wrap">
                            <Select
                              value={scheduleFrequency}
                              onValueChange={(value) => {
                                setScheduleFrequency(value);
                                if (value === "everyDay") setRecurringDays([0, 1, 2, 3, 4, 5, 6]);
                              }}
                            >
                              <SelectTrigger className="w-40" data-testid="select-schedule-frequency">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="everyDay">{s.schedEveryDay}</SelectItem>
                                <SelectItem value="everyWeek">{s.schedEveryWeek}</SelectItem>
                                <SelectItem value="everyTwoWeeks">{s.schedEveryTwoWeeks}</SelectItem>
                              </SelectContent>
                            </Select>

                            <span className="text-sm text-muted-foreground">{s.schedAt}</span>

                            <div className="flex items-center gap-1 flex-wrap">
                              {[
                                { label: s.schedDayMon, value: 1 },
                                { label: s.schedDayTue, value: 2 },
                                { label: s.schedDayWed, value: 3 },
                                { label: s.schedDayThu, value: 4 },
                                { label: s.schedDayFri, value: 5 },
                                { label: s.schedDaySat, value: 6 },
                                { label: s.schedDaySun, value: 0 },
                              ].map(day => (
                                <label key={day.value} className="flex items-center gap-1 cursor-pointer">
                                  <Checkbox
                                    checked={recurringDays.includes(day.value)}
                                    onCheckedChange={(checked) => {
                                      setRecurringDays(prev =>
                                        checked ? [...prev, day.value].sort() : prev.filter(d => d !== day.value)
                                      );
                                    }}
                                    data-testid={`checkbox-recurring-day-${day.value}`}
                                  />
                                  <span className="text-sm">{day.label}</span>
                                </label>
                              ))}
                            </div>

                            <span className="text-sm text-muted-foreground">{s.schedAtFollowingTimes}</span>
                          </div>

                          <div className="flex items-center gap-2 flex-wrap">
                            {scheduledTimeSlots.map((time, index) => (
                              <Badge key={index} variant="secondary" className="gap-1 px-3 py-1.5">
                                {time}
                                <button
                                  onClick={() => setScheduledTimeSlots(prev => prev.filter((_, i) => i !== index))}
                                  className="ml-1"
                                  data-testid={`button-remove-time-${index}`}
                                >
                                  <X className="h-3 w-3" />
                                </button>
                              </Badge>
                            ))}
                            <div className="flex items-center gap-1">
                              <Input
                                type="time"
                                value={newTimeSlot}
                                onChange={(e) => setNewTimeSlot(e.target.value)}
                                className="w-28"
                                data-testid="input-new-time-slot"
                              />
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  if (newTimeSlot && /^\d{2}:\d{2}$/.test(newTimeSlot)) {
                                    setScheduledTimeSlots(prev => prev.includes(newTimeSlot) ? prev : [...prev, newTimeSlot].sort());
                                    setNewTimeSlot("09:00");
                                  }
                                }}
                                data-testid="button-add-time-slot"
                              >
                                <Plus className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>
                        </div>

                        <div className="space-y-2">
                          <Label>{s.schedExcludeDates}</Label>
                          <Input
                            value={recurringExcludeDates}
                            onChange={(e) => setRecurringExcludeDates(e.target.value)}
                            placeholder="2026-01-01, 2026-02-14"
                            data-testid="input-recurring-exclude"
                          />
                        </div>

                        <div className="flex items-center gap-2 flex-wrap">
                          <Button
                            onClick={() => {
                              const recurringDraftError = (): string | null => {
                                if (!recurringDays.length || !scheduledTimeSlots.length) return s.schedNeedDaysAndTimes;
                                const dates = recurringExcludeDates.split(",").map(d => d.trim()).filter(Boolean);
                                if (dates.some(d => !/^\d{4}-\d{2}-\d{2}$/.test(d))) return s.schedBadExcludeDates;
                                return null;
                              };
                              const problem = recurringDraftError();
                              if (problem) { toast({ title: problem, variant: "destructive" }); return; }
                              updateWebinar.mutate({
                                recurringSchedule: {
                                  enabled: true,
                                  frequency: scheduleFrequency,
                                  days: recurringDays,
                                  times: scheduledTimeSlots,
                                  excludeDates: recurringExcludeDates.split(",").map(d => d.trim()).filter(Boolean),
                                },
                              });
                            }}
                            disabled={updateWebinar.isPending}
                            data-testid="button-save-recurring"
                          >
                            {updateWebinar.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                            {s.schedSaveRecurring}
                          </Button>
                          <Button
                            variant="outline"
                            onClick={async () => {
                              const recurringDraftError = (): string | null => {
                                if (!recurringDays.length || !scheduledTimeSlots.length) return s.schedNeedDaysAndTimes;
                                const dates = recurringExcludeDates.split(",").map(d => d.trim()).filter(Boolean);
                                if (dates.some(d => !/^\d{4}-\d{2}-\d{2}$/.test(d))) return s.schedBadExcludeDates;
                                return null;
                              };
                              const problem = recurringDraftError();
                              if (problem) { toast({ title: problem, variant: "destructive" }); return; }
                              try {
                                await apiRequest("PATCH", `/api/webinars/${id}`, {
                                  recurringSchedule: {
                                    enabled: true,
                                    frequency: scheduleFrequency,
                                    days: recurringDays,
                                    times: scheduledTimeSlots,
                                    excludeDates: recurringExcludeDates.split(",").map(d => d.trim()).filter(Boolean),
                                  },
                                });
                                await apiRequest("POST", `/api/webinars/${id}/generate-sessions`, { days: 30 });
                                queryClient.invalidateQueries({ queryKey: ["/api/webinars", id] });
                                queryClient.invalidateQueries({ queryKey: ["/api/webinars", id, "sessions"] });
                                toast({ title: s.toastSessionsGenerated });
                              } catch (err: any) {
                                toast({ title: s.toastGenerateFailed, description: err.message, variant: "destructive" });
                              }
                            }}
                            data-testid="button-generate-sessions"
                          >
                            <RefreshCw className="h-4 w-4 mr-1" />
                            {s.schedGenerateSessions}
                          </Button>
                        </div>
                      </div>
                    )}

                    {scheduleSubSection === "onDemand" && (
                      <div className="space-y-6">
                        <h2 className="text-lg font-semibold" data-testid="text-on-demand-title">{s.schedOnDemandTitle}</h2>
                        <p className="text-sm text-muted-foreground">{s.schedOnDemandDesc}</p>
                        <div className="p-4 bg-muted rounded-md">
                          <p className="text-sm">{s.schedOnDemandNote}</p>
                        </div>
                        {(webinar?.scheduleMode as any)?.onDemand && (
                          <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400" data-testid="status-on-demand-active">
                            <CheckCircle2 className="h-4 w-4" />
                            {s.schedActiveBadge}
                          </div>
                        )}
                        <Button
                          onClick={() => {
                            const existingSm = webinar?.scheduleMode as any;
                            setOnDemandEnabled(!existingSm?.onDemand);
                            updateWebinar.mutate({
                              scheduleMode: {
                                ...existingSm,
                                onDemand: !existingSm?.onDemand,
                                recurring: existingSm?.recurring ?? Boolean((webinar?.recurringSchedule as any)?.enabled),
                                justInTime: existingSm?.justInTime ?? false,
                                justInTimeMinutes: existingSm?.justInTimeMinutes ?? 15,
                              },
                            });
                          }}
                          disabled={updateWebinar.isPending}
                          variant="outline"
                          data-testid="button-enable-on-demand"
                        >
                          {updateWebinar.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                          {(webinar?.scheduleMode as any)?.onDemand ? "停用隨選觀看" : s.schedEnableOnDemand}
                        </Button>
                      </div>
                    )}

                    {scheduleSubSection === "justInTime" && (
                      <div className="space-y-6">
                        <h2 className="text-lg font-semibold" data-testid="text-jit-title">{s.schedJitTitle}</h2>
                        <p className="text-sm text-muted-foreground">{s.schedJitDesc}</p>
                        <div className="space-y-2">
                          <Label>{s.schedJitWaitMinutes}</Label>
                          <Input
                            type="number"
                            min="1"
                            value={settingsJitMinutes}
                            onChange={(e) => setSettingsJitMinutes(e.target.value)}
                            data-testid="input-jit-minutes"
                          />
                          <p className="text-xs text-muted-foreground">{s.schedJitNote}</p>
                        </div>
                        {(webinar?.scheduleMode as any)?.justInTime && (
                          <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400" data-testid="status-jit-active">
                            <CheckCircle2 className="h-4 w-4" />
                            {s.schedActiveBadge}
                          </div>
                        )}
                        <Button
                          onClick={() => {
                            const existingSm = webinar?.scheduleMode as any;
                            setSettingsScheduleMode("justInTime");
                            updateWebinar.mutate({
                              scheduleMode: {
                                ...existingSm,
                                justInTime: true,
                                justInTimeMinutes: parseInt(settingsJitMinutes) || 15,
                              },
                            });
                          }}
                          disabled={updateWebinar.isPending}
                          variant={(webinar?.scheduleMode as any)?.justInTime ? "outline" : "default"}
                          data-testid="button-save-jit"
                        >
                          {updateWebinar.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                          {s.schedSaveJit}
                        </Button>
                        {(webinar?.scheduleMode as any)?.justInTime && (
                          <Button
                            variant="ghost"
                            className="ml-2 text-muted-foreground"
                            onClick={() => {
                              const existingSm = webinar?.scheduleMode as any;
                              updateWebinar.mutate({ scheduleMode: { ...existingSm, justInTime: false } });
                            }}
                            disabled={updateWebinar.isPending}
                            data-testid="button-disable-jit"
                          >
                            {s.schedJitDisable}
                          </Button>
                        )}
                      </div>
                    )}

                    {scheduleSubSection === "replays" && (
                      <div className="space-y-6">
                        <h2 className="text-lg font-semibold" data-testid="text-replays-title">{s.schedReplaysTitle}</h2>
                        <p className="text-sm text-muted-foreground">{s.schedReplaysDesc}</p>
                        <div className="flex items-center justify-between gap-2">
                          <Label>{s.schedEnableReplay}</Label>
                          <Switch
                            checked={settingsReplayEnabled}
                            onCheckedChange={setSettingsReplayEnabled}
                            data-testid="switch-replay-enabled"
                          />
                        </div>
                        {settingsReplayEnabled && (
                          <div className="space-y-2">
                            <Label>{s.schedReplayHours}</Label>
                            <Input
                              type="number"
                              min="1"
                              value={settingsReplayHours}
                              onChange={(e) => setSettingsReplayHours(e.target.value)}
                              data-testid="input-replay-hours"
                            />
                            <p className="text-xs text-muted-foreground">{s.schedReplayNote}</p>
                          </div>
                        )}
                        <Button
                          onClick={() => {
                            updateWebinar.mutate({
                              replayEnabled: settingsReplayEnabled,
                              replayAvailableHours: parseInt(settingsReplayHours) || 48,
                            });
                          }}
                          disabled={updateWebinar.isPending}
                          data-testid="button-save-replay"
                        >
                          {updateWebinar.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                          {s.schedSaveReplay}
                        </Button>
                      </div>
                    )}

                    {scheduleSubSection === "sessionManagement" && (
                      <div className="space-y-6">
                        <h2 className="text-lg font-semibold" data-testid="text-session-mgmt-title">{s.schedSessionMgmtTitle}</h2>
                        <p className="text-sm text-muted-foreground">{s.schedSessionMgmtDesc}</p>

                        {(webinar?.scheduleMode as any)?.justInTime && (
                          <div className="flex items-start gap-2 p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 rounded-md text-sm text-amber-700 dark:text-amber-400" data-testid="note-session-not-needed">
                            <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
                            <span>{s.schedSessionNotNeeded}</span>
                          </div>
                        )}

                        <div className="flex items-center gap-2 flex-wrap">
                          <Input
                            type="datetime-local"
                            aria-label={s.schedAddSession}
                            value={newSessionDate}
                            onChange={(e) => setNewSessionDate(e.target.value)}
                            data-testid="input-new-session-date"
                          />
                          <Button
                            onClick={async () => {
                              if (!newSessionDate) return;
                              try {
                                await apiRequest("POST", `/api/webinars/${id}/sessions`, {
                                  scheduledStart: new Date(newSessionDate).toISOString(),
                                });
                                queryClient.invalidateQueries({ queryKey: ["/api/webinars", id, "sessions"] });
                                setNewSessionDate("");
                                toast({ title: s.toastSessionAdded });
                              } catch (err: any) {
                                toast({ title: s.toastAddFailed, description: err.message, variant: "destructive" });
                              }
                            }}
                            disabled={!newSessionDate}
                            data-testid="button-add-session"
                          >
                            <Plus className="h-4 w-4 mr-1" />
                            {s.schedAddSession}
                          </Button>
                        </div>

                        {webinarSessions && webinarSessions.some(session => session.status !== "cancelled") ? (
                          <div className="space-y-2">
                            {webinarSessions.filter(session => session.status !== "cancelled").map((session) => (
                              <div key={session.id} className="flex items-center justify-between gap-2 p-3 bg-muted rounded-md">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <Clock className="h-4 w-4 text-muted-foreground" />
                                  <span className="text-sm">
                                    {new Date(session.scheduledStart).toLocaleString(lang, {
                                      year: "numeric", month: "2-digit", day: "2-digit",
                                      hour: "2-digit", minute: "2-digit",
                                    })}
                                  </span>
                                  <Badge variant={
                                    new Date(session.scheduledStart) > new Date() ? "default" : "secondary"
                                  }>
                                    {new Date(session.scheduledStart) > new Date() ? s.schedSessionUpcoming : s.schedSessionExpired}
                                  </Badge>
                                </div>
                                {editingSessionId === session.id ? (
                                  <div className="flex items-center gap-1 flex-wrap">
                                    <Input
                                      type="datetime-local"
                                      aria-label={s.sessionNewTimeAria}
                                      value={editingSessionDate}
                                      onChange={(e) => setEditingSessionDate(e.target.value)}
                                      className="h-8 w-auto"
                                      data-testid={`input-edit-session-${session.id}`}
                                    />
                                    <Button
                                      size="sm"
                                      disabled={!editingSessionDate || moveSession.isPending}
                                      onClick={() => moveSession.mutate({ sessionId: session.id, date: editingSessionDate })}
                                      data-testid={`button-save-session-${session.id}`}
                                    >
                                      {s.btnSave}
                                    </Button>
                                    <Button size="sm" variant="ghost" onClick={() => setEditingSessionId(null)}>
                                      {s.btnCancel}
                                    </Button>
                                  </div>
                                ) : (
                                <div className="flex items-center">
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  aria-label={s.sessionEditAria}
                                  onClick={() => {
                                    const start = new Date(session.scheduledStart);
                                    setEditingSessionDate(new Date(start.getTime() - start.getTimezoneOffset() * 60_000).toISOString().slice(0, 16));
                                    setEditingSessionId(session.id);
                                  }}
                                  data-testid={`button-edit-session-${session.id}`}
                                >
                                  <Edit className="h-4 w-4" />
                                </Button>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  onClick={() => {
                                    const remove = async (force: boolean) => {
                                      try {
                                        await apiRequest("DELETE", `/api/webinars/${id}/sessions/${session.id}${force ? "?force=1" : ""}`);
                                        queryClient.invalidateQueries({ queryKey: ["/api/webinars", id, "sessions"] });
                                        toast({ title: s.toastSessionDeleted });
                                      } catch (err: any) {
                                        const registered = String(err?.message || "").match(/^409:.*"registrations":(\d+)/);
                                        if (registered) {
                                          setPendingConfirm({
                                            title: s.confirmDeleteSessionTitle,
                                            description: s.confirmDeleteSessionDesc.replace("{n}", registered[1]),
                                            run: () => void remove(true),
                                          });
                                          return;
                                        }
                                        toast({ title: s.toastDeleteFailed, description: err.message, variant: "destructive" });
                                      }
                                    };
                                    confirmDelete(() => void remove(false));
                                  }}
                                  data-testid={`button-delete-session-${session.id}`}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                                </div>
                                )}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-sm text-muted-foreground text-center py-2">{s.schedNoSessions}</p>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            </div>
          </TabsContent>

          {/* ===== Notifications Tab ===== */}
          <TabsContent value="notifications">
            <div className="admin-workspace-grid">
              {contextualRail([
                { id: "notifications", label: "通知設定", icon: Bell },
                { id: "webhooks", label: "Webhook", icon: Link2 },
                { id: "email-sequences", label: s.seqTitle, icon: Mail },
              ], notificationsSection, setNotificationsSection)}
              <div className="space-y-6">
              {notificationsSection === "notifications" && <>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Bell className="h-4 w-4" />
                    {s.ntQuestionNotify}
                  </CardTitle>
                  <CardDescription>{s.ntQuestionNotifyHint}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between gap-2">
                    <Label>{s.ntQuestionNotify}</Label>
                    <Switch
                      checked={notifyQuestionEmail}
                      onCheckedChange={setNotifyQuestionEmail}
                      data-testid="switch-notify-question"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>{s.ntEmail}</Label>
                    <Input
                      type="email"
                      value={notifyEmail}
                      onChange={(e) => setNotifyEmail(e.target.value)}
                      placeholder="name@example.com"
                      data-testid="input-notify-email"
                    />
                  </div>
                  <Button
                    onClick={() => saveNotify.mutate()}
                    disabled={saveNotify.isPending}
                    data-testid="button-save-notify"
                  >
                    {saveNotify.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
                    {s.ntSave}
                  </Button>
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Mail className="h-4 w-4" />
                    {s.notifEmailTitle}
                  </CardTitle>
                  <CardDescription>{s.notifEmailDesc}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <Label className="flex-1">{s.notifEmailConfirmation}</Label>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => setEmailPreview({ kind: "confirmation", title: s.notifEmailConfirmation, customSubject: emailCustomSubject, customTemplate: emailCustomTemplate })}
                        data-testid="button-preview-email-confirmation"
                      >
                        <Eye className="h-4 w-4 mr-1" />{s.btnPreview}
                      </Button>
                      <Switch
                        checked={emailConfirmation}
                        onCheckedChange={setEmailConfirmation}
                        data-testid="switch-email-confirmation"
                      />
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <Label className="flex-1">{s.notifEmail24h}</Label>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => setEmailPreview({ kind: "reminder_24h", title: s.notifEmail24h, customSubject: emailCustomSubject, customTemplate: emailCustomTemplate })}
                        data-testid="button-preview-email-reminder_24h"
                      >
                        <Eye className="h-4 w-4 mr-1" />{s.btnPreview}
                      </Button>
                      <Switch
                        checked={emailReminder24h}
                        onCheckedChange={setEmailReminder24h}
                        data-testid="switch-email-24h"
                      />
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <Label className="flex-1">{s.notifEmail1h}</Label>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => setEmailPreview({ kind: "reminder_1h", title: s.notifEmail1h, customSubject: emailCustomSubject, customTemplate: emailCustomTemplate })}
                        data-testid="button-preview-email-reminder_1h"
                      >
                        <Eye className="h-4 w-4 mr-1" />{s.btnPreview}
                      </Button>
                      <Switch
                        checked={emailReminder1h}
                        onCheckedChange={setEmailReminder1h}
                        data-testid="switch-email-1h"
                      />
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <Label className="flex-1">{s.notifEmailFollowUp}</Label>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => setEmailPreview({ kind: "followup", title: s.notifEmailFollowUp, customSubject: emailCustomSubject, customTemplate: emailCustomTemplate })}
                        data-testid="button-preview-email-followup"
                      >
                        <Eye className="h-4 w-4 mr-1" />{s.btnPreview}
                      </Button>
                      <Switch
                        checked={emailFollowUp}
                        onCheckedChange={setEmailFollowUp}
                        data-testid="switch-email-followup"
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>{s.notifEmailSubject}</Label>
                    <Input
                      value={emailCustomSubject}
                      onChange={(e) => setEmailCustomSubject(e.target.value)}
                      placeholder={s.notifEmailSubjectPlaceholder}
                      data-testid="input-email-subject"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>{s.notifEmailTemplate}</Label>
                    <Textarea
                      value={emailCustomTemplate}
                      onChange={(e) => setEmailCustomTemplate(e.target.value)}
                      placeholder={s.notifEmailTemplatePlaceholder}
                      rows={4}
                      data-testid="input-email-template"
                    />
                    <p className="text-xs text-muted-foreground">{s.emailCustomNote}</p>
                  </div>
                  <Button
                    onClick={() => {
                      updateWebinar.mutate({
                        emailSettings: {
                          confirmationEnabled: emailConfirmation,
                          reminder24hEnabled: emailReminder24h,
                          reminder1hEnabled: emailReminder1h,
                          followUpEnabled: emailFollowUp,
                          customSubject: emailCustomSubject,
                          customTemplate: emailCustomTemplate,
                        },
                      });
                    }}
                    disabled={updateWebinar.isPending}
                    data-testid="button-save-email"
                  >
                    {updateWebinar.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                    {s.notifSaveEmail}
                  </Button>
                </CardContent>
              </Card>
              </>}

              {notificationsSection === "webhooks" && (
              <Card>
                <CardHeader className="flex flex-row items-center justify-between gap-2">
                  <div>
                    <CardTitle className="text-base flex items-center gap-2">
                      <Link2 className="h-4 w-4" />
                      {s.notifWebhookTitle}
                    </CardTitle>
                    <CardDescription>{s.notifWebhookDesc}</CardDescription>
                  </div>
                  <Dialog open={isWebhookOpen} onOpenChange={setIsWebhookOpen}>
                    <DialogTrigger asChild>
                      <Button size="sm" data-testid="button-add-webhook">
                        <Plus className="h-4 w-4 mr-1" />
                        {s.notifAddWebhook}
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>{s.notifWebhookDialogTitle}</DialogTitle>
                        <DialogDescription>{s.notifWebhookDialogDesc}</DialogDescription>
                      </DialogHeader>
                      <div className="space-y-4">
                        <div className="space-y-2">
                          <Label>{s.notifWebhookEventType}</Label>
                          <Select value={newWebhookEvent} onValueChange={setNewWebhookEvent}>
                            <SelectTrigger data-testid="select-webhook-event">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="registration">{s.notifWebhookRegistration}</SelectItem>
                              <SelectItem value="attendance">{s.notifWebhookAttendance}</SelectItem>
                              <SelectItem value="completion">{s.notifWebhookCompletion}</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <Label>{s.notifWebhookTargetUrl}</Label>
                          <Input
                            value={newWebhookUrl}
                            onChange={(e) => setNewWebhookUrl(e.target.value)}
                            placeholder="https://example.com/webhook"
                            data-testid="input-webhook-url"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>{s.notifWebhookSecret}</Label>
                          <Input
                            value={newWebhookSecret}
                            onChange={(e) => setNewWebhookSecret(e.target.value)}
                            placeholder={s.notifWebhookSecretPlaceholder}
                            data-testid="input-webhook-secret"
                          />
                        </div>
                        <Button
                          onClick={() => {
                            if (!newWebhookUrl) {
                              toast({ title: s.toastEnterTargetUrl, variant: "destructive" });
                              return;
                            }
                            createWebhook.mutate({
                              webinarId: id!,
                              eventType: newWebhookEvent,
                              targetUrl: newWebhookUrl,
                              secret: newWebhookSecret,
                              enabled: true,
                            });
                          }}
                          disabled={createWebhook.isPending || !newWebhookUrl}
                          data-testid="button-submit-webhook"
                        >
                          {createWebhook.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                          {s.btnCreate}
                        </Button>
                      </div>
                    </DialogContent>
                  </Dialog>
                </CardHeader>
                <CardContent>
                  {webhooks && webhooks.length > 0 ? (
                    <div className="space-y-2">
                      {webhooks.map((hook) => (
                        <div key={hook.id} className="flex items-center justify-between p-3 bg-muted rounded-md gap-2" data-testid={`webhook-item-${hook.id}`}>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <Badge variant="outline">{hook.eventType}</Badge>
                              <Badge variant={hook.enabled ? "default" : "secondary"}>
                                {hook.enabled ? s.notifWebhookEnabled : s.notifWebhookDisabled}
                              </Badge>
                            </div>
                            <p className="text-xs text-muted-foreground mt-1 truncate">{hook.targetUrl}</p>
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => deleteWebhook.mutate(hook.id)}
                            data-testid={`button-delete-webhook-${hook.id}`}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-center text-muted-foreground py-8">{s.notifNoWebhooks}</p>
                  )}
                </CardContent>
              </Card>
              )}

              {notificationsSection === "email-sequences" && <>
              <Card className="border-primary/40 bg-primary/5">
                <CardHeader className="flex flex-row items-center justify-between gap-2">
                  <div>
                    <CardTitle className="text-base flex items-center gap-2">
                      <Sparkles className="h-4 w-4 text-primary" />
                      {s.seqTitle}
                    </CardTitle>
                    <CardDescription>{s.seqDesc}</CardDescription>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => generateEmailSequence.mutate()}
                    disabled={generateEmailSequence.isPending}
                    data-testid="button-ai-gen-sequence"
                  >
                    {generateEmailSequence.isPending
                      ? (<><Loader2 className="h-4 w-4 mr-1 animate-spin" />{s.aiGenerating}</>)
                      : (<><Sparkles className="h-4 w-4 mr-1" />{s.seqGenBtn}</>)}
                  </Button>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Input
                      value={seqGoal}
                      onChange={(e) => setSeqGoal(e.target.value)}
                      placeholder={s.aiGenGoalPlaceholder}
                      data-testid="input-seq-goal"
                    />
                    <p className="text-xs text-muted-foreground">{s.aiGenCostHint}</p>
                  </div>
                  <p className="text-xs text-muted-foreground">{s.seqLinkNote}</p>
                  {emailSequences && emailSequences.length > 0 ? (
                    <div className="space-y-3">
                      {emailSequences.map((seq) => (
                        <div key={seq.id} className="border rounded-md p-3 space-y-2 bg-background" data-testid={`row-sequence-${seq.id}`}>
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary" data-testid={`text-seq-segment-${seq.id}`}>
                                {seq.segment === "watched" ? s.seqSegWatched : seq.segment === "not_watched" ? s.seqSegNotWatched : seq.segment === "no_show" ? s.seqSegNoShow : s.seqSegAll}
                              </span>
                              <span className="text-xs text-muted-foreground">
                                {s.seqSendAfter} {formatDelayMinutes(seq.delayMinutes)}
                              </span>
                            </div>
                            <div className="flex items-center gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => setEmailPreview({ kind: "sequence", sequenceId: seq.id, title: seq.name || seq.subject })}
                                data-testid={`button-preview-seq-${seq.id}`}
                              >
                                <Eye className="h-4 w-4 mr-1" />{s.btnPreview}
                              </Button>
                              <Switch
                                checked={!!seq.enabled}
                                onCheckedChange={(v) => updateSequence.mutate({ seqId: seq.id, patch: { enabled: v } })}
                                data-testid={`switch-seq-enabled-${seq.id}`}
                              />
                              <Button
                                size="icon"
                                variant="ghost"
                                onClick={() => deleteSequence.mutate(seq.id)}
                                data-testid={`button-delete-seq-${seq.id}`}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>
                          <p className="text-sm font-medium" data-testid={`text-seq-subject-${seq.id}`}>{seq.subject}</p>
                          <p
                            className="text-sm text-muted-foreground line-clamp-3 border-t pt-2"
                            data-testid={`text-seq-body-${seq.id}`}
                          >
                            {htmlToPlainText(seq.htmlBody)}
                          </p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-center text-muted-foreground py-8">{s.seqEmpty}</p>
                  )}
                </CardContent>
              </Card>

              <Card className="border-primary/40 bg-primary/5">
                <CardHeader className="flex flex-row items-center justify-between gap-2">
                  <div>
                    <CardTitle className="text-base flex items-center gap-2">
                      <Megaphone className="h-4 w-4 text-primary" />
                      {s.postTitle}
                    </CardTitle>
                    <CardDescription>{s.postDesc}</CardDescription>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => generateSocialPosts.mutate()}
                    disabled={generateSocialPosts.isPending}
                    data-testid="button-ai-gen-posts"
                  >
                    {generateSocialPosts.isPending
                      ? (<><Loader2 className="h-4 w-4 mr-1 animate-spin" />{s.aiGenerating}</>)
                      : (<><Sparkles className="h-4 w-4 mr-1" />{s.postGenBtn}</>)}
                  </Button>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Input
                      value={postGoal}
                      onChange={(e) => setPostGoal(e.target.value)}
                      placeholder={s.aiGenGoalPlaceholder}
                      data-testid="input-post-goal"
                    />
                    <p className="text-xs text-muted-foreground">{s.aiGenCostHint}</p>
                  </div>
                  {socialPosts && socialPosts.length > 0 ? (
                    <div className="space-y-3">
                      {socialPosts.map((post) => (
                        <div key={post.id} className="border rounded-md p-3 space-y-2 bg-background" data-testid={`row-post-${post.id}`}>
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary uppercase" data-testid={`text-post-platform-${post.id}`}>
                              {post.platform}
                            </span>
                            <div className="flex items-center gap-1">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  navigator.clipboard.writeText(post.content);
                                  toast({ title: s.postCopied });
                                }}
                                data-testid={`button-copy-post-${post.id}`}
                              >
                                <Copy className="h-4 w-4 mr-1" />
                                {s.postCopy}
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                onClick={() => deletePost.mutate(post.id)}
                                data-testid={`button-delete-post-${post.id}`}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>
                          <p className="text-sm whitespace-pre-wrap" data-testid={`text-post-content-${post.id}`}>{post.content}</p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-center text-muted-foreground py-8">{s.postEmpty}</p>
                  )}
                </CardContent>
              </Card>
              </>}
              </div>
            </div>
          </TabsContent>

          {/* ===== Commerce Tab ===== */}
          <TabsContent value="commerce">
            <div className="space-y-6">
              <Card className="border-primary/30">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <ShoppingBag className="h-5 w-5 text-primary" />
                    商品與成交頁
                  </CardTitle>
                  <CardDescription>
                    管理這場 Webinar 專屬的商品、售價、成交頁與公開下單網址。
                  </CardDescription>
                </CardHeader>
              </Card>
              <Card>
                <CardHeader className="flex flex-row items-center justify-between gap-2">
                  <div>
                    <CardTitle className="text-base">銷售商品</CardTitle>
                    <CardDescription>商品款由你的綠界商店直接收取；每個商品都能建立自己的成交頁。</CardDescription>
                  </div>
                  <Dialog open={isOfferOpen} onOpenChange={setIsOfferOpen}>
                    <DialogTrigger asChild>
                      <Button size="sm" data-testid="button-add-offer"><Plus className="h-4 w-4 mr-1" />新增商品</Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>新增銷售商品</DialogTitle>
                        <DialogDescription>{offerProvider === "ecpay" ? "商品款由你的綠界商店直接收取，售價請輸入新台幣整數元。" : "Stripe 金額請使用最小貨幣單位，例如 USD 10.00 輸入 1000。"}</DialogDescription>
                      </DialogHeader>
                      <div className="space-y-4">
                        <div className="space-y-2"><Label>收款方式</Label><Input value="綠界 ECPay（會員自有商店）" disabled data-testid="input-offer-provider" /></div>
                        <div className="space-y-2"><Label>商品名稱</Label><Input value={offerName} onChange={(e) => setOfferName(e.target.value)} data-testid="input-offer-name" /></div>
                        <div className="space-y-2"><Label>售價（新台幣整數元）</Label><Input type="number" min="1" step="1" value={offerAmountMinor} onChange={(e) => setOfferAmountMinor(e.target.value)} data-testid="input-offer-amount" /></div>
                        <Button onClick={() => createOffer.mutate()} disabled={createOffer.isPending} data-testid="button-create-offer">
                          {createOffer.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}建立商品
                        </Button>
                      </div>
                    </DialogContent>
                  </Dialog>
                </CardHeader>
                <CardContent>
                  {offers?.length ? <div className="space-y-3">{offers.map((offer) => {
                    const salesPage = salesPages?.find((page) => page.offerId === offer.id);
                    const publicUrl = salesPage ? `${window.location.origin}/sales/${salesPage.slug}` : "";
                    return <div key={offer.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/40 p-4">
                      <div>
                        <div className="font-medium">{offer.name}</div>
                        <div className="mt-1 flex items-center gap-2">
                          <Badge variant="secondary">{offer.paymentProvider === "ecpay" ? "綠界收款" : "Stripe"}</Badge>
                          <Badge variant="outline">{formatMinorCurrency(offer.currency, offer.amountMinor)}</Badge>
                          {salesPage && <Badge variant={salesPage.status === "published" ? "default" : "secondary"}>{salesPage.status === "published" ? "成交頁已發布" : "成交頁草稿"}</Badge>}
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        {salesPage ? <>
                          <Button size="sm" variant="outline" onClick={() => setLocation(`/admin/webinar/${id}/sales/${salesPage.id}`)}><Edit className="h-3.5 w-3.5 mr-1" />編輯成交頁</Button>
                          {salesPage.status === "published" && <>
                            <Button size="sm" variant="outline" onClick={() => navigator.clipboard.writeText(publicUrl)}><Copy className="h-3.5 w-3.5 mr-1" />複製下單網址</Button>
                            <Button size="sm" variant="ghost" onClick={() => window.open(publicUrl, "_blank", "noopener,noreferrer")}><ExternalLink className="h-3.5 w-3.5 mr-1" />開啟商品頁</Button>
                          </>}
                        </> : <Button size="sm" variant="outline" onClick={() => setSalesTemplateOffer(offer)} disabled={createSalesPage.isPending}><FileText className="h-3.5 w-3.5 mr-1" />建立成交頁</Button>}
                      </div>
                    </div>
                  })}</div> : <div className="rounded-lg border border-dashed py-12 text-center">
                    <ShoppingBag className="mx-auto h-8 w-8 text-muted-foreground/60" />
                    <p className="mt-3 font-medium">這場 Webinar 還沒有商品</p>
                    <p className="mt-1 text-sm text-muted-foreground">先新增商品與售價，再建立可分享給客戶的成交頁。</p>
                  </div>}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* ===== Interactions Tab ===== */}
          <TabsContent value="interactions">
            <div className="admin-workspace-grid">
              {contextualRail([
                { id: "cta", label: s.interCtaTitle, icon: MousePointerClick },
                { id: "polls", label: s.interPollTitle, icon: BarChart },
                { id: "tips", label: s.interTipTitle, icon: Lightbulb },
                { id: "survey", label: s.interFeedbackTitle, icon: Star },
                { id: "questions", label: s.interQaTitle, icon: HelpCircle },
              ], interactionsSection, setInteractionsSection)}
              <div className="space-y-6">
              <Card className="border-primary/40 bg-primary/5">
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-primary" />
                    {s.aiGenInterTitle}
                  </CardTitle>
                  <CardDescription>{s.aiGenInterDesc}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label>{s.aiGenGoalLabel}</Label>
                    <Input
                      value={aiGenGoal}
                      onChange={(e) => setAiGenGoal(e.target.value)}
                      placeholder={s.aiGenGoalPlaceholder}
                      data-testid="input-ai-gen-goal"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="ai-gen-replace"
                      checked={aiGenReplace}
                      onCheckedChange={(v) => setAiGenReplace(v === true)}
                      data-testid="checkbox-ai-gen-replace"
                    />
                    <Label htmlFor="ai-gen-replace" className="cursor-pointer">{s.aiGenReplace}</Label>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs text-muted-foreground">{s.aiGenCostHint}</p>
                    <Button
                      onClick={() => generateInteractions.mutate()}
                      disabled={generateInteractions.isPending}
                      data-testid="button-ai-gen-interactions"
                    >
                      {generateInteractions.isPending
                        ? (<><Loader2 className="h-4 w-4 mr-1 animate-spin" />{s.aiGenerating}</>)
                        : (<><Sparkles className="h-4 w-4 mr-1" />{s.aiGenInterBtn}</>)}
                    </Button>
                  </div>
                </CardContent>
              </Card>
              <Card id="webinar-section-cta" className="scroll-mt-28">
                <CardHeader className="flex flex-row items-center justify-between gap-2">
                  <div>
                    <CardTitle className="text-base">{s.interCtaTitle}</CardTitle>
                    <CardDescription>{s.interCtaDesc}</CardDescription>
                  </div>
                    <Dialog open={isCtaOpen} onOpenChange={open => { setIsCtaOpen(open); if (!open) setEditingCta(null); }}>
                    <DialogTrigger asChild>
                      <Button size="sm" data-testid="button-add-cta" onClick={() => { setEditingCta(null); ctaForm.reset(); }}>
                        <Plus className="h-4 w-4 mr-1" />
                        {s.interAddCta}
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>{editingCta ? s.editCtaTitle : s.interCtaDialogTitle}</DialogTitle>
                      </DialogHeader>
                      <Form {...ctaForm}>
                        <form onSubmit={ctaForm.handleSubmit((data) => createCta.mutate(data))} className="space-y-4">
                          <FormField
                            control={ctaForm.control}
                            name="text"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>{s.interCtaButtonText}</FormLabel>
                                <FormControl>
                                  <Input placeholder={s.interCtaButtonTextPlaceholder} {...field} />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={ctaForm.control}
                            name="offerId"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>目的地</FormLabel>
                                <Select value={ctaForm.watch("salesPageId") ? `page:${ctaForm.watch("salesPageId")}` : field.value ? `offer:${field.value}` : "__external__"} onValueChange={(value) => {
                                  ctaForm.setValue("url", "");
                                  ctaForm.setValue("offerId", value.startsWith("offer:") ? value.slice(6) : "");
                                  ctaForm.setValue("salesPageId", value.startsWith("page:") ? value.slice(5) : "");
                                }}>
                                  <FormControl><SelectTrigger data-testid="select-cta-offer"><SelectValue /></SelectTrigger></FormControl>
                                  <SelectContent>
                                    <SelectItem value="__external__">外部網址</SelectItem>
                                    {(productSalesPages || []).filter(page => page.status === "published").map(page => <SelectItem key={page.id} value={`page:${page.id}`}>站內商品頁：{page.title || page.slug}</SelectItem>)}
                                    {(memberProducts || offers || []).filter(offer => offer.active !== false).map((offer) => <SelectItem key={offer.id} value={`offer:${offer.id}`}>直接購買：{offer.name}</SelectItem>)}
                                  </SelectContent>
                                </Select>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          {!ctaForm.watch("offerId") && !ctaForm.watch("salesPageId") && <FormField
                            control={ctaForm.control}
                            name="url"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>{s.interCtaLinkUrl}</FormLabel>
                                <FormControl>
                                  <Input placeholder="https://..." {...field} />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />}
                          <div className="grid grid-cols-2 gap-4">
                            <FormField
                              control={ctaForm.control}
                              name="startTime"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel>{s.interCtaStartTime}</FormLabel>
                                  <FormControl>
                                    <Input placeholder="5:00" {...field} />
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                            <FormField
                              control={ctaForm.control}
                              name="endTime"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel>{s.interCtaEndTime}</FormLabel>
                                  <FormControl>
                                    <Input placeholder="10:00" {...field} />
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                          </div>
                          <FormField
                            control={ctaForm.control}
                            name="style"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>{s.interCtaStyle}</FormLabel>
                                <Select onValueChange={field.onChange} value={field.value}>
                                  <FormControl>
                                    <SelectTrigger>
                                      <SelectValue />
                                    </SelectTrigger>
                                  </FormControl>
                                  <SelectContent>
                                    <SelectItem value="primary">{s.interCtaStylePrimary}</SelectItem>
                                    <SelectItem value="secondary">{s.interCtaStyleSecondary}</SelectItem>
                                    <SelectItem value="danger">{s.interCtaStyleDanger}</SelectItem>
                                  </SelectContent>
                                </Select>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <Button type="submit" disabled={createCta.isPending}>
                            {createCta.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                            {editingCta ? s.btnSave : s.btnCreate}
                          </Button>
                        </form>
                      </Form>
                    </DialogContent>
                  </Dialog>
                </CardHeader>
                <CardContent>
                  {ctas && ctas.length > 0 ? (
                    <div className="space-y-2">
                      {ctas.sort((a, b) => a.startTime - b.startTime).map((cta) => (
                        <div key={cta.id} className="flex items-center justify-between p-3 bg-muted rounded-md gap-2">
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <Badge variant="outline">
                                {formatTime(cta.startTime)} - {cta.endTime ? formatTime(cta.endTime) : s.interCtaEnd}
                              </Badge>
                              <Badge variant={cta.style === "primary" ? "default" : cta.style === "danger" ? "destructive" : "secondary"}>
                                {cta.text}
                              </Badge>
                            </div>
                            <p className="text-xs text-muted-foreground mt-1 truncate">
                              {(cta as any).salesPageId
                                ? `站內商品頁：${productSalesPages?.find(page => page.id === (cta as any).salesPageId)?.title || `目標已無法使用（${(cta as any).salesPageId}）`}`
                                : cta.offerId
                                  ? `直接購買：${memberProducts?.find(offer => offer.id === cta.offerId)?.name || offers?.find(offer => offer.id === cta.offerId)?.name || `目標已無法使用（${cta.offerId}）`}`
                                  : cta.url || "外部網址已無法使用"}
                            </p>
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={s.editCtaAria}
                            onClick={() => {
                              setEditingCta(cta);
                              ctaForm.reset({
                                text: cta.text,
                                url: cta.url || "",
                                offerId: cta.offerId || "",
                                salesPageId: (cta as any).salesPageId || "",
                                startTime: formatTime(cta.startTime),
                                endTime: cta.endTime ? formatTime(cta.endTime) : "",
                                style: cta.style || "primary",
                              });
                              setIsCtaOpen(true);
                            }}
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => confirmDelete(() => deleteMutation.mutate({ type: "ctas", itemId: cta.id }))}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-center text-muted-foreground py-8">{s.interNoCtaButtons}</p>
                  )}
                </CardContent>
              </Card>

              <Card id="webinar-section-polls" className="scroll-mt-28">
                <CardHeader className="flex flex-row items-center justify-between gap-2">
                  <div>
                    <CardTitle className="text-base">{s.interPollTitle}</CardTitle>
                    <CardDescription>{s.interPollDesc}</CardDescription>
                  </div>
                  <Dialog open={isPollOpen} onOpenChange={open => { setIsPollOpen(open); if (!open) setEditingPoll(null); }}>
                    <DialogTrigger asChild>
                      <Button size="sm" data-testid="button-add-poll" onClick={() => { setEditingPoll(null); pollForm.reset(); }}>
                        <Plus className="h-4 w-4 mr-1" />
                        {s.interAddPoll}
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>{editingPoll ? s.editPollTitle : s.interPollDialogTitle}</DialogTitle>
                      </DialogHeader>
                      <Form {...pollForm}>
                        <form onSubmit={pollForm.handleSubmit((data) => createPoll.mutate(data))} className="space-y-4">
                          <FormField
                            control={pollForm.control}
                            name="question"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>{s.interPollQuestion}</FormLabel>
                                <FormControl>
                                  <Input placeholder={s.interPollQuestionPlaceholder} {...field} />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={pollForm.control}
                            name="options"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>{s.interPollOptions}</FormLabel>
                                <FormControl>
                                  <Input placeholder={s.interPollOptionsPlaceholder} {...field} />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <div className="grid grid-cols-2 gap-4">
                            <FormField
                              control={pollForm.control}
                              name="triggerTime"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel>{s.interPollTriggerTime}</FormLabel>
                                  <FormControl>
                                    <Input placeholder="5:00" {...field} />
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                            <FormField
                              control={pollForm.control}
                              name="duration"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel>{s.interPollDuration}</FormLabel>
                                  <FormControl>
                                    <Input placeholder="60" {...field} />
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                          </div>
                          <Button type="submit" disabled={createPoll.isPending}>
                            {createPoll.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                            {editingPoll ? s.btnSave : s.btnCreate}
                          </Button>
                        </form>
                      </Form>
                    </DialogContent>
                  </Dialog>
                </CardHeader>
                <CardContent>
                  {polls && polls.length > 0 ? (
                    <div className="space-y-2">
                      {polls.sort((a, b) => a.triggerTime - b.triggerTime).map((poll) => (
                        <div key={poll.id} className="flex items-start justify-between p-3 bg-muted rounded-md gap-2">
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <Badge variant="outline">
                                <Clock className="h-3 w-3 mr-1" />
                                {formatTime(poll.triggerTime)}
                              </Badge>
                            </div>
                            <p className="font-medium text-sm mt-1">{poll.question}</p>
                            <div className="flex flex-wrap gap-1 mt-1">
                              {(poll.options as string[]).map((opt, i) => (
                                <Badge key={i} variant="secondary" className="text-xs">{opt}</Badge>
                              ))}
                            </div>
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={s.editPollTitle}
                            data-testid={`button-edit-poll-${poll.id}`}
                            onClick={() => {
                              setEditingPoll(poll);
                              pollForm.reset({
                                question: poll.question,
                                options: (poll.options as string[]).join(", "),
                                triggerTime: formatTime(poll.triggerTime),
                                duration: String(poll.duration ?? 60),
                              });
                              setIsPollOpen(true);
                            }}
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => confirmDelete(() => deleteMutation.mutate({ type: "polls", itemId: poll.id }))}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-center text-muted-foreground py-8">{s.interNoPolls}</p>
                  )}
                </CardContent>
              </Card>

              <Card id="webinar-section-tips" className="scroll-mt-28">
                <CardHeader className="flex flex-row items-center justify-between gap-2">
                  <div>
                    <CardTitle className="text-base">{s.interTipTitle}</CardTitle>
                    <CardDescription>{s.interTipDesc}</CardDescription>
                  </div>
                  <Dialog open={isTipOpen} onOpenChange={open => { setIsTipOpen(open); if (!open) setEditingTip(null); }}>
                    <DialogTrigger asChild>
                      <Button size="sm" data-testid="button-add-tip" onClick={() => { setEditingTip(null); tipForm.reset(); }}>
                        <Plus className="h-4 w-4 mr-1" />
                        {s.interAddTip}
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>{editingTip ? s.editTipTitle : s.interTipDialogTitle}</DialogTitle>
                      </DialogHeader>
                      <Form {...tipForm}>
                        <form onSubmit={tipForm.handleSubmit((data) => createTip.mutate(data))} className="space-y-4">
                          <FormField
                            control={tipForm.control}
                            name="title"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>{s.interTipTitleLabel}</FormLabel>
                                <FormControl>
                                  <Input placeholder={s.interTipTitlePlaceholder} {...field} />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={tipForm.control}
                            name="content"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>{s.interTipContent}</FormLabel>
                                <FormControl>
                                  <Textarea placeholder={s.interTipContentPlaceholder} {...field} />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <div className="grid grid-cols-2 gap-4">
                            <FormField
                              control={tipForm.control}
                              name="triggerTime"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel>{s.interTipTriggerTime}</FormLabel>
                                  <FormControl>
                                    <Input placeholder="2:30" {...field} />
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                            <FormField
                              control={tipForm.control}
                              name="duration"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel>{s.interTipDisplayDuration}</FormLabel>
                                  <FormControl>
                                    <Input placeholder="30" {...field} />
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                          </div>
                          <Button type="submit" disabled={createTip.isPending}>
                            {createTip.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                            {editingTip ? s.btnSave : s.btnCreate}
                          </Button>
                        </form>
                      </Form>
                    </DialogContent>
                  </Dialog>
                </CardHeader>
                <CardContent>
                  {tips && tips.length > 0 ? (
                    <div className="space-y-2">
                      {tips.sort((a, b) => a.triggerTime - b.triggerTime).map((tip) => (
                        <div key={tip.id} className="flex items-start justify-between p-3 bg-muted rounded-md gap-2">
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <Badge variant="outline">
                                <Clock className="h-3 w-3 mr-1" />
                                {formatTime(tip.triggerTime)}
                              </Badge>
                              <Badge variant="secondary">{tip.duration}{s.interTipSeconds}</Badge>
                            </div>
                            <p className="font-medium text-sm mt-1">{tip.title}</p>
                            <p className="text-xs text-muted-foreground mt-0.5">{tip.content}</p>
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={s.editTipTitle}
                            data-testid={`button-edit-tip-${tip.id}`}
                            onClick={() => {
                              setEditingTip(tip);
                              tipForm.reset({
                                title: tip.title,
                                content: tip.content || "",
                                triggerTime: formatTime(tip.triggerTime),
                                duration: String(tip.duration ?? 10),
                              });
                              setIsTipOpen(true);
                            }}
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => confirmDelete(() => deleteMutation.mutate({ type: "tips", itemId: tip.id }))}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-center text-muted-foreground py-8">{s.interNoTips}</p>
                  )}
                </CardContent>
              </Card>

              <Card id="webinar-section-survey" className="scroll-mt-28">
                <CardHeader>
                  <CardTitle className="text-base">{s.interFeedbackTitle}</CardTitle>
                  <CardDescription>{s.interFeedbackDesc}</CardDescription>
                </CardHeader>
                <CardContent>
                  {feedbackSurvey ? (
                    <div className="space-y-4">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium">{feedbackSurvey.title}</span>
                        <div className="flex items-center gap-2">
                          <Badge variant={feedbackSurvey.isActive ? "default" : "secondary"}>
                            {feedbackSurvey.isActive ? s.interFeedbackActive : s.interFeedbackInactive}
                          </Badge>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setSurveyDraft({
                              title: feedbackSurvey.title,
                              questions: ((feedbackSurvey.questions as any[]) || []).map((q: any) => ({
                                id: String(q.id),
                                type: q.type === "rating" || q.type === "text" ? q.type : "multiChoice",
                                question: q.question || "",
                                options: (q.options || []).join(", "),
                                required: !!q.required,
                              })),
                            })}
                            data-testid="button-edit-survey"
                          >
                            <Edit className="h-4 w-4 mr-1" />
                            {s.btnEdit}
                          </Button>
                          <Switch
                            checked={!!feedbackSurvey.isActive}
                            disabled={toggleSurvey.isPending}
                            onCheckedChange={(checked) => toggleSurvey.mutate({ surveyId: feedbackSurvey.id, isActive: checked })}
                            aria-label={s.surveyEnableAria}
                            data-testid="switch-survey-active"
                          />
                        </div>
                      </div>
                      {feedbackSurvey.questions && (feedbackSurvey.questions as any[]).length > 0 && (
                        <div className="space-y-2">
                          {(feedbackSurvey.questions as any[]).map((q: any, i: number) => (
                            <div key={q.id || i} className="p-3 bg-muted rounded-md">
                              <div className="flex items-center gap-2 mb-1">
                                <Badge variant="outline" className="text-xs">
                                  {q.type === "rating" ? s.interFeedbackRating : q.type === "text" ? s.interFeedbackText : s.interFeedbackChoice}
                                </Badge>
                                {q.required && <Badge variant="secondary" className="text-xs">{s.interFeedbackRequired}</Badge>}
                              </div>
                              <p className="text-sm">{q.question}</p>
                              {q.options && (
                                <div className="flex flex-wrap gap-1 mt-1">
                                  {q.options.map((opt: string, oi: number) => (
                                    <Badge key={oi} variant="outline" className="text-xs">{opt}</Badge>
                                  ))}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="text-center py-8">
                      <p className="text-muted-foreground mb-4">{s.interNoSurvey}</p>
                      <Button
                        size="sm"
                        onClick={() => {
                          apiRequest("POST", `/api/webinars/${id}/feedback-survey`, {
                            webinarId: id,
                            title: s.interDefaultSurveyTitle,
                            questions: [
                              { id: "q1", type: "rating", question: s.interDefaultQ1, required: true },
                              { id: "q2", type: "text", question: s.interDefaultQ2, required: false },
                              { id: "q3", type: "multiChoice", question: s.interDefaultQ3, options: [s.interDefaultOpt1, s.interDefaultOpt2, s.interDefaultOpt3, s.interDefaultOpt4], required: true },
                            ],
                            isActive: true,
                          }).then(() => {
                            queryClient.invalidateQueries({ queryKey: ["/api/webinars", id, "feedback-survey"] });
                            toast({ title: s.toastDefaultSurveyCreated });
                          });
                        }}
                        data-testid="button-create-default-survey"
                      >
                        <Plus className="h-4 w-4 mr-1" />
                        {s.interCreateDefaultSurvey}
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>

              {feedbackSurvey && feedbackResponses && feedbackResponses.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">{s.interFeedbackStatsTitle}</CardTitle>
                    <CardDescription>{s.totalResponsesPrefix}{feedbackResponses.length}{s.totalResponsesSuffix}</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    {(feedbackSurvey.questions as any[])?.map((q: any) => {
                      const questionResponses = feedbackResponses
                        .map(r => (r.responses as Record<string, any>)?.[q.id])
                        .filter(v => v !== undefined && v !== null);

                      if (questionResponses.length === 0) return null;

                      return (
                        <div key={q.id} className="space-y-2">
                          <p className="text-sm font-medium">{q.question}</p>
                          {q.type === "rating" && (() => {
                            const nums = questionResponses.map(Number).filter(n => !isNaN(n));
                            const avg = nums.length > 0 ? (nums.reduce((a: number, b: number) => a + b, 0) / nums.length) : 0;
                            const distribution = [1, 2, 3, 4, 5].map(star => ({
                              star: `${star}`,
                              count: nums.filter((n: number) => n === star).length
                            }));
                            return (
                              <div className="space-y-2">
                                <div className="flex items-center gap-2">
                                  <span className="text-2xl font-bold" data-testid={`text-avg-rating-${q.id}`}>{avg.toFixed(1)}</span>
                                  <span className="text-sm text-muted-foreground">/ 5 ({nums.length} {s.interFeedbackResponseCount})</span>
                                </div>
                                <div className="space-y-1">
                                  {distribution.reverse().map(d => (
                                    <div key={d.star} className="flex items-center gap-2 text-sm">
                                      <span className="w-8 text-right">{d.star}</span>
                                      <div className="flex-1 bg-muted rounded-full h-2">
                                        <div
                                          className="bg-primary h-2 rounded-full"
                                          style={{ width: `${nums.length > 0 ? (d.count / nums.length * 100) : 0}%` }}
                                        />
                                      </div>
                                      <span className="w-8 text-muted-foreground">{d.count}</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            );
                          })()}
                          {q.type === "multiChoice" && (() => {
                            const counts: Record<string, number> = {};
                            questionResponses.forEach((v: any) => {
                              counts[v] = (counts[v] || 0) + 1;
                            });
                            return (
                              <div className="space-y-1">
                                {(q.options || []).map((opt: string) => (
                                  <div key={opt} className="flex items-center gap-2 text-sm">
                                    <span className="w-24 truncate">{opt}</span>
                                    <div className="flex-1 bg-muted rounded-full h-2">
                                      <div
                                        className="bg-primary h-2 rounded-full"
                                        style={{ width: `${questionResponses.length > 0 ? ((counts[opt] || 0) / questionResponses.length * 100) : 0}%` }}
                                      />
                                    </div>
                                    <span className="w-12 text-muted-foreground text-right">{counts[opt] || 0} ({questionResponses.length > 0 ? Math.round((counts[opt] || 0) / questionResponses.length * 100) : 0}%)</span>
                                  </div>
                                ))}
                              </div>
                            );
                          })()}
                          {q.type === "text" && (
                            <ScrollArea className="h-[150px]">
                              <div className="space-y-2">
                                {questionResponses.map((v: any, i: number) => (
                                  <div key={i} className="p-2 bg-muted rounded-md text-sm">{String(v)}</div>
                                ))}
                              </div>
                            </ScrollArea>
                          )}
                        </div>
                      );
                    })}
                  </CardContent>
                </Card>
              )}

              {feedbackSurvey && (!feedbackResponses || feedbackResponses.length === 0) && (
                <Card>
                  <CardContent className="py-8">
                    <p className="text-center text-muted-foreground">{s.interNoFeedbackResponses}</p>
                  </CardContent>
                </Card>
              )}

              <Dialog open={!!surveyDraft} onOpenChange={(open) => { if (!open) setSurveyDraft(null); }}>
                <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
                  <DialogHeader>
                    <DialogTitle>{s.surveyEditTitle}</DialogTitle>
                    <DialogDescription>{s.surveyEditDesc}</DialogDescription>
                  </DialogHeader>
                  {surveyDraft && (
                    <div className="space-y-4">
                      <div className="space-y-1">
                        <Label>{s.surveyTitleLabel}</Label>
                        <Input
                          value={surveyDraft.title}
                          onChange={(e) => setSurveyDraft({ ...surveyDraft, title: e.target.value })}
                          data-testid="input-survey-title"
                        />
                      </div>
                      {surveyDraft.questions.map((q, index) => {
                        const update = (patch: Partial<SurveyDraftQuestion>) => setSurveyDraft({
                          ...surveyDraft,
                          questions: surveyDraft.questions.map((item, i) => i === index ? { ...item, ...patch } : item),
                        });
                        return (
                          <div key={q.id} className="space-y-2 rounded-md border p-3" data-testid={`survey-question-editor-${index}`}>
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-muted-foreground">{s.surveyQuestionPrefix}{index + 1}{s.surveyQuestionSuffix}</span>
                              <Select value={q.type} onValueChange={(value) => update({ type: value as SurveyDraftQuestion["type"] })}>
                                <SelectTrigger className="h-8 w-[120px]"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="rating">{s.interFeedbackRating}</SelectItem>
                                  <SelectItem value="text">{s.interFeedbackText}</SelectItem>
                                  <SelectItem value="multiChoice">{s.interFeedbackChoice}</SelectItem>
                                </SelectContent>
                              </Select>
                              <div className="flex items-center gap-1 ml-auto">
                                <Checkbox
                                  id={`survey-required-${q.id}`}
                                  checked={q.required}
                                  onCheckedChange={(value) => update({ required: value === true })}
                                />
                                <Label htmlFor={`survey-required-${q.id}`} className="text-xs cursor-pointer">{s.interFeedbackRequired}</Label>
                              </div>
                              <Button
                                size="icon"
                                variant="ghost"
                                aria-label={s.surveyDeleteQuestion}
                                onClick={() => setSurveyDraft({ ...surveyDraft, questions: surveyDraft.questions.filter((_, i) => i !== index) })}
                              >
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            </div>
                            <Input
                              value={q.question}
                              placeholder={s.surveyQuestionPlaceholder}
                              onChange={(e) => update({ question: e.target.value })}
                              data-testid={`input-survey-question-${index}`}
                            />
                            {q.type === "multiChoice" && (
                              <Input
                                value={q.options}
                                placeholder={s.surveyOptionsPlaceholder}
                                onChange={(e) => update({ options: e.target.value })}
                                data-testid={`input-survey-options-${index}`}
                              />
                            )}
                          </div>
                        );
                      })}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setSurveyDraft({
                          ...surveyDraft,
                          questions: [...surveyDraft.questions, { id: `q${Date.now().toString(36)}`, type: "text", question: "", options: "", required: false }],
                        })}
                        data-testid="button-add-survey-question"
                      >
                        <Plus className="h-4 w-4 mr-1" />
                        {s.surveyAddQuestion}
                      </Button>
                      <div className="flex justify-end gap-2 border-t pt-3">
                        <Button variant="ghost" onClick={() => setSurveyDraft(null)}>{s.btnCancel}</Button>
                        <Button
                          disabled={saveSurvey.isPending || !feedbackSurvey}
                          onClick={() => feedbackSurvey && saveSurvey.mutate({ surveyId: feedbackSurvey.id, draft: surveyDraft })}
                          data-testid="button-save-survey"
                        >
                          {saveSurvey.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                          {s.btnSave}
                        </Button>
                      </div>
                    </div>
                  )}
                </DialogContent>
              </Dialog>

              <Card id="webinar-section-questions" className="scroll-mt-28">
                <CardHeader>
                  <CardTitle className="text-base">{s.interQaTitle}</CardTitle>
                  <CardDescription>{s.interQaDesc}</CardDescription>
                </CardHeader>
                <CardContent>
                  {questions && questions.length > 0 ? (
                    <ScrollArea className="h-[400px]">
                      <div className="space-y-2">
                        {questions.map((q) => (
                          <div key={q.id} className="p-3 bg-muted rounded-md" data-testid={`qa-item-${q.id}`}>
                            <div className="flex items-center justify-between mb-2 gap-2">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-medium text-sm">{q.askerName || s.interQaAnonymous}</span>
                                <Badge variant={q.answer ? "secondary" : "outline"}>
                                  {q.answer ? s.interQaAnswered : s.interQaPending}
                                </Badge>
                                {q.isPreset && <Badge variant="secondary">FAQ</Badge>}
                              </div>
                              <div className="flex items-center gap-1">
                                {!q.answer && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => {
                                      setAnsweringQuestionId(q.id);
                                      setAnswerInput("");
                                    }}
                                    data-testid={`button-answer-${q.id}`}
                                  >
                                    {s.interQaReply}
                                  </Button>
                                )}
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => confirmDelete(() => deleteMutation.mutate({ type: "questions", itemId: q.id }))}
                                >
                                  <Trash2 className="h-4 w-4 text-destructive" />
                                </Button>
                              </div>
                            </div>
                            <p className="text-sm">{q.question}</p>
                            {q.answer && (
                              <div className="mt-2 pl-3 border-l-2 border-primary">
                                <p className="text-sm text-muted-foreground">{q.answer}</p>
                              </div>
                            )}
                            {answeringQuestionId === q.id && (
                              <div className="mt-2 flex gap-2">
                                <Input
                                  placeholder={s.interQaReplyPlaceholder}
                                  value={answerInput}
                                  onChange={(e) => setAnswerInput(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter" && answerInput.trim()) {
                                      answerQuestion.mutate({ questionId: q.id, answer: answerInput.trim() });
                                    }
                                  }}
                                  data-testid={`input-answer-${q.id}`}
                                />
                                <Button
                                  size="sm"
                                  disabled={answerQuestion.isPending || !answerInput.trim()}
                                  onClick={() => answerQuestion.mutate({ questionId: q.id, answer: answerInput.trim() })}
                                  data-testid={`button-submit-answer-${q.id}`}
                                >
                                  {s.interQaSubmit}
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => setAnsweringQuestionId(null)}
                                >
                                  {s.btnCancel}
                                </Button>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  ) : (
                    <p className="text-center text-muted-foreground py-8">{s.interNoQuestions}</p>
                  )}
                </CardContent>
              </Card>
              </div>
            </div>
          </TabsContent>

          {/* ===== Chat Tab ===== */}
          <TabsContent value="chat">
            <div className="grid min-h-[620px] gap-px overflow-hidden rounded-xl border border-border bg-border xl:grid-cols-[180px_minmax(340px,1fr)_300px]">
              <aside className="bg-card p-3">
                <p className="px-2 pb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Chat desk</p>
                <div className="space-y-1">
                  {[
                    { label: "Inbox", icon: Inbox, count: chatConversations.length },
                    { label: "Live now", icon: Activity, count: 0 },
                    { label: "Archived", icon: Archive, count: 0 },
                  ].map((item) => (
                    <div key={item.label} className="flex items-center justify-between rounded-md px-2.5 py-2 text-sm text-muted-foreground">
                      <span className="flex items-center gap-2"><item.icon className="h-4 w-4" />{item.label}</span>
                      <span className="text-xs tabular-nums">{item.count}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-6 rounded-lg border border-dashed bg-muted/30 p-3">
                  <div className="flex items-center gap-2 text-sm font-medium"><Radio className="h-3.5 w-3.5 text-primary" />Live status</div>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">歷史訊息會保留；線上狀態僅在直播控制台即時顯示。</p>
                </div>
                <div className="mt-5">
                  <p className="mb-2 px-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">對話</p>
                  <ScrollArea className="h-[330px]">
                    <div className="space-y-1 pr-2">
                      <button
                        type="button"
                        onClick={() => setSelectedChatSessionId("__all__")}
                        className={cn("w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-muted", selectedChatSessionId === "__all__" && "bg-primary/10 text-primary")}
                      >
                        <span className="flex items-center justify-between gap-2">
                          <span>所有訊息</span>
                          <span className="text-xs tabular-nums">{chatMessages?.length || 0}</span>
                        </span>
                      </button>
                      {chatConversations.map((conversation) => (
                        <button
                          key={conversation.sessionId}
                          type="button"
                          onClick={() => {
                            setSelectedChatSessionId(conversation.sessionId);
                            const matched = registrations?.find((reg) =>
                              reg.name === conversation.senderName || reg.nickname === conversation.senderName
                            );
                            if (matched) setSelectedChatRegistrantId(matched.id);
                          }}
                          className={cn("w-full rounded-lg px-3 py-2 text-left hover:bg-muted", selectedChatSessionId === conversation.sessionId && "bg-primary/10 text-primary")}
                        >
                          <span className="block truncate text-sm font-medium">{conversation.senderName}</span>
                          <span className="mt-0.5 flex items-center justify-between text-xs text-muted-foreground">
                            <span>{conversation.lastAt ? conversation.lastAt.toLocaleString(lang, { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—"}</span>
                            <span>{conversation.count}</span>
                          </span>
                        </button>
                      ))}
                      {!chatConversations.length && <p className="px-2 py-6 text-center text-xs text-muted-foreground">目前沒有聊天紀錄</p>}
                    </div>
                  </ScrollArea>
                </div>
              </aside>
              <div className="space-y-5 bg-background p-4 sm:p-5">
                <div className="flex items-center justify-between border-b pb-3">
                  <div><p className="text-sm font-semibold">聊天與訊息管理</p><p className="text-xs text-muted-foreground">查看實際訊息並管理預排內容</p></div>
                  <Badge variant="outline" className="gap-1"><Send className="h-3 w-3" />{chatMessages?.length || 0} 則訊息</Badge>
                </div>
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">聊天紀錄</CardTitle>
                    <CardDescription>{selectedChatSessionId === "__all__" ? "所有成員與主持人的訊息" : "目前所選對話"}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ScrollArea className="h-[340px] pr-3">
                      <div className="space-y-3">
                        {(chatMessages || [])
                          .filter((message) => selectedChatSessionId === "__all__" || (message.sessionId || "__public__") === selectedChatSessionId)
                          .map((message) => (
                            <div
                              key={message.id}
                              className={cn(
                                "max-w-[88%] rounded-xl border px-3 py-2",
                                message.senderType === "host" || message.senderType === "bot"
                                  ? "ml-auto border-primary/20 bg-primary/10"
                                  : "bg-muted/55"
                              )}
                            >
                              <div className="mb-1 flex items-center justify-between gap-3 text-xs">
                                <span className="font-medium">{message.senderName}</span>
                                <span className="text-muted-foreground">{message.sentAt ? new Date(message.sentAt).toLocaleString(lang) : "—"}</span>
                              </div>
                              <p className="whitespace-pre-wrap break-words text-sm">{message.message}</p>
                              <div className="mt-1 flex gap-1">
                                <Badge variant="outline" className="text-[10px]">{({ viewer: "觀眾", host: "主持人", bot: "AI 助理", scheduled: "排程訊息" } as Record<string, string>)[message.senderType] || message.senderType}</Badge>
                                {message.isPrivate && <Badge variant="secondary" className="text-[10px]">私密</Badge>}
                              </div>
                            </div>
                          ))}
                        {(chatMessages || []).filter((message) => selectedChatSessionId === "__all__" || (message.sessionId || "__public__") === selectedChatSessionId).length === 0 && (
                          <div className="py-16 text-center text-sm text-muted-foreground">目前沒有聊天紀錄</div>
                        )}
                      </div>
                    </ScrollArea>
                  </CardContent>
                </Card>
              <Card>
                <CardHeader className="flex flex-row items-center justify-between gap-2">
                  <div>
                    <CardTitle className="text-base">{s.chatFakeUserTitle}</CardTitle>
                    <CardDescription>{s.chatFakeUserDesc}</CardDescription>
                  </div>
                  <Dialog open={isFakeUserOpen} onOpenChange={open => { setIsFakeUserOpen(open); if (!open) setEditingFakeUser(null); }}>
                    <DialogTrigger asChild>
                      <Button size="sm" data-testid="button-add-fake-user" onClick={() => { setEditingFakeUser(null); fakeUserForm.reset(); }}>
                        <Plus className="h-4 w-4 mr-1" />
                        {s.chatAddFakeUser}
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>{editingFakeUser ? s.editFakeUserTitle : s.chatFakeUserDialogTitle}</DialogTitle>
                      </DialogHeader>
                      <Form {...fakeUserForm}>
                        <form onSubmit={fakeUserForm.handleSubmit((data) => createFakeUser.mutate(data))} className="space-y-4">
                          <FormField
                            control={fakeUserForm.control}
                            name="name"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>{s.chatFakeUserName}</FormLabel>
                                <FormControl>
                                  <Input placeholder={s.chatFakeUserNamePlaceholder} {...field} />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <Button type="submit" disabled={createFakeUser.isPending}>
                            {createFakeUser.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                            {editingFakeUser ? s.btnSave : s.btnCreate}
                          </Button>
                        </form>
                      </Form>
                    </DialogContent>
                  </Dialog>
                </CardHeader>
                <CardContent>
                  {fakeUsers && fakeUsers.length > 0 ? (
                    <div className="space-y-2">
                      {fakeUsers.map((user) => (
                        <div key={user.id} className="flex items-center justify-between p-3 bg-muted rounded-md">
                          <span className="font-medium">{user.name}</span>
                          <div className="flex items-center">
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={s.editFakeUserTitle}
                              data-testid={`button-edit-fake-user-${user.id}`}
                              onClick={() => {
                                setEditingFakeUser(user);
                                fakeUserForm.reset({ name: user.name, avatar: user.avatar || "" });
                                setIsFakeUserOpen(true);
                              }}
                            >
                              <Edit className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => confirmDelete(() => deleteMutation.mutate({ type: "fake-users", itemId: user.id }))}
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-center text-muted-foreground py-8">{s.chatNoFakeUsers}</p>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between gap-2">
                  <div>
                    <CardTitle className="text-base">{s.chatScheduledMsgTitle}</CardTitle>
                    <CardDescription>{s.chatScheduledMsgDesc}</CardDescription>
                  </div>
                  <Dialog open={isMessageOpen} onOpenChange={open => { setIsMessageOpen(open); if (!open) setEditingMessage(null); }}>
                    <DialogTrigger asChild>
                      <Button size="sm" data-testid="button-add-scheduled-message" onClick={() => { setEditingMessage(null); messageForm.reset(); }}>
                        <Plus className="h-4 w-4 mr-1" />
                        {s.chatAddMessage}
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>{editingMessage ? s.editMessageTitle : s.chatMsgDialogTitle}</DialogTitle>
                      </DialogHeader>
                      <Form {...messageForm}>
                        <form onSubmit={messageForm.handleSubmit((data) => createMessage.mutate(data))} className="space-y-4">
                          <FormField
                            control={messageForm.control}
                            name="fakeUserId"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>{s.chatMsgSender}</FormLabel>
                                <Select onValueChange={field.onChange} value={field.value}>
                                  <FormControl>
                                    <SelectTrigger>
                                      <SelectValue placeholder={s.chatMsgSelectFakeUser} />
                                    </SelectTrigger>
                                  </FormControl>
                                  <SelectContent>
                                    {fakeUsers?.map((user) => (
                                      <SelectItem key={user.id} value={user.id}>
                                        {user.name}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={messageForm.control}
                            name="message"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>{s.chatMsgContent}</FormLabel>
                                <FormControl>
                                  <Textarea placeholder={s.chatMsgContentPlaceholder} {...field} />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={messageForm.control}
                            name="triggerTime"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>{s.chatMsgTriggerTime}</FormLabel>
                                <FormControl>
                                  <Input placeholder="2:30" {...field} />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <Button type="submit" disabled={createMessage.isPending}>
                            {createMessage.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                            {editingMessage ? s.btnSave : s.btnCreate}
                          </Button>
                        </form>
                      </Form>
                    </DialogContent>
                  </Dialog>
                </CardHeader>
                <CardContent>
                  {scheduledMessages && scheduledMessages.length > 0 ? (
                    <ScrollArea className="h-[400px]">
                      <div className="space-y-2">
                        {scheduledMessages.sort((a, b) => a.triggerTime - b.triggerTime).map((msg) => {
                          const sender = fakeUsers?.find(u => u.id === msg.fakeUserId);
                          return (
                            <div key={msg.id} className="flex items-start justify-between p-3 bg-muted rounded-md gap-2">
                              <div className="flex-1">
                                <div className="flex items-center gap-2">
                                  <Badge variant="outline">
                                    <Clock className="h-3 w-3 mr-1" />
                                    {formatTime(msg.triggerTime)}
                                  </Badge>
                                  <span className="font-medium text-sm">{sender?.name || s.chatMsgUnknown}</span>
                                </div>
                                <p className="text-sm text-muted-foreground mt-1">{msg.message}</p>
                              </div>
                              <Button
                                variant="ghost"
                                size="icon"
                                aria-label={s.editMessageTitle}
                                data-testid={`button-edit-scheduled-message-${msg.id}`}
                                onClick={() => {
                                  setEditingMessage(msg);
                                  messageForm.reset({
                                    fakeUserId: msg.fakeUserId || "",
                                    message: msg.message,
                                    triggerTime: formatTime(msg.triggerTime),
                                  });
                                  setIsMessageOpen(true);
                                }}
                              >
                                <Edit className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => confirmDelete(() => deleteMutation.mutate({ type: "scheduled-messages", itemId: msg.id }))}
                              >
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            </div>
                          );
                        })}
                      </div>
                    </ScrollArea>
                  ) : (
                    <p className="text-center text-muted-foreground py-8">{s.chatNoScheduledMessages}</p>
                  )}
                </CardContent>
              </Card>
              </div>
              <aside className="bg-card p-4">
                <div className="mb-3 flex items-center gap-2">
                  <UserRound className="h-4 w-4 text-primary" />
                  <div><p className="text-sm font-semibold">Registrant context</p><p className="text-xs text-muted-foreground">Select a registrant</p></div>
                </div>
                <ScrollArea className="h-[210px] border-b pb-3">
                  <div className="space-y-1 pr-2">
                    {(registrations || []).map((reg) => (
                      <button key={reg.id} type="button" onClick={() => setSelectedChatRegistrantId(reg.id)}
                        className={cn("w-full rounded-lg px-3 py-2 text-left transition-colors hover:bg-muted", selectedChatRegistrantId === reg.id && "bg-primary/10 text-primary")}>
                        <span className="block truncate text-sm font-medium">{reg.name}</span>
                        <span className="block truncate text-xs text-muted-foreground">{reg.email}</span>
                      </button>
                    ))}
                    {!registrations?.length && <p className="px-2 py-5 text-center text-xs text-muted-foreground">No registrants yet</p>}
                  </div>
                </ScrollArea>
                {(() => {
                  const selected = registrations?.find((reg) => reg.id === selectedChatRegistrantId) || registrations?.[0];
                  if (!selected) return <div className="py-8 text-center text-sm text-muted-foreground">Profile data will appear here.</div>;
                  return <div className="space-y-4 pt-4 text-sm">
                    <div><p className="font-semibold">{selected.name}</p><p className="break-all text-xs text-muted-foreground">{selected.email}</p><p className="mt-1 text-xs text-muted-foreground">{selected.phone || "No phone provided"}</p></div>
                    <div className="grid grid-cols-2 gap-3 border-y py-3 text-xs"><div><p className="text-muted-foreground">Session</p><p className="mt-1 font-medium">{selected.selectedSession ? new Date(selected.selectedSession).toLocaleString(lang) : "On demand"}</p></div><div><p className="text-muted-foreground">Watch time</p><p className="mt-1 font-medium">{Math.floor((selected.watchDuration || 0) / 60)} min</p></div><div><p className="text-muted-foreground">Status</p><p className="mt-1 font-medium">{selected.attended ? s.regAttended : "Not attended"}</p></div><div><p className="text-muted-foreground">Source</p><p className="mt-1 font-medium">{selected.utmSource || selected.source || "Direct"}</p></div></div>
                    <div><p className="mb-2 flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground"><Database className="h-3 w-3" />Tags</p><div className="flex flex-wrap gap-1">{(selected.tags || []).length ? selected.tags?.map((tag) => <Badge key={tag} variant="secondary" className="text-xs">{tag}</Badge>) : <span className="text-xs text-muted-foreground">No tags</span>}</div></div>
                  </div>;
                })()}
              </aside>
            </div>
          </TabsContent>

          {/* ===== Registration Tab ===== */}
          <TabsContent value="registrations">
            <div className="admin-workspace-grid">
              {contextualRail([{ id: "registrants", label: s.regTitle, icon: Users }], registrationsSection, setRegistrationsSection)}
              <div className="space-y-4">
              <Card id="webinar-section-registrants">
              <CardHeader className="flex flex-row items-center justify-between gap-2">
                <div>
                  <CardTitle className="text-base">{s.regTitle}</CardTitle>
                  <CardDescription>{s.regDesc}</CardDescription>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <Select value={sourceFilter} onValueChange={setSourceFilter}>
                    <SelectTrigger className="w-[170px] h-9" data-testid="select-source-filter">
                      <SelectValue placeholder="報名來源" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__all__">所有來源</SelectItem>
                      {Array.from(new Set((registrations || []).map((r) => registrationSource(r).label))).map((label) => (
                        <SelectItem key={label} value={label}>{label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={tagFilter} onValueChange={setTagFilter}>
                    <SelectTrigger className="w-[160px] h-9" data-testid="select-tag-filter">
                      <SelectValue placeholder={s.tagFilter} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__all__">{s.tagAll}</SelectItem>
                      {Array.from(new Set((registrations || []).flatMap((r) => r.tags || []))).map((tag) => (
                        <SelectItem key={tag} value={tag}>{tag}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button variant="outline" size="sm" onClick={() => window.open(`/api/webinars/${id}/registrations/export`, "_blank")} data-testid="button-export-csv">
                    <Download className="h-4 w-4 mr-1" />
                    {s.regExportCsv}
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="px-0 pb-0">
                {registrationsLoading ? (
                  <div className="space-y-2 p-5">{Array.from({ length: 5 }).map((_, index) => <div key={index} className="h-12 animate-pulse rounded bg-muted" />)}</div>
                ) : registrationsError ? (
                  <div className="flex items-center justify-center gap-2 px-4 py-10 text-sm text-rose-700"><AlertCircle className="h-4 w-4" />報名名單載入失敗，請重新整理後再試。</div>
                ) : registrations && registrations.length > 0 ? (
                  <>
                  {(() => {
                    const total = registrations.length;
                    const attended = registrations.filter((r) => r.attended).length;
                    const scheduled = registrations.filter((r) => r.selectedSession).length;
                    const bySource = new Map<string, number>();
                    registrations.forEach((r) => {
                      const label = registrationSource(r).label;
                      bySource.set(label, (bySource.get(label) || 0) + 1);
                    });
                    const sources = Array.from(bySource.entries()).sort((a, b) => b[1] - a[1]);
                    return (
                      <div className="space-y-3 border-t px-5 py-4">
                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                          {[
                            { label: "總報名", value: total },
                            { label: "已觀看", value: `${attended}（${total ? Math.round((attended / total) * 100) : 0}%）` },
                            { label: "預約場次", value: scheduled },
                            { label: "隨選觀看", value: total - scheduled },
                          ].map((tile) => (
                            <div key={tile.label} className="rounded-lg bg-muted/50 px-3 py-2">
                              <div className="text-[11px] text-muted-foreground">{tile.label}</div>
                              <div className="mt-0.5 text-lg font-semibold tabular-nums">{tile.value}</div>
                            </div>
                          ))}
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5" data-testid="registration-source-breakdown">
                          <span className="mr-1 text-xs font-medium text-muted-foreground">報名來源</span>
                          {sources.map(([label, count]) => (
                            <button
                              key={label}
                              type="button"
                              onClick={() => setSourceFilter(sourceFilter === label ? "__all__" : label)}
                              className={cn(
                                "rounded-full border px-2.5 py-1 text-xs transition-colors",
                                sourceFilter === label ? "border-primary bg-primary text-primary-foreground" : "bg-background hover:bg-muted",
                              )}
                            >
                              {label} <span className="tabular-nums opacity-70">{count}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  })()}
                  <div className="max-h-[560px] overflow-auto border-t">
                    <Table className="min-w-[1100px]">
                      <TableHeader className="sticky top-0 z-10 bg-muted/95 backdrop-blur">
                        <TableRow className="hover:bg-transparent">
                          <TableHead className="w-[150px]">姓名</TableHead>
                          <TableHead className="w-[220px]">聯絡資料</TableHead>
                          <TableHead className="w-[200px]">場次</TableHead>
                          <TableHead className="w-[190px]">報名來源</TableHead>
                          <TableHead className="w-[150px]">報名時間</TableHead>
                          <TableHead className="w-[130px]">觀看狀態</TableHead>
                          <TableHead className="min-w-[160px]">標籤</TableHead>
                          <TableHead className="w-[80px] text-right">操作</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {registrations
                          .filter((reg) => tagFilter === "__all__" || (reg.tags || []).includes(tagFilter))
                          .filter((reg) => sourceFilter === "__all__" || registrationSource(reg).label === sourceFilter)
                          .map((reg, index) => {
                            const watchMinutes = Math.floor((reg.watchDuration || 0) / 60);
                            const watchSeconds = (reg.watchDuration || 0) % 60;
                            return (
                              <TableRow
                                key={reg.id}
                                className={cn(index % 2 === 1 && "bg-muted/35")}
                                data-testid={`row-registration-${reg.id}`}
                              >
                                <TableCell className="align-top font-medium">
                                  <div className="max-w-[140px] truncate" title={reg.name}>{reg.name}</div>
                                  {reg.nickname && reg.nickname !== reg.name && (
                                    <div className="mt-1 text-xs text-muted-foreground">暱稱：{reg.nickname}</div>
                                  )}
                                </TableCell>
                                <TableCell className="align-top">
                                  <a href={`mailto:${reg.email}`} className="block max-w-[210px] truncate text-sm text-primary hover:underline" title={reg.email}>
                                    {reg.email}
                                  </a>
                                  <div className="mt-1 text-xs text-muted-foreground">{reg.phone || "—"}</div>
                                </TableCell>
                                <TableCell className="align-top text-sm">
                                  <Badge variant={reg.selectedSession ? "secondary" : "outline"} className="mb-1 text-[11px]">
                                    {reg.selectedSession ? "預約場次" : "隨選觀看"}
                                  </Badge>
                                  <div>
                                  {reg.selectedSession
                                    ? new Date(reg.selectedSession).toLocaleString(lang, {
                                        timeZone: webinar.timezone || "Asia/Taipei",
                                        year: "numeric",
                                        month: "2-digit",
                                        day: "2-digit",
                                        hour: "2-digit",
                                        minute: "2-digit",
                                      })
                                    : "報名後立即觀看"}
                                  </div>
                                </TableCell>
                                <TableCell className="align-top text-sm">
                                  {(() => {
                                    const origin = registrationSource(reg);
                                    return (
                                      <div className="max-w-[180px]" title={reg.landingUrl || undefined} data-testid={`text-source-${reg.id}`}>
                                        <div className="truncate font-medium">{origin.label}</div>
                                        {origin.detail && <div className="truncate text-xs text-muted-foreground">{origin.detail}</div>}
                                      </div>
                                    );
                                  })()}
                                </TableCell>
                                <TableCell className="align-top text-sm text-muted-foreground">
                                  {reg.registeredAt ? new Date(reg.registeredAt).toLocaleString(lang) : "—"}
                                </TableCell>
                                <TableCell className="align-top">
                                  <Badge variant={reg.attended ? "default" : "outline"} className="mb-1">
                                    {reg.attended ? s.regAttended : "尚未觀看"}
                                  </Badge>
                                  <div className="text-xs text-muted-foreground">
                                    觀看 {watchMinutes > 0 ? `${watchMinutes} 分` : ""}{watchSeconds} 秒
                                  </div>
                                </TableCell>
                                <TableCell className="align-top">
                                  <div className="flex flex-wrap gap-1">
                                    {(reg.tags || []).map((tag, i) => (
                                      <Badge key={i} className="text-xs" data-testid={`badge-tag-${reg.id}-${i}`}>{tag}</Badge>
                                    ))}
                                    {(reg.tags || []).length === 0 && (
                                      <span className="text-sm text-muted-foreground">—</span>
                                    )}
                                  </div>
                                  {editTagsRegId === reg.id && (
                                    <div className="mt-2 flex min-w-[300px] items-center gap-1">
                                      <Input
                                        value={editTagsValue}
                                        onChange={(e) => setEditTagsValue(e.target.value)}
                                        placeholder={s.tagPlaceholder}
                                        className="h-8 text-sm"
                                        data-testid={`input-tags-${reg.id}`}
                                      />
                                      <Button
                                        size="sm"
                                        className="h-8"
                                        disabled={saveRegTags.isPending}
                                        onClick={() => saveRegTags.mutate({ regId: reg.id, tags: editTagsValue.split(",").map((t) => t.trim()).filter(Boolean) })}
                                        data-testid={`button-save-tags-${reg.id}`}
                                      >
                                        {s.tagSave}
                                      </Button>
                                      <Button variant="ghost" size="sm" className="h-8" onClick={() => setEditTagsRegId(null)}>
                                        {s.tagCancel}
                                      </Button>
                                    </div>
                                  )}
                                </TableCell>
                                <TableCell className="align-top text-right">
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-8 text-xs"
                                    onClick={() => { setEditTagsRegId(reg.id); setEditTagsValue((reg.tags || []).join(", ")); }}
                                    data-testid={`button-edit-tags-${reg.id}`}
                                  >
                                    {s.tagEdit}
                                  </Button>
                                </TableCell>
                              </TableRow>
                            );
                          })}
                      </TableBody>
                    </Table>
                  </div>
                  </>
                ) : (
                  <p className="text-center text-muted-foreground py-8">{s.regNoRegistrations}</p>
                )}
              </CardContent>
              </Card>
              <Card className="overflow-hidden border-teal-200/70 bg-gradient-to-br from-card via-card to-teal-50/70">
                <CardHeader className="border-b border-teal-100/80 pb-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="mb-1 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] text-teal-700">
                        <Target className="h-4 w-4" /> SellCase 成交洞察
                      </div>
                      <CardTitle className="text-xl tracking-tight">成交中心</CardTitle>
                      <CardDescription className="mt-1">依據觀看、互動與付款事件，整理下一個可執行的成交動作。</CardDescription>
                    </div>
                    <Badge variant="outline" className="border-teal-200 bg-teal-50 text-teal-700">
                      僅限擁有者
                    </Badge>
                  </div>
                  {leadInsightsQuery.isLoading ? (
                    <div className="grid grid-cols-2 gap-2 pt-3 md:grid-cols-6">
                      {Array.from({ length: 6 }).map((_, index) => <div key={index} className="h-20 animate-pulse rounded-lg bg-muted" />)}
                    </div>
                  ) : leadInsightsQuery.isError ? (
                    <div className="mt-4 flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
                      <AlertCircle className="h-4 w-4 shrink-0" /> 成交洞察暫時無法載入，請重新整理後再試。
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-2 pt-3 md:grid-cols-6">
                      {[
                        { label: "本頁潛客", value: leadData?.summary?.total || 0, tone: "text-foreground" },
                        { label: "高意圖", value: leadData?.summary?.hot || 0, tone: "text-rose-600" },
                        { label: "觀望中", value: leadData?.summary?.warm || 0, tone: "text-amber-600" },
                        { label: "低意圖", value: leadData?.summary?.cold || 0, tone: "text-slate-500" },
                        { label: "已成交", value: leadData?.summary?.customers || 0, tone: "text-teal-700" },
                        { label: "已退款", value: leadData?.summary?.refunded || 0, tone: "text-violet-600" },
                      ].map((tile) => (
                        <div key={tile.label} className="rounded-lg border border-border/70 bg-background/70 px-3 py-2.5">
                          <div className="text-[11px] font-semibold text-muted-foreground">{tile.label}</div>
                          <div className={cn("mt-1 text-2xl font-bold tracking-tight", tile.tone)}>{tile.value}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardHeader>
                <CardContent className="p-0">
                  <div className="flex flex-wrap items-center gap-2 border-b bg-muted/20 px-4 py-3">
                    <span className="mr-1 text-xs font-semibold text-muted-foreground">篩選：</span>
                    {[
                      { value: "all", label: "全部" },
                      { value: "hot", label: "高意圖" },
                      { value: "warm", label: "觀望中" },
                      { value: "cold", label: "低意圖" },
                    ].map((option) => (
                      <Button key={option.value} variant={leadTemperature === option.value ? "default" : "outline"} size="sm"
                        className="h-8 rounded-full px-3 text-xs" onClick={() => setLeadTemperature(option.value)}>
                        {option.label}
                      </Button>
                    ))}
                    <Select value={leadStage} onValueChange={setLeadStage}>
                      <SelectTrigger className="ml-auto h-8 w-[130px] bg-background text-xs"><SelectValue placeholder="依階段" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">所有階段</SelectItem>
                        {Array.from(new Set((leadData?.leads || []).map((lead) => lead.stage))).map((stage) => (
                          <SelectItem key={stage} value={stage}>{stageLabel(stage)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {leadInsightsQuery.isLoading ? (
                    <div className="space-y-2 p-4">{Array.from({ length: 4 }).map((_, index) => <div key={index} className="h-14 animate-pulse rounded bg-muted" />)}</div>
                  ) : leadInsightsQuery.isError ? null : visibleLeads.length ? (
                    <div className="divide-y">
                      <div className="hidden grid-cols-[minmax(180px,1.2fr)_90px_110px_minmax(220px,1fr)_28px] gap-4 px-4 py-2 text-[11px] font-bold uppercase tracking-wide text-muted-foreground md:grid">
                        <span>潛客</span><span>意圖分數</span><span>階段</span><span>下一步</span><span />
                      </div>
                      {visibleLeads.map((lead) => {
                        const registration = registrations?.find((item) => String(item.id) === String(lead.registrationId));
                        return (
                          <button key={lead.registrationId} type="button" onClick={() => setSelectedLead(lead)}
                            className="grid w-full grid-cols-1 gap-2 px-4 py-3 text-left transition-colors hover:bg-teal-50/60 md:grid-cols-[minmax(180px,1.2fr)_90px_110px_minmax(220px,1fr)_28px] md:items-center md:gap-4">
                            <span className="min-w-0">
                              <span className="flex items-center gap-2 font-semibold">{registration?.name || `報名者 ${lead.registrationId.slice(0, 8)}`}
                                <Badge className={cn("border text-[10px]", temperatureClass(lead.temperature))} variant="outline">
                                  {lead.temperature === "hot" && <Flame className="mr-1 h-3 w-3" />}
                                  {lead.temperature === "cold" && <Snowflake className="mr-1 h-3 w-3" />}
                                  {temperatureLabel(lead.temperature)}
                                </Badge>
                              </span>
                              <span className="mt-1 block truncate text-xs text-muted-foreground">{registration?.email || "聯絡資料載入中"} · 最近 {formatLeadDate(lead.lastActivityAt)}</span>
                            </span>
                            <span className="flex items-baseline gap-1"><strong className="text-xl">{lead.score}</strong><span className="text-[10px] text-muted-foreground">/100</span></span>
                            <Badge variant="secondary" className="w-fit text-xs">{stageLabel(lead.stage)}</Badge>
                            <span className="min-w-0"><span className="block truncate text-sm font-medium">{lead.recommendation.title}</span><span className="block truncate text-xs text-muted-foreground">{lead.evidenceCount} 個訊號 · {lead.recommendation.action}</span></span>
                            <ChevronRight className="hidden h-4 w-4 text-muted-foreground md:block" />
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="px-4 py-10 text-center">
                      <Target className="mx-auto mb-2 h-7 w-7 text-muted-foreground/50" />
                      <p className="text-sm font-medium">目前篩選沒有符合的潛客</p>
                      <p className="mt-1 text-xs text-muted-foreground">調整條件後，這裡會顯示事件規則找出的成交機會。</p>
                    </div>
                  )}
                  {!leadInsightsQuery.isLoading && !leadInsightsQuery.isError && (leadData?.pagination?.total || 0) > 50 && (
                    <div className="flex items-center justify-between border-t px-4 py-3">
                      <p className="text-xs text-muted-foreground">
                        第 {leadData!.pagination.offset + 1}–{Math.min(leadData!.pagination.offset + leadData!.leads.length, leadData!.pagination.total)} 位，共 {leadData!.pagination.total} 位
                      </p>
                      <div className="flex gap-2">
                        <Button variant="outline" size="sm" disabled={leadPage === 0} onClick={() => setLeadPage(page => Math.max(0, page - 1))}>上一頁</Button>
                        <Button variant="outline" size="sm" disabled={!leadData?.pagination?.hasMore} onClick={() => setLeadPage(page => page + 1)}>下一頁</Button>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
             </div>
             <Dialog open={!!selectedLead} onOpenChange={(open) => !open && setSelectedLead(null)}>
               <DialogContent className="max-h-[90dvh] max-w-3xl overflow-y-auto">
                 <DialogHeader>
                   <DialogTitle className="flex items-center gap-2"><BrainCircuit className="h-5 w-5 text-teal-700" />潛客成交診斷</DialogTitle>
                   <DialogDescription>查看這位潛客的事件訊號、評分依據，以及現在最值得採取的動作。</DialogDescription>
                 </DialogHeader>
                 {leadDetailQuery.isLoading ? (
                   <div className="space-y-3 py-5"><div className="h-20 animate-pulse rounded-lg bg-muted" /><div className="h-36 animate-pulse rounded-lg bg-muted" /></div>
                 ) : leadDetailQuery.isError || !leadDetailQuery.data ? (
                   <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">無法取得這位潛客的詳細洞察，請稍後再試。</div>
                 ) : (() => {
                   const detail = leadDetailQuery.data;
                   return (
                     <div className="space-y-5">
                       <div className="grid gap-3 md:grid-cols-[1fr_auto]">
                         <div className="rounded-xl border bg-muted/20 p-4">
                           <div className="flex items-start justify-between gap-3">
                             <div className="min-w-0">
                               <p className="text-lg font-bold">{selectedRegistration?.name || `報名者 ${detail.registrationId.slice(0, 8)}`}</p>
                               <p className="mt-1 truncate text-sm text-muted-foreground">{selectedRegistration?.email || "尚無 Email"} {selectedRegistration?.phone ? ` · ${selectedRegistration.phone}` : ""}</p>
                             </div>
                             <Badge className={cn("border", temperatureClass(detail.temperature))} variant="outline">{temperatureLabel(detail.temperature)}</Badge>
                           </div>
                           <div className="mt-4 flex flex-wrap gap-2 text-xs text-muted-foreground">
                             <Badge variant="secondary">{stageLabel(detail.stage)}</Badge>
                             <span className="rounded-md border px-2 py-1">最近活動 {formatLeadDate(detail.lastActivityAt)}</span>
                             {selectedRegistration?.attended && <span className="rounded-md border px-2 py-1">已出席</span>}
                           </div>
                         </div>
                         <div className="flex min-w-[130px] flex-col justify-center rounded-xl border border-teal-200 bg-teal-50 p-4 text-center">
                           <span className="text-[11px] font-bold uppercase tracking-wider text-teal-700">Intent score</span>
                           <strong className="mt-1 text-4xl tracking-tight text-teal-800">{detail.score}</strong>
                           <span className="text-xs text-teal-700/70">滿分 100 · {detail.evidenceCount} 個訊號</span>
                         </div>
                       </div>
                       <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-4">
                         <div className="flex items-start gap-3"><Target className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" /><div><p className="font-bold text-amber-950">{detail.recommendation.title}</p><p className="mt-1 text-sm leading-6 text-amber-900/80">{detail.recommendation.description}</p><p className="mt-2 inline-flex rounded-md bg-amber-100 px-2 py-1 text-xs font-bold text-amber-900">建議動作：{detail.recommendation.action}</p></div></div>
                       </div>
                       <div className="grid gap-5 md:grid-cols-[1fr_1.15fr]">
                         <section>
                            <div className="mb-3 flex items-center justify-between"><h3 className="font-bold">可解釋的評分依據</h3><span className="text-xs text-muted-foreground">事件證據</span></div>
                           <div className="space-y-2">
                             {detail.evidence.length ? detail.evidence.map((item) => (
                               <div key={`${item.type}-${item.occurredAt}`} className="flex items-center justify-between gap-3 rounded-lg border bg-card px-3 py-2.5">
                                 <div className="min-w-0"><p className="truncate text-sm font-medium">{item.label}</p><p className="text-[11px] text-muted-foreground">{formatLeadDate(item.occurredAt)}</p></div>
                                 <span className={cn("shrink-0 text-sm font-bold", item.points >= 0 ? "text-teal-700" : "text-rose-600")}>{item.points > 0 ? "+" : ""}{item.points}</span>
                               </div>
                             )) : <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">目前沒有可展示的評分依據。</p>}
                           </div>
                         </section>
                         <section>
                           <div className="mb-3 flex items-center justify-between"><h3 className="font-bold">銷售時間軸</h3><span className="text-xs text-muted-foreground">由新到舊</span></div>
                           <div className="relative space-y-0 border-l-2 border-teal-100 pl-4">
                             {detail.timeline.length ? [...detail.timeline].sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime()).map((event) => (
                               <div key={event.id} className="relative pb-4 last:pb-0"><span className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full border-2 border-card bg-teal-600" /><p className="text-sm font-semibold">{event.label}</p><p className="mt-0.5 text-xs text-muted-foreground">{formatLeadDate(event.occurredAt)}{event.positionSeconds != null ? ` · 影片 ${formatTime(event.positionSeconds)}` : ""}{event.amountMinor != null && event.currency ? ` · ${formatMinorCurrency(event.currency, event.amountMinor)}` : ""}</p></div>
                             )) : <p className="text-sm text-muted-foreground">尚無時間軸事件。</p>}
                           </div>
                         </section>
                       </div>
                     </div>
                   );
                 })()}
               </DialogContent>
             </Dialog>
          </TabsContent>

          {/* ===== Analytics Tab ===== */}
          <TabsContent value="analytics">
            <div className="admin-workspace-grid">
              {contextualRail([
                { id: "overview", label: "Overview", icon: Activity },
                { id: "funnel", label: "Funnel", icon: TrendingUp },
                { id: "viewer-behavior", label: "Viewer behavior", icon: Eye },
              ], analyticsSection, setAnalyticsSection)}
              <div>
            {analytics ? (
              <div className="space-y-6">
                <Card id="webinar-section-funnel" className="border-primary/20 bg-primary/[0.03] overflow-hidden">
                  <CardHeader className="pb-3">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <CardTitle className="text-base flex items-center gap-2">
                          <TrendingUp className="h-4 w-4 text-primary" />
                          漏斗成效
                        </CardTitle>
                        <CardDescription>用真實事件看見觀眾從進站到購買的每一個轉折。</CardDescription>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        {funnelQuery.isFetching && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                        資料範圍
                      </div>
                    </div>
                    <div className="flex flex-col sm:flex-row sm:items-end gap-3 pt-2">
                      <div className="space-y-1 flex-1">
                        <Label htmlFor="funnel-from" className="text-xs">開始日期</Label>
                        <Input id="funnel-from" type="date" value={funnelFrom} onChange={(e) => setFunnelFrom(e.target.value)} className="bg-background" />
                      </div>
                      <div className="space-y-1 flex-1">
                        <Label htmlFor="funnel-to" className="text-xs">結束日期</Label>
                        <Input id="funnel-to" type="date" value={funnelTo} onChange={(e) => setFunnelTo(e.target.value)} className="bg-background" />
                      </div>
                      <Button variant="outline" size="icon" className="shrink-0" onClick={() => funnelQuery.refetch()} disabled={funnelQuery.isFetching} aria-label="重新整理漏斗分析">
                        <RefreshCw className={cn("h-4 w-4", funnelQuery.isFetching && "animate-spin")} />
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent className="pt-0">
                    {funnelQuery.isLoading ? (
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        {[1, 2, 3, 4].map((item) => <div key={item} className="h-20 rounded-lg bg-muted animate-pulse" />)}
                      </div>
                    ) : funnelQuery.isError ? (
                      <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-5 text-center">
                        <p className="text-sm font-medium">漏斗分析暫時無法載入</p>
                        <p className="text-xs text-muted-foreground mt-1">請確認日期範圍後再試一次。</p>
                        <Button variant="outline" size="sm" className="mt-3" onClick={() => funnelQuery.refetch()}>重試</Button>
                      </div>
                    ) : !funnelQuery.data?.uniqueViewers ? (
                      <div className="rounded-lg border border-dashed p-6 text-center">
                        <BarChart className="h-8 w-8 mx-auto text-muted-foreground/50" />
                        <p className="text-sm font-medium mt-2">這段期間還沒有漏斗事件</p>
                        <p className="text-xs text-muted-foreground mt-1">當觀眾進入頁面、互動或購買後，成效會顯示在這裡。</p>
                      </div>
                    ) : (
                      <div className="space-y-5">
                        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                          <div className="rounded-lg bg-background border p-3">
                            <p className="text-2xl font-semibold tracking-tight">{funnelQuery.data.uniqueViewers.toLocaleString()}</p>
                            <p className="text-xs text-muted-foreground">不重複觀眾</p>
                          </div>
                          <div className="rounded-lg bg-background border p-3">
                            <p className="text-2xl font-semibold tracking-tight">{funnelQuery.data.checkoutToPurchaseRate.toFixed(2)}%</p>
                            <p className="text-xs text-muted-foreground">結帳 → 購買</p>
                          </div>
                          <div className="rounded-lg bg-background border p-3">
                            <p className="text-2xl font-semibold tracking-tight">{(funnelQuery.data.counts.landing_view || 0).toLocaleString()}</p>
                            <p className="text-xs text-muted-foreground">落地頁瀏覽</p>
                          </div>
                          <div className="rounded-lg bg-background border p-3">
                            <p className="text-2xl font-semibold tracking-tight">{(funnelQuery.data.counts.purchase || 0).toLocaleString()}</p>
                            <p className="text-xs text-muted-foreground">購買事件</p>
                          </div>
                          <div className="rounded-lg bg-background border p-3">
                            <p className="text-2xl font-semibold tracking-tight">
                              {Object.entries(funnelQuery.data.revenue).length
                                ? Object.entries(funnelQuery.data.revenue).map(([currency, value]) => formatMinorCurrency(currency, value)).join(" · ")
                                : "—"}
                            </p>
                            <p className="text-xs text-muted-foreground">收入（依幣別）</p>
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-2" aria-label="事件總量">
                          {Object.entries(funnelQuery.data.counts).map(([event, count]) => (
                            <span key={event} className="inline-flex items-center gap-1.5 rounded-full border bg-background px-2.5 py-1 text-[11px] text-muted-foreground">
                              <span className="font-medium text-foreground">{count.toLocaleString()}</span>
                              {funnelStageLabels[event] || event.replaceAll("_", " ")}
                            </span>
                          ))}
                        </div>

                        <div className="grid grid-cols-1 lg:grid-cols-[1.35fr_1fr] gap-5">
                          <div>
                            <div className="flex items-center justify-between mb-3">
                              <p className="text-sm font-medium">階段轉換</p>
                              <span className="text-xs text-muted-foreground">不重複觀眾</span>
                            </div>
                            <div className="space-y-3">
                              {Object.entries(funnelQuery.data.uniqueByStage)
                                .filter(([stage]) => funnelStageLabels[stage])
                                .map(([stage, count]) => {
                                  const max = Math.max(1, funnelQuery.data.uniqueViewers);
                                  return (
                                    <div key={stage} className="space-y-1">
                                      <div className="flex justify-between text-xs">
                                        <span>{funnelStageLabels[stage]}</span>
                                        <span className="font-medium">{count.toLocaleString()} 人 <span className="font-normal text-muted-foreground">/ {(funnelQuery.data.counts[stage] || 0).toLocaleString()} 次</span></span>
                                      </div>
                                      <div className="h-2 rounded-full bg-muted overflow-hidden">
                                        <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${Math.min(100, (count / max) * 100)}%` }} />
                                      </div>
                                    </div>
                                  );
                                })}
                            </div>
                          </div>
                          <div className="rounded-lg border bg-background p-4">
                            <p className="text-sm font-medium mb-3">階段轉換率</p>
                            <div className="space-y-2.5">
                              {funnelQuery.data.stageConversionRates.map((item) => (
                                <div key={`${item.from}-${item.to}`} className="flex items-center justify-between gap-3 text-xs">
                                  <span className="text-muted-foreground truncate">{funnelStageLabels[item.from] || item.from} → {funnelStageLabels[item.to] || item.to}</span>
                                  <Badge variant={item.rate >= 30 ? "default" : "secondary"}>{item.rate.toFixed(2)}%</Badge>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                          <div className="rounded-lg border bg-background p-4">
                            <p className="text-sm font-medium mb-3">CTA 表現</p>
                            {funnelQuery.data.ctaPerformance.length ? (
                              <div className="space-y-2">
                                {funnelQuery.data.ctaPerformance.map((item) => {
                                  return <div key={item.ctaKey} className="flex items-center justify-between gap-3 border-b last:border-0 pb-2 last:pb-0">
                                      <span className="text-xs truncate">{resolveFunnelCtaLabel(item.ctaKey, ctas || [])}</span>
                                    <div className="flex items-center gap-2 shrink-0 text-xs">
                                      <span className="text-muted-foreground">{item.uniqueClicks}/{item.uniqueViews} 人</span>
                                      <Badge variant="outline">{item.clickThroughRate.toFixed(2)}%</Badge>
                                    </div>
                                  </div>;
                                })}
                              </div>
                            ) : <p className="text-xs text-muted-foreground">尚無 CTA 事件</p>}
                          </div>
                          <div className="rounded-lg border bg-background p-4">
                            <p className="text-sm font-medium mb-3">影片流失位置</p>
                            <div className="flex items-end gap-2 h-24">
                              {funnelQuery.data.dropoffBuckets.map((bucket) => {
                                const peak = Math.max(1, ...funnelQuery.data.dropoffBuckets.map((entry) => entry.count));
                                return <div key={bucket.range} className="flex-1 h-full flex flex-col items-center justify-end gap-1">
                                  <span className="text-[10px] text-muted-foreground">{bucket.count}</span>
                                  <div className="w-full rounded-t bg-primary/70 min-h-1" style={{ height: `${Math.max(4, (bucket.count / peak) * 68)}px` }} />
                                  <span className="text-[10px] text-muted-foreground">{bucket.range}</span>
                                </div>;
                              })}
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>

                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
                  <Card>
                    <CardContent className="p-4 text-center">
                      <p className="text-2xl font-bold" data-testid="text-total-registrations">{analytics.summary?.totalRegistrations || 0}</p>
                      <p className="text-xs text-muted-foreground">{s.analyticsRegistrations}</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-4 text-center">
                      <p className="text-2xl font-bold" data-testid="text-attended">{analytics.summary?.attended || 0}</p>
                      <p className="text-xs text-muted-foreground">{s.analyticsAttended}</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-4 text-center">
                      <p className="text-2xl font-bold" data-testid="text-attendance-rate">{analytics.summary?.attendanceRate?.toFixed(1) || 0}%</p>
                      <p className="text-xs text-muted-foreground">{s.analyticsAttendanceRate}</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-4 text-center">
                      <p className="text-2xl font-bold" data-testid="text-avg-watch-time">{formatTime(analytics.summary?.avgWatchTime || 0)}</p>
                      <p className="text-xs text-muted-foreground">{s.analyticsAvgWatchTime}</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-4 text-center">
                      <p className="text-2xl font-bold" data-testid="text-completion-rate">
                        {(() => {
                          const dur = analytics.summary?.videoDuration || 0;
                          if (!dur) return "0%";
                          const attended = analytics.registrations?.filter(r => r.attended) || [];
                          if (attended.length === 0) return "0%";
                          const completed = attended.filter(r => ((r.watchDuration || 0) / dur) >= 0.9).length;
                          return `${Math.round((completed / attended.length) * 100)}%`;
                        })()}
                      </p>
                      <p className="text-xs text-muted-foreground">{s.analyticsCompletionRate}</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-4 text-center">
                      <p className="text-2xl font-bold" data-testid="text-avg-completion">
                        {(() => {
                          const dur = analytics.summary?.videoDuration || 0;
                          if (!dur) return "0%";
                          const attended = analytics.registrations?.filter(r => r.attended && r.watchDuration) || [];
                          if (attended.length === 0) return "0%";
                          const avg = attended.reduce((s, r) => s + Math.min(100, ((r.watchDuration || 0) / dur) * 100), 0) / attended.length;
                          return `${Math.round(avg)}%`;
                        })()}
                      </p>
                      <p className="text-xs text-muted-foreground">{s.analyticsAvgCompletion}</p>
                    </CardContent>
                  </Card>
                </div>

                <SessionRegistrationCounts
                  summary={sessionRegistrationCountsQuery.data}
                  lang={lang}
                  isLoading={sessionRegistrationCountsQuery.isLoading}
                  isError={sessionRegistrationCountsQuery.isError}
                  error={sessionRegistrationCountsQuery.error}
                  onRetry={() => void sessionRegistrationCountsQuery.refetch()}
                />

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">{s.analyticsRegVsAttend}</CardTitle>
                    </CardHeader>
                    <CardContent>
                      {(() => {
                        const pieData = [
                          { name: s.analyticsAttendedLabel, value: analytics.summary?.attended || 0 },
                          { name: s.analyticsNotAttendedLabel, value: (analytics.summary?.totalRegistrations || 0) - (analytics.summary?.attended || 0) },
                        ].filter(d => d.value > 0);
                        const COLORS = ["hsl(var(--primary))", "hsl(var(--muted-foreground) / 0.3)"];
                        return pieData.length > 0 ? (
                          <ResponsiveContainer width="100%" height={200}>
                            <PieChart>
                              <Pie
                                data={pieData}
                                cx="50%"
                                cy="50%"
                                innerRadius={50}
                                outerRadius={80}
                                dataKey="value"
                                label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                              >
                                {pieData.map((_, index) => (
                                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                ))}
                              </Pie>
                              <Tooltip />
                            </PieChart>
                          </ResponsiveContainer>
                        ) : (
                          <p className="text-center text-muted-foreground py-8">{s.analyticsNoData}</p>
                        );
                      })()}
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">{s.analyticsWatchDuration}</CardTitle>
                    </CardHeader>
                    <CardContent>
                      {(() => {
                        const attendedRegs = analytics.registrations?.filter(r => r.attended && r.watchDuration) || [];
                        if (attendedRegs.length === 0) return <p className="text-center text-muted-foreground py-8">{s.analyticsNoData}</p>;
                        const videoDuration = analytics.summary?.videoDuration || 3600;
                        const buckets = [
                          { name: "0-25%", count: 0 },
                          { name: "25-50%", count: 0 },
                          { name: "50-75%", count: 0 },
                          { name: "75-100%", count: 0 },
                        ];
                        attendedRegs.forEach(r => {
                          const pct = ((r.watchDuration || 0) / videoDuration) * 100;
                          if (pct < 25) buckets[0].count++;
                          else if (pct < 50) buckets[1].count++;
                          else if (pct < 75) buckets[2].count++;
                          else buckets[3].count++;
                        });
                        return (
                          <ResponsiveContainer width="100%" height={200}>
                            <RechartsBarChart data={buckets}>
                              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                              <XAxis dataKey="name" fontSize={12} tick={{ fill: "hsl(var(--muted-foreground))" }} />
                              <YAxis fontSize={12} tick={{ fill: "hsl(var(--muted-foreground))" }} allowDecimals={false} />
                              <Tooltip />
                              <Bar dataKey="count" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} name={s.analyticsViewerCount} />
                            </RechartsBarChart>
                          </ResponsiveContainer>
                        );
                      })()}
                    </CardContent>
                  </Card>
                </div>

                <Card id="webinar-section-viewer-behavior">
                  <CardHeader>
                    <CardTitle className="text-base">{s.analyticsRetention}</CardTitle>
                    <CardDescription>{s.analyticsRetentionDesc}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {(() => {
                      const attendedRegs = analytics.registrations?.filter(r => r.attended && r.watchDuration) || [];
                      if (attendedRegs.length === 0) return <p className="text-center text-muted-foreground py-8">{s.analyticsNoData}</p>;
                      const videoDuration = analytics.summary?.videoDuration || 3600;
                      const totalViewers = attendedRegs.length;
                      const points: { time: string; retention: number; viewers: number }[] = [];
                      const steps = 10;
                      for (let i = 0; i <= steps; i++) {
                        const timeSec = Math.round((i / steps) * videoDuration);
                        const viewersAtTime = attendedRegs.filter(r => (r.watchDuration || 0) >= timeSec).length;
                        const mins = Math.floor(timeSec / 60);
                        const secs = timeSec % 60;
                        points.push({
                          time: `${mins}:${secs.toString().padStart(2, "0")}`,
                          retention: Math.round((viewersAtTime / totalViewers) * 100),
                          viewers: viewersAtTime,
                        });
                      }
                      return (
                        <ResponsiveContainer width="100%" height={220}>
                          <AreaChart data={points}>
                            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                            <XAxis dataKey="time" fontSize={11} tick={{ fill: "hsl(var(--muted-foreground))" }} />
                            <YAxis fontSize={11} tick={{ fill: "hsl(var(--muted-foreground))" }} domain={[0, 100]} unit="%" />
                            <Tooltip formatter={(val: number, name: string) => name === "retention" ? [`${val}%`, s.analyticsRetentionRate] : [val, s.analyticsViewerCount]} />
                            <Area type="monotone" dataKey="retention" stroke="hsl(var(--primary))" fill="hsl(var(--primary) / 0.2)" name="retention" />
                          </AreaChart>
                        </ResponsiveContainer>
                      );
                    })()}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">{s.analyticsViewerDetail}</CardTitle>
                    <CardDescription>{s.analyticsViewerDetailDesc}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ScrollArea className="h-[350px]">
                      <div className="space-y-2">
                        {analytics.registrations?.filter((r) => r.attended).length === 0 && (
                          <p className="text-center text-muted-foreground py-4">{s.analyticsNoAttendance}</p>
                        )}
                        {analytics.registrations
                          ?.filter((r) => r.attended)
                          .sort((a, b) => (b.watchDuration || 0) - (a.watchDuration || 0))
                          .map((reg) => {
                          const dur = analytics.summary?.videoDuration || 0;
                          const pct = dur ? Math.min(100, Math.round(((reg.watchDuration || 0) / dur) * 100)) : 0;
                          const isCompleted = pct >= 90;
                          return (
                            <div key={reg.id} className="p-3 bg-muted rounded-md text-sm space-y-2" data-testid={`viewer-detail-${reg.id}`}>
                              <div className="flex items-center justify-between gap-2 flex-wrap">
                                <div className="flex-1 min-w-0">
                                  <span className="font-medium">{reg.name}</span>
                                  {reg.phone && <span className="text-muted-foreground ml-2">{reg.phone}</span>}
                                  <span className="text-muted-foreground ml-2">{reg.email}</span>
                                </div>
                                <Badge variant={isCompleted ? "default" : "secondary"}>
                                  {isCompleted ? s.analyticsCompleted : `${s.analyticsWatchPct} ${pct}%`}
                                </Badge>
                              </div>
                              <div className="flex items-center gap-3">
                                <div className="flex-1 bg-background rounded-full h-2">
                                  <div className={`h-2 rounded-full ${isCompleted ? "bg-green-500" : "bg-primary"}`} style={{ width: `${pct}%` }} />
                                </div>
                                <span className="text-muted-foreground text-xs w-24 text-right shrink-0">
                                  {formatTime(reg.watchDuration || 0)}{dur ? ` / ${formatTime(dur)}` : ""}
                                </span>
                              </div>
                              <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
                                {reg.attendedAt && (
                                  <span>{s.analyticsEntered} {new Date(reg.attendedAt).toLocaleString(lang, { hour: "2-digit", minute: "2-digit" })}</span>
                                )}
                                {reg.leftAt && (
                                  <span>{s.analyticsLeft} {new Date(reg.leftAt).toLocaleString(lang, { hour: "2-digit", minute: "2-digit" })}</span>
                                )}
                                {!isCompleted && dur > 0 && (
                                  <span>{s.analyticsDropOff} {formatTime(reg.watchDuration || 0)} {s.analyticsDropOffSuffix} ({pct}%)</span>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </ScrollArea>
                  </CardContent>
                </Card>
              </div>
            ) : (
              <Card>
                <CardContent className="py-8">
                  <p className="text-center text-muted-foreground">{s.analyticsNoAnalytics}</p>
                </CardContent>
              </Card>
            )}
              </div>
            </div>
          </TabsContent>

          {/* ===== Settings Tab ===== */}
          <TabsContent value="settings">
            <div className="admin-workspace-grid">
              {contextualRail([
                { id: "tracking", label: "轉換追蹤", icon: Activity },
                { id: "registration-form", label: s.cfTitle, icon: FileText },
                { id: "scarcity", label: s.scTitle, icon: Clock },
                { id: "pages", label: s.pgTitle, icon: Eye },
                { id: "webinar-info", label: s.settingsWebinarInfo, icon: Settings },
                { id: "brand", label: "品牌設定", icon: Palette },
                { id: "embed", label: "嵌入與分享", icon: Code },
                { id: "external-journey", label: "外部旅程與歸因", icon: Link2 },
                { id: "course-marketplace", label: "課程廣場", icon: ShoppingBag },
              ], settingsSection, setSettingsSection)}
              <div className="space-y-6">
              {settingsSection === "tracking" && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">轉換追蹤</CardTitle>
                  <CardDescription>
                    僅需輸入平台提供的 ID。系統只會載入 Meta Pixel 與 Google Tag Manager 官方程式碼。
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="meta-pixel-id">Meta Pixel ID</Label>
                    <Input
                      id="meta-pixel-id"
                      inputMode="numeric"
                      value={metaPixelId}
                      onChange={(event) => setMetaPixelId(event.target.value.trim())}
                      placeholder="例如：123456789012345"
                      aria-invalid={Boolean(metaPixelId && !isValidMetaPixelId(metaPixelId))}
                      data-testid="input-meta-pixel-id"
                    />
                    {metaPixelId && !isValidMetaPixelId(metaPixelId) && (
                      <p className="text-sm text-destructive" data-testid="error-meta-pixel-id">
                        Meta Pixel ID 必須為 5–32 位數字
                      </p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="gtm-container-id">Google Tag Manager Container ID</Label>
                    <Input
                      id="gtm-container-id"
                      value={gtmContainerId}
                      onChange={(event) => setGtmContainerId(event.target.value.trim().toUpperCase())}
                      placeholder="例如：GTM-ABC123"
                      aria-invalid={Boolean(gtmContainerId && !isValidGtmContainerId(gtmContainerId))}
                      data-testid="input-gtm-container-id"
                    />
                    {gtmContainerId && !isValidGtmContainerId(gtmContainerId) && (
                      <p className="text-sm text-destructive" data-testid="error-gtm-container-id">
                        必須為 GTM- 開頭的大寫英數字，總長 8–24 字元
                      </p>
                    )}
                  </div>
                  <Button
                    onClick={() => saveTrackingSettings.mutate()}
                    disabled={
                      saveTrackingSettings.isPending ||
                      Boolean(metaPixelId && !isValidMetaPixelId(metaPixelId)) ||
                      Boolean(gtmContainerId && !isValidGtmContainerId(gtmContainerId))
                    }
                    data-testid="button-save-tracking"
                  >
                    {saveTrackingSettings.isPending
                      ? <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      : <Save className="h-4 w-4 mr-2" />}
                    儲存追蹤設定
                  </Button>
                </CardContent>
              </Card>
              )}

              {settingsSection === "registration-form" && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">{s.cfTitle}</CardTitle>
                  <CardDescription>{s.cfDesc}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {customFields.length > 0 ? (
                    customFields.map((field, idx) => (
                      <div key={field.id} className="p-3 border rounded-md space-y-2" data-testid={`card-custom-field-${field.id}`}>
                        <div className="flex items-center gap-2">
                          <Input
                            value={field.label}
                            onChange={(e) => setCustomFields((prev) => prev.map((f, i) => i === idx ? { ...f, label: e.target.value } : f))}
                            placeholder={s.cfLabelPlaceholder}
                            className="flex-1"
                            data-testid={`input-cf-label-${field.id}`}
                          />
                          <Select value={field.type} onValueChange={(v) => setCustomFields((prev) => prev.map((f, i) => i === idx ? { ...f, type: v as CustomField["type"] } : f))}>
                            <SelectTrigger className="w-[130px]" data-testid={`select-cf-type-${field.id}`}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="text">{s.cfTypeText}</SelectItem>
                              <SelectItem value="textarea">{s.cfTypeTextarea}</SelectItem>
                              <SelectItem value="select">{s.cfTypeSelect}</SelectItem>
                              <SelectItem value="checkbox">{s.cfTypeCheckbox}</SelectItem>
                            </SelectContent>
                          </Select>
                          <Button variant="ghost" size="icon" onClick={() => setCustomFields((prev) => prev.filter((_, i) => i !== idx))} data-testid={`button-delete-cf-${field.id}`}>
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                        {field.type === "select" && (
                          <Input
                            value={(field.options || []).join(", ")}
                            onChange={(e) => setCustomFields((prev) => prev.map((f, i) => i === idx ? { ...f, options: e.target.value.split(",").map((o) => o.trim()).filter(Boolean) } : f))}
                            placeholder={s.cfOptionsPlaceholder}
                            data-testid={`input-cf-options-${field.id}`}
                          />
                        )}
                        <div className="flex items-center gap-2">
                          <Switch
                            checked={field.required}
                            onCheckedChange={(v) => setCustomFields((prev) => prev.map((f, i) => i === idx ? { ...f, required: v } : f))}
                            data-testid={`switch-cf-required-${field.id}`}
                          />
                          <Label className="text-sm">{s.cfRequired}</Label>
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="text-center text-muted-foreground py-4 text-sm">{s.cfNoFields}</p>
                  )}
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCustomFields((prev) => [...prev, { id: `cf_${Date.now()}`, label: "", type: "text", required: false }])}
                      data-testid="button-add-custom-field"
                    >
                      <Plus className="h-4 w-4 mr-1" />
                      {s.cfAddField}
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => saveCustomFields.mutate(customFields.filter((f) => f.label.trim()))}
                      disabled={saveCustomFields.isPending}
                      data-testid="button-save-custom-fields"
                    >
                      {saveCustomFields.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Save className="h-4 w-4 mr-1" />}
                      {s.cfSave}
                    </Button>
                  </div>
                </CardContent>
              </Card>
              )}

              {settingsSection === "scarcity" && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">{s.scTitle}</CardTitle>
                  <CardDescription>{s.scDesc}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <Label>{s.scCountdown}</Label>
                      <p className="text-sm text-muted-foreground">{s.scCountdownHint}</p>
                    </div>
                    <Switch checked={scarcityCountdown} onCheckedChange={setScarcityCountdown} data-testid="switch-scarcity-countdown" />
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <Label>{s.scSeats}</Label>
                      <p className="text-sm text-muted-foreground">{s.scSeatsHint}</p>
                    </div>
                    <Switch checked={scarcitySeats} onCheckedChange={setScarcitySeats} data-testid="switch-scarcity-seats" />
                  </div>
                  {scarcitySeats && (
                    <div className="space-y-2">
                      <Label>{s.scTotalSeats}</Label>
                      <Input
                        type="number"
                        value={scarcityTotalSeats}
                        onChange={(e) => setScarcityTotalSeats(e.target.value)}
                        data-testid="input-scarcity-seats"
                      />
                    </div>
                  )}
                  <div className="space-y-2">
                    <Label>{s.scUrgency}</Label>
                    <Input
                      value={scarcityUrgency}
                      onChange={(e) => setScarcityUrgency(e.target.value)}
                      placeholder={s.scUrgencyPlaceholder}
                      data-testid="input-scarcity-urgency"
                    />
                  </div>
                  <Button onClick={() => saveScarcity.mutate()} disabled={saveScarcity.isPending} data-testid="button-save-scarcity">
                    {saveScarcity.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
                    {s.scSave}
                  </Button>
                </CardContent>
              </Card>
              )}

              {settingsSection === "pages" && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">{s.pgTitle}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <Label className="font-medium">{s.pgThankYouEnable}</Label>
                      <Switch checked={thankYouEnabled} onCheckedChange={setThankYouEnabled} data-testid="switch-thankyou-enabled" />
                    </div>
                    <p className="text-sm text-muted-foreground">{s.pgThankYou}</p>
                    <Input value={thankYouHeadline} onChange={(e) => setThankYouHeadline(e.target.value)} placeholder={s.pgHeadline} data-testid="input-thankyou-headline" />
                    <Textarea value={thankYouMessage} onChange={(e) => setThankYouMessage(e.target.value)} placeholder={s.pgMessage} rows={2} data-testid="input-thankyou-message" />
                    <div className="grid grid-cols-2 gap-2">
                      <Input value={thankYouCtaText} onChange={(e) => setThankYouCtaText(e.target.value)} placeholder={s.pgCtaText} data-testid="input-thankyou-cta-text" />
                      <Input value={thankYouCtaUrl} onChange={(e) => setThankYouCtaUrl(e.target.value)} placeholder={s.pgCtaUrl} data-testid="input-thankyou-cta-url" />
                    </div>
                  </div>
                  <div className="space-y-3 border-t pt-4">
                    <Label className="font-medium">{s.pgReplay}</Label>
                    <Input value={replayHeadline} onChange={(e) => setReplayHeadline(e.target.value)} placeholder={s.pgHeadline} data-testid="input-replay-headline" />
                    <Textarea value={replayMessage} onChange={(e) => setReplayMessage(e.target.value)} placeholder={s.pgMessage} rows={2} data-testid="input-replay-message" />
                    <div className="grid grid-cols-2 gap-2">
                      <Input value={replayCtaText} onChange={(e) => setReplayCtaText(e.target.value)} placeholder={s.pgCtaText} data-testid="input-replay-cta-text" />
                      <Input value={replayCtaUrl} onChange={(e) => setReplayCtaUrl(e.target.value)} placeholder={s.pgCtaUrl} data-testid="input-replay-cta-url" />
                    </div>
                  </div>
                  <Button onClick={() => savePages.mutate()} disabled={savePages.isPending} data-testid="button-save-pages">
                    {savePages.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
                    {s.pgSave}
                  </Button>
                </CardContent>
              </Card>
              )}

              {settingsSection === "webinar-info" && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">{s.settingsWebinarInfo}</CardTitle>
                  <CardDescription>{s.settingsWebinarInfoDesc}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label>{s.settingsTitle}</Label>
                    <Input
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      placeholder={s.placeholderTitle}
                      data-testid="input-settings-title"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>{s.settingsDescription}</Label>
                    <Textarea
                      value={editDescription}
                      onChange={(e) => setEditDescription(e.target.value)}
                      placeholder={s.placeholderDescription}
                      className="resize-none"
                      rows={3}
                      data-testid="input-settings-description"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>{s.settingsVimeoUrl}</Label>
                    <VideoSourcePicker vimeoUrl={editVimeoUrl} videoAssetId={editVideoAssetId} onChange={(source) => {
                      setEditVimeoUrl(source.vimeoUrl);
                      setEditVideoProvider(source.videoProvider);
                      setEditVideoAssetId(source.videoAssetId);
                    }} />
                  </div>
                  <div className="space-y-2">
                    <Label>{s.settingsStartTime}</Label>
                    <Input
                      type="datetime-local"
                      value={editStartTime}
                      onChange={(e) => setEditStartTime(e.target.value)}
                      data-testid="input-settings-start-time"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>{s.settingsCoverImage}</Label>
                    {editCoverImage ? (
                      <div className="relative rounded-md overflow-hidden border">
                        <img src={editCoverImage} alt={s.altCoverPreview} className="w-full h-32 object-cover" />
                        <Button
                          variant="outline"
                          size="icon"
                          className="absolute top-2 right-2 bg-background/80 backdrop-blur-sm"
                          onClick={() => setEditCoverImage("")}
                          data-testid="button-settings-remove-cover"
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    ) : (
                      <div
                        className="border-2 border-dashed rounded-md p-4 flex flex-col items-center justify-center gap-2 cursor-pointer hover-elevate"
                        onClick={() => coverFileRef.current?.click()}
                        data-testid="button-settings-upload-cover-area"
                      >
                        <ImagePlus className="h-6 w-6 text-muted-foreground" />
                        <span className="text-xs text-muted-foreground">{s.clickUploadCover}</span>
                      </div>
                    )}
                    <div className="flex items-center gap-2">
                      <Input
                        value={editCoverImage}
                        onChange={(e) => setEditCoverImage(e.target.value)}
                        placeholder={s.placeholderImageUrl}
                        className="flex-1 text-xs"
                        data-testid="input-settings-cover"
                      />
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={() => coverFileRef.current?.click()}
                        disabled={uploadingCover}
                        data-testid="button-settings-upload-cover"
                      >
                        <Upload className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  <Button
                    onClick={async () => {
                      const oldCover = webinar.coverImage;
                      const newCover = editCoverImage || null;
                      if (oldCover && oldCover.startsWith("/uploads/") && oldCover !== newCover) {
                        try {
                          await fetch("/api/upload", {
                            method: "DELETE",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ url: oldCover }),
                          });
                        } catch {}
                      }
                      updateWebinar.mutate({
                        title: editTitle,
                        description: editDescription || null,
                        vimeoUrl: editVimeoUrl,
                        videoProvider: editVideoProvider,
                        videoAssetId: editVideoAssetId || null,
                        startTime: new Date(editStartTime).toISOString(),
                        coverImage: newCover,
                      });
                    }}
                    disabled={updateWebinar.isPending || !editTitle || (editVideoProvider === "vimeo" ? !editVimeoUrl : !editVideoAssetId)}
                    data-testid="button-save-webinar-info"
                  >
                    {updateWebinar.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                    {s.settingsSaveWebinarInfo}
                  </Button>
                </CardContent>
              </Card>
              )}

              {settingsSection === "brand" && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Palette className="h-4 w-4" />
                    {s.settingsBrandTitle}
                  </CardTitle>
                  <CardDescription>{s.settingsBrandDesc}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label>{s.settingsLogoUrl}</Label>
                    <Input
                      value={brandLogo}
                      onChange={(e) => setBrandLogo(e.target.value)}
                      placeholder="https://example.com/logo.png"
                      data-testid="input-brand-logo"
                    />
                  </div>
                  <div className="grid grid-cols-3 gap-4">
                    <div className="space-y-2">
                      <Label>{s.settingsPrimaryColor}</Label>
                      <div className="flex items-center gap-2">
                        <input
                          type="color"
                          value={brandPrimaryColor}
                          onChange={(e) => setBrandPrimaryColor(e.target.value)}
                          className="w-10 h-10 rounded-md border cursor-pointer"
                          data-testid="input-brand-primary-color"
                        />
                        <Input
                          value={brandPrimaryColor}
                          onChange={(e) => setBrandPrimaryColor(e.target.value)}
                          className="flex-1"
                        />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label>{s.settingsSecondaryColor}</Label>
                      <div className="flex items-center gap-2">
                        <input
                          type="color"
                          value={brandSecondaryColor}
                          onChange={(e) => setBrandSecondaryColor(e.target.value)}
                          className="w-10 h-10 rounded-md border cursor-pointer"
                          data-testid="input-brand-secondary-color"
                        />
                        <Input
                          value={brandSecondaryColor}
                          onChange={(e) => setBrandSecondaryColor(e.target.value)}
                          className="flex-1"
                        />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label>{s.settingsBgColor}</Label>
                      <div className="flex items-center gap-2">
                        <input
                          type="color"
                          value={brandBackgroundColor}
                          onChange={(e) => setBrandBackgroundColor(e.target.value)}
                          className="w-10 h-10 rounded-md border cursor-pointer"
                          data-testid="input-brand-bg-color"
                        />
                        <Input
                          value={brandBackgroundColor}
                          onChange={(e) => setBrandBackgroundColor(e.target.value)}
                          className="flex-1"
                        />
                      </div>
                    </div>
                  </div>
                  {brandLogo && (
                    <div className="p-3 bg-muted rounded-md">
                      <p className="text-xs text-muted-foreground mb-2">{s.settingsLogoPreview}</p>
                      <img src={brandLogo} alt="Logo preview" className="max-h-16 object-contain" />
                    </div>
                  )}
                  <Button
                    onClick={() => {
                      updateWebinar.mutate({
                        brandSettings: {
                          logo: brandLogo,
                          watermark: "",
                          primaryColor: brandPrimaryColor,
                          secondaryColor: brandSecondaryColor,
                          backgroundColor: brandBackgroundColor,
                        },
                      });
                    }}
                    disabled={updateWebinar.isPending}
                    data-testid="button-save-brand"
                  >
                    {updateWebinar.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                    {s.settingsSaveBrand}
                  </Button>
                </CardContent>
              </Card>
              )}

              {settingsSection === "embed" && (
              <>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Globe className="h-4 w-4" />
                    {s.settingsLinksTitle}
                  </CardTitle>
                  <CardDescription>{s.settingsLinksDesc}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {webinar.publishStatus !== "published" && (
                    <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                      目前是草稿。您可以使用右側按鈕登入預覽，但公開連結與嵌入碼要在訂閱並發布後才會啟用。
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <Input value={registrationUrl} readOnly className="flex-1" />
                    <Button variant="outline" size="icon" disabled={webinar.publishStatus !== "published"} onClick={() => copyToClipboard(registrationUrl)}>
                      <Copy className="h-4 w-4" />
                    </Button>
                    <Button variant="outline" size="icon" onClick={() => window.open(registrationUrl, "_blank")}>
                      <ExternalLink className="h-4 w-4" />
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">{s.settingsShareLink}</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Code className="h-4 w-4" />
                    {s.settingsEmbedRegTitle}
                  </CardTitle>
                  <CardDescription>{s.settingsEmbedRegDesc}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="relative">
                    <pre className="bg-muted p-3 rounded-md text-xs overflow-x-auto whitespace-pre-wrap break-all" data-testid="text-embed-register-code">{`<iframe src="${window.location.origin}/embed/register/${id}" width="100%" height="500" frameborder="0" style="border:none;border-radius:12px;max-width:460px;"></iframe>`}</pre>
                    <Button
                      variant="outline"
                      size="icon"
                      className="absolute top-2 right-2"
                      onClick={() => {
                        navigator.clipboard.writeText(`<iframe src="${window.location.origin}/embed/register/${id}" width="100%" height="500" frameborder="0" style="border:none;border-radius:12px;max-width:460px;"></iframe>`);
                        toast({ title: s.toastEmbedCodeCopied });
                      }}
                      disabled={webinar.publishStatus !== "published"}
                      data-testid="button-copy-embed-register"
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="bg-muted/50 p-3 rounded-md">
                    <p className="text-xs text-muted-foreground">{s.settingsPreviewEffect}</p>
                    <div className="mt-2 border rounded-md overflow-hidden" style={{ maxWidth: 460 }}>
                      <iframe
                        src={`/embed/register/${id}`}
                        width="100%"
                        height="400"
                        style={{ border: "none" }}
                        title={s.settingsRegFormPreview}
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">{s.settingsEmbedWebinarTitle}</CardTitle>
                  <CardDescription>{s.settingsEmbedWebinarDesc}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="relative">
                    <pre className="bg-muted p-3 rounded-md text-xs overflow-x-auto whitespace-pre-wrap break-all" data-testid="text-embed-webinar-code">{`<iframe src="${window.location.origin}/embed/webinar/${id}" width="100%" height="700" frameborder="0" style="border:none;border-radius:12px;" allow="autoplay; fullscreen"></iframe>`}</pre>
                    <Button
                      variant="outline"
                      size="icon"
                      className="absolute top-2 right-2"
                      onClick={() => {
                        navigator.clipboard.writeText(`<iframe src="${window.location.origin}/embed/webinar/${id}" width="100%" height="700" frameborder="0" style="border:none;border-radius:12px;" allow="autoplay; fullscreen"></iframe>`);
                        toast({ title: s.toastEmbedCodeCopied });
                      }}
                      disabled={webinar.publishStatus !== "published"}
                      data-testid="button-copy-embed-webinar"
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">{s.settingsPopupTitle}</CardTitle>
                  <CardDescription>{s.settingsPopupDesc}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="border rounded-md p-3 bg-primary/5">
                    <p className="text-sm font-semibold mb-1">{s.settingsAllInOne}</p>
                    <p className="text-xs text-muted-foreground mb-2">{s.settingsAllInOneDesc}</p>
                    <div className="relative">
                      <pre className="bg-muted p-3 rounded-md text-xs overflow-x-auto whitespace-pre-wrap break-all" data-testid="text-embed-allinone-code">{`<script src="${window.location.origin}/livecast-widget.js"></script>\n<button data-livecast-register="${id}">${s.settingsRegisterNow}</button>`}</pre>
                      <Button
                        size="sm"
                        className="absolute top-2 right-2"
                        onClick={() => {
                          navigator.clipboard.writeText(`<script src="${window.location.origin}/livecast-widget.js"></script>\n<button data-livecast-register="${id}">${s.settingsRegisterNow}</button>`);
                          toast({ title: s.toastEmbedCodeCopied });
                        }}
                        disabled={webinar.publishStatus !== "published"}
                        data-testid="button-copy-embed-allinone"
                      >
                        <Copy className="h-4 w-4 mr-1" />
                        {s.settingsCopyAll}
                      </Button>
                    </div>
                  </div>
                  <div>
                    <p className="text-sm font-medium mb-2">{s.settingsStep1Script}</p>
                    <div className="relative">
                      <pre className="bg-muted p-3 rounded-md text-xs overflow-x-auto whitespace-pre-wrap break-all" data-testid="text-embed-script-code">{`<script src="${window.location.origin}/livecast-widget.js"></script>`}</pre>
                      <Button
                        variant="outline"
                        size="icon"
                        className="absolute top-2 right-2"
                        onClick={() => {
                          navigator.clipboard.writeText(`<script src="${window.location.origin}/livecast-widget.js"></script>`);
                          toast({ title: s.toastScriptCodeCopied });
                        }}
                        data-testid="button-copy-embed-script"
                      >
                        <Copy className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  <div>
                    <p className="text-sm font-medium mb-2">{s.settingsStep2Button}</p>
                    <div className="relative">
                      <pre className="bg-muted p-3 rounded-md text-xs overflow-x-auto whitespace-pre-wrap break-all" data-testid="text-embed-button-code">{`<button data-livecast-register="${id}">${s.settingsRegisterNow}</button>`}</pre>
                      <Button
                        variant="outline"
                        size="icon"
                        className="absolute top-2 right-2"
                        onClick={() => {
                          navigator.clipboard.writeText(`<button data-livecast-register="${id}">${s.settingsRegisterNow}</button>`);
                          toast({ title: s.toastButtonCodeCopied });
                        }}
                        disabled={webinar.publishStatus !== "published"}
                        data-testid="button-copy-embed-button"
                      >
                        <Copy className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  <div>
                    <p className="text-sm font-medium mb-2">{s.settingsOrJsCall}</p>
                    <div className="relative">
                      <pre className="bg-muted p-3 rounded-md text-xs overflow-x-auto whitespace-pre-wrap break-all">{`ICTA_WEBINAR.openRegister("${id}");`}</pre>
                      <Button
                        variant="outline"
                        size="icon"
                        className="absolute top-2 right-2"
                        onClick={() => {
                          navigator.clipboard.writeText(`ICTA_WEBINAR.openRegister("${id}");`);
                          toast({ title: s.toastCopiedSimple });
                        }}
                        disabled={webinar.publishStatus !== "published"}
                      >
                        <Copy className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">{s.settingsInlineTitle}</CardTitle>
                  <CardDescription>{s.settingsInlineDesc}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <p className="text-sm font-medium mb-2">{s.settingsStep1Script}</p>
                    <div className="relative">
                      <pre className="bg-muted p-3 rounded-md text-xs overflow-x-auto whitespace-pre-wrap break-all" data-testid="text-embed-inline-script">{`<script src="${window.location.origin}/livecast-widget.js"></script>`}</pre>
                      <Button
                        variant="outline"
                        size="icon"
                        className="absolute top-2 right-2"
                        onClick={() => {
                          navigator.clipboard.writeText(`<script src="${window.location.origin}/livecast-widget.js"></script>`);
                          toast({ title: s.toastScriptCodeCopied });
                        }}
                        data-testid="button-copy-inline-script"
                      >
                        <Copy className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  <div>
                    <p className="text-sm font-medium mb-2">{s.settingsStep2Container}</p>
                    <div className="relative">
                      <pre className="bg-muted p-3 rounded-md text-xs overflow-x-auto whitespace-pre-wrap break-all" data-testid="text-embed-inline-div">{`<div data-livecast-inline-register="${id}"></div>`}</pre>
                      <Button
                        variant="outline"
                        size="icon"
                        className="absolute top-2 right-2"
                        onClick={() => {
                          navigator.clipboard.writeText(`<div data-livecast-inline-register="${id}"></div>`);
                          toast({ title: s.toastInlineCodeCopied });
                        }}
                        data-testid="button-copy-inline-div"
                      >
                        <Copy className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">{s.settingsInlineNote}</p>
                </CardContent>
              </Card>
              </>
              )}
               {settingsSection === "external-journey" && (
                 <ExternalJourneyPanel webinarId={id!} webinarPublished={webinar.publishStatus === "published"} />
               )}
              {settingsSection === "course-marketplace" && (
                <Card data-testid="card-course-marketplace">
                  <CardHeader>
                    <CardTitle className="text-base">課程廣場</CardTitle>
                    <CardDescription>
                      使用付費方案的會員，可將已發布的說明會提交至課程廣場。申請須經管理員審核，無法由課程擁有者自行核准。
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {courseMarketplace.isLoading ? (
                      <p className="text-sm text-muted-foreground">載入申請狀態中…</p>
                    ) : (
                      <>
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-muted-foreground">目前狀態</span>
                          <Badge variant="outline" data-testid="badge-course-marketplace-status">
                            {( { pending: "審核中", approved: "已核准", rejected: "已拒絕", withdrawn: "已撤回" } as Record<string, string>)[courseMarketplace.data?.status || ""] || "尚未申請"}
                          </Badge>
                        </div>
                        {courseMarketplace.data?.status === "rejected" && courseMarketplace.data.rejectionReason && (
                          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm" role="alert" data-testid="text-course-marketplace-rejection">
                            <p className="font-medium">拒絕原因</p>
                            <p className="mt-1">{courseMarketplace.data.rejectionReason}</p>
                          </div>
                        )}
                        <p className="text-sm text-muted-foreground">
                          只有已發布且具備付費方案的直播間才能申請；送出後會由管理員以目前課程內容進行審核。
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {(!courseMarketplace.data || ["rejected", "withdrawn"].includes(courseMarketplace.data.status)) && (
                            <Button
                              type="button"
                              data-testid="button-course-marketplace-submit"
                              disabled={courseMarketplaceMutation.isPending || webinar.publishStatus !== "published"}
                              onClick={() => courseMarketplaceMutation.mutate(true)}
                            >
                              {courseMarketplace.data?.status === "rejected" ? "重新提交申請" : "提交申請"}
                            </Button>
                          )}
                          {courseMarketplace.data && ["pending", "approved"].includes(courseMarketplace.data.status) && (
                            <Button
                              type="button"
                              variant="outline"
                              data-testid="button-course-marketplace-withdraw"
                              disabled={courseMarketplaceMutation.isPending}
                              onClick={() => courseMarketplaceMutation.mutate(false)}
                            >
                              撤回申請
                            </Button>
                          )}
                        </div>
                        {webinar.publishStatus !== "published" && <p className="text-xs text-muted-foreground">請先發布直播間後再申請。</p>}
                        {webinar.publishStatus === "published" && !offers?.some((offer) => offer.active !== false) && <p className="text-xs text-muted-foreground">請先建立至少一個付費方案。</p>}
                      </>
                    )}
                  </CardContent>
                </Card>
              )}
            </div>
              </div>
          </TabsContent>

           <TabsContent value="salesScript">
             <SalesScriptGenerator
               webinarId={id!}
               webinarTitle={webinar.title}
               webinarDescription={webinar.description}
             />
           </TabsContent>

           {/* ===== AI 助教 Tab ===== */}
          <TabsContent value="ai">
            <div className="admin-workspace-grid">
              {contextualRail([
                { id: "training", label: s.aiTrainingTitle, icon: BrainCircuit },
                { id: "assistant", label: s.aiTitle, icon: Bot },
                { id: "knowledge", label: s.aiDocsTitle, icon: FileText },
                { id: "generated-content", label: "AI 生成內容", icon: Sparkles },
              ], aiSection, setAiSection)}
              <div className="space-y-6">
              <Card id="webinar-section-training" className="overflow-hidden border-primary/20">
                <CardHeader className="border-b bg-gradient-to-r from-primary/10 via-primary/5 to-transparent">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="space-y-1">
                      <CardTitle className="flex items-center gap-2 text-base">
                        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
                          <BrainCircuit className="h-5 w-5" />
                        </span>
                        {s.aiTrainingTitle}
                      </CardTitle>
                      <CardDescription>{s.aiTrainingDesc}</CardDescription>
                    </div>
                    <Badge variant={aiTrainingReady ? "default" : "secondary"} className="w-fit gap-1.5">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      {aiTrainingReady ? s.aiTrainingReady : s.aiTrainingNeedsDocs}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-5 pt-6">
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="rounded-xl border bg-muted/35 p-4">
                      <p className="text-xs font-medium text-muted-foreground">{s.aiTrainingDocs}</p>
                      <p className="mt-2 text-2xl font-semibold tabular-nums">{documents?.length || 0}</p>
                    </div>
                    <div className="rounded-xl border bg-muted/35 p-4">
                      <p className="text-xs font-medium text-muted-foreground">{s.aiTrainingCharacters}</p>
                      <p className="mt-2 text-2xl font-semibold tabular-nums">{aiKnowledgeCharacters.toLocaleString()}</p>
                    </div>
                    <div className="rounded-xl border bg-muted/35 p-4">
                      <p className="text-xs font-medium text-muted-foreground">{s.aiTrainingPoints}</p>
                      <p className="mt-2 text-2xl font-semibold tabular-nums">
                        {isAiPointBalanceLoading ? "—" : aiPointBalance?.unlimited ? s.aiTrainingUnlimited : (aiPointBalance?.points || 0).toLocaleString()}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-start gap-3">
                      <span className={cn("mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full", aiEnabled ? "bg-emerald-100 text-emerald-700" : "bg-muted text-muted-foreground")}>
                        <Bot className="h-4 w-4" />
                      </span>
                      <div>
                        <p className="text-sm font-medium">{aiEnabled ? s.aiTrainingActive : s.aiTrainingInactive}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {aiTrainingReady ? `${documents?.length || 0} ${s.aiTrainingDocs} · ${aiKnowledgeCharacters.toLocaleString()} ${s.aiTrainingCharacters}` : s.aiDocsDesc}
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button type="button" variant="outline" size="sm" onClick={() => {
                        setAiSection("knowledge");
                        document.getElementById("webinar-section-knowledge")?.scrollIntoView({ behavior: "smooth", block: "start" });
                      }}>
                        <FileText className="mr-1.5 h-4 w-4" />{s.aiTrainingAddKnowledge}
                      </Button>
                      <Button type="button" size="sm" onClick={() => {
                        setAiSection("assistant");
                        document.getElementById("webinar-section-assistant")?.scrollIntoView({ behavior: "smooth", block: "start" });
                      }}>
                        <Settings className="mr-1.5 h-4 w-4" />{s.aiTrainingConfigure}
                      </Button>
                    </div>
                  </div>
                  <div className="space-y-4 rounded-xl border bg-muted/20 p-4">
                    <div>
                      <p className="text-sm font-semibold">{s.aiTestTitle}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{s.aiTestDesc}</p>
                    </div>
                    <Textarea
                      value={aiTestQuestion}
                      onChange={(event) => setAiTestQuestion(event.target.value)}
                      placeholder={s.aiTestPlaceholder}
                      rows={3}
                      maxLength={2000}
                      disabled={!aiTrainingReady || testAiQuestion.isPending}
                      data-testid="input-ai-test-question"
                    />
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <p className="text-xs text-muted-foreground">
                        {aiTrainingReady ? s.aiTestCost : s.aiTestNoDocs}
                      </p>
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => testAiQuestion.mutate()}
                        disabled={!aiTrainingReady || !aiTestQuestion.trim() || testAiQuestion.isPending}
                        data-testid="button-ai-test-question"
                      >
                        {testAiQuestion.isPending
                          ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                          : <Send className="mr-1.5 h-4 w-4" />}
                        {s.aiTestSubmit}
                      </Button>
                    </div>
                    {aiTestAnswer && (
                      <div className="rounded-lg border bg-background p-4" data-testid="ai-test-answer">
                        <p className="mb-2 text-xs font-semibold text-muted-foreground">{s.aiTestAnswer}</p>
                        <p className="whitespace-pre-wrap text-sm leading-6">{aiTestAnswer}</p>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>

              <Card id="webinar-section-assistant" className="scroll-mt-24">
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Bot className="h-5 w-5" />
                    {s.aiTitle}
                  </CardTitle>
                  <CardDescription>{s.aiDesc}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <Label className="font-medium">{s.aiEnabledLabel}</Label>
                      <p className="text-sm text-muted-foreground">{s.aiEnabledHint}</p>
                    </div>
                    <Switch
                      checked={aiEnabled}
                      disabled={isAiPointBalanceLoading || !aiPointBalance}
                      onCheckedChange={(enabled) => {
                        if (enabled && aiPointBalance && !aiPointBalance.unlimited && aiPointBalance.points <= 0) {
                          toast({ title: s.aiGenNoPoints, description: "請先購買 AI 點數後再啟用 AI 助教。", variant: "destructive" });
                          setLocation("/admin/dashboard?buy-points=1");
                          return;
                        }
                        setAiEnabled(enabled);
                      }}
                      data-testid="switch-ai-enabled"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>{s.aiTeacherName}</Label>
                    <Input
                      value={aiTeacherName}
                      onChange={(e) => setAiTeacherName(e.target.value)}
                      placeholder={s.aiTeacherNamePlaceholder}
                      data-testid="input-ai-teacher-name"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>{s.aiFallbackLabel}</Label>
                    <p className="text-sm text-muted-foreground">{s.aiFallbackHint}</p>
                    <Textarea
                      value={aiFallback}
                      onChange={(e) => setAiFallback(e.target.value)}
                      placeholder={s.aiFallbackPlaceholder}
                      rows={2}
                      data-testid="input-ai-fallback"
                    />
                  </div>
                  <Button
                    onClick={() => saveAiSettings.mutate()}
                    disabled={saveAiSettings.isPending}
                    data-testid="button-save-ai-settings"
                  >
                    {saveAiSettings.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
                    {s.aiSaveSettings}
                  </Button>
                </CardContent>
              </Card>

                <Card id="webinar-section-knowledge" className="scroll-mt-24">
                <CardHeader className="flex flex-row items-center justify-between gap-2">
                  <div>
                    <CardTitle className="text-base flex items-center gap-2">
                      <FileText className="h-5 w-5" />
                      {s.aiDocsTitle}
                    </CardTitle>
                    <CardDescription>{s.aiDocsDesc}</CardDescription>
                  </div>
                  <Dialog open={isDocOpen} onOpenChange={setIsDocOpen}>
                    <DialogTrigger asChild>
                      <Button size="sm" data-testid="button-add-document">
                        <Plus className="h-4 w-4 mr-1" />
                        {s.aiAddDoc}
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>{s.aiDocDialogTitle}</DialogTitle>
                      </DialogHeader>
                      <div className="space-y-4">
                        <div className="space-y-2">
                          <Label>{s.aiDocTitle}</Label>
                          <Input
                            value={newDocTitle}
                            onChange={(e) => setNewDocTitle(e.target.value)}
                            placeholder={s.aiDocTitlePlaceholder}
                            data-testid="input-document-title"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>{s.aiSrtUpload}</Label>
                          <Input
                            type="file"
                            accept=".srt,text/plain"
                            onChange={handleSrtUpload}
                            data-testid="input-document-srt"
                          />
                          <p className="text-xs text-muted-foreground">{s.aiSrtHint}</p>
                        </div>
                        <div className="space-y-2">
                          <Label>{s.aiDocContent}</Label>
                          <Textarea
                            value={newDocContent}
                            onChange={(e) => setNewDocContent(e.target.value)}
                            placeholder={s.aiDocContentPlaceholder}
                            rows={10}
                            data-testid="input-document-content"
                          />
                        </div>
                        <Button
                          onClick={() => createDocument.mutate({ title: newDocTitle.trim(), content: newDocContent.trim() })}
                          disabled={createDocument.isPending || !newDocTitle.trim() || !newDocContent.trim()}
                          data-testid="button-save-document"
                        >
                          {createDocument.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                          {s.btnCreate}
                        </Button>
                      </div>
                    </DialogContent>
                  </Dialog>
                </CardHeader>
                <CardContent>
                  {documents && documents.length > 0 ? (
                    <div className="space-y-2">
                      {documents.map((doc) => (
                        <div key={doc.id} className="flex items-start justify-between p-3 bg-muted rounded-md gap-3" data-testid={`card-document-${doc.id}`}>
                          <div className="min-w-0 flex-1">
                            <p className="font-medium" data-testid={`text-document-title-${doc.id}`}>{doc.title}</p>
                            <p className="text-sm text-muted-foreground line-clamp-2 whitespace-pre-wrap">{doc.content}</p>
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => deleteDocument.mutate(doc.id)}
                            data-testid={`button-delete-document-${doc.id}`}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-center text-muted-foreground py-8">{s.aiNoDocs}</p>
                  )}
                </CardContent>
              </Card>
            </div>
              </div>
          </TabsContent>
        </Tabs>
      </main>
      <SalesTemplateChooser open={!!salesTemplateOffer} onOpenChange={open => !open && setSalesTemplateOffer(null)} pending={createSalesPage.isPending} onChoose={template => salesTemplateOffer && createSalesPage.mutate({ offer: salesTemplateOffer, template })} />
      {id && <EmailPreviewDialog webinarId={id} request={emailPreview} onClose={() => setEmailPreview(null)} />}
      <AlertDialog open={!!pendingConfirm} onOpenChange={open => { if (!open) setPendingConfirm(null); }}>
        <AlertDialogContent data-testid="dialog-confirm-delete">
          <AlertDialogHeader>
            <AlertDialogTitle>{pendingConfirm?.title}</AlertDialogTitle>
            <AlertDialogDescription>{pendingConfirm?.description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{s.btnCancel}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                const run = pendingConfirm?.run;
                setPendingConfirm(null);
                run?.();
              }}
              data-testid="button-confirm-delete"
            >
              {s.btnDeleteConfirm}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
