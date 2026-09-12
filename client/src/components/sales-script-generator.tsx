import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  AlertCircle,
  CheckCircle2,
  Clock3,
  Copy,
  Download,
  FileText,
  Loader2,
  RefreshCw,
  Save,
  Sparkles,
  WalletCards,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

const GENERATION_FEE_POINTS = 3600;
const BASIC_QUESTION_IDS = ["planName", "audience", "painPoints", "modules", "pricing"] as const;
const BASIC_QUESTION_ID_SET = new Set<string>(BASIC_QUESTION_IDS);
const STATE_ENDPOINT = (webinarId: string) =>
  `/api/webinars/${encodeURIComponent(webinarId)}/sales-script`;
const DRAFT_ENDPOINT = (webinarId: string) =>
  `${STATE_ENDPOINT(webinarId)}/draft`;
const JOBS_ENDPOINT = (webinarId: string) =>
  `${STATE_ENDPOINT(webinarId)}/jobs`;
const JOB_ENDPOINT = (webinarId: string, jobId: string) =>
  `${JOBS_ENDPOINT(webinarId)}/${encodeURIComponent(jobId)}`;

type SalesScriptAnswers = Record<string, string>;
type QuestionnaireField = {
  id: string;
  label: string;
  required?: boolean;
  help?: string;
  example?: string;
  placeholder?: string;
  multiline?: boolean;
};
type QuestionnaireGroup = {
  id: string;
  title: string;
  description?: string;
  fields: QuestionnaireField[];
};
type SalesScriptQuestionnaire = {
  fields: QuestionnaireField[];
  groups: QuestionnaireGroup[];
  requiredIds: string[];
};
type Purchase = {
  id?: string;
  purchaseId?: string;
  status?: string;
  jobId?: string | null;
  idempotencyKey?: string;
};
type Generation = {
  id?: string;
  jobId?: string;
  generationId?: string;
  idempotencyKey?: string;
  status?: string;
  state?: string;
  progress?: number;
  completedStages?: number;
  stage?: string;
  stageLabel?: string;
  output?: string | null;
  script?: string | null;
  result?: {
    language?: string;
    totalDurationMinutes?: number;
    sections?: Array<{
      sectionNumber: number;
      title: string;
      durationMinutes: number;
      slides: Array<{
        slideTitle: string;
        purpose: string;
        spokenVerbatim: string;
        interaction: string;
        durationMinutes: number;
        subdivision?: string;
      }>;
    }>;
  } | null;
  error?: string | null;
  errorMessage?: string | null;
  refunded?: boolean;
  pointsCharged?: number;
  costPoints?: number;
  attemptCount?: number;
  createdAt?: string;
  completedAt?: string | null;
};
type SalesScriptState = {
  availablePoints?: number;
  requiredPoints?: number;
  hasPurchasedAccess?: boolean;
  purchasedAccess?: boolean;
  canGenerate?: boolean;
  purchaseId?: string | null;
  purchase?: Purchase | null;
  activePurchase?: Purchase | null;
  draft?: { answers?: SalesScriptAnswers; updatedAt?: string } | null;
  jobs?: Generation[];
};
type PendingSalesScriptRequest = {
  idempotencyKey: string;
  answers: SalesScriptAnswers;
};
type PendingPurchaseRequest = {
  idempotencyKey: string;
  answers: SalesScriptAnswers;
};

class SalesScriptTimeoutError extends Error {
  idempotencyKey: string;

  constructor(idempotencyKey: string) {
    super("生成要求逾時；伺服器可能仍在處理，請先檢查執行狀態。");
    this.name = "SalesScriptTimeoutError";
    this.idempotencyKey = idempotencyKey;
  }
}

class SalesScriptPurchaseTimeoutError extends Error {
  idempotencyKey: string;

  constructor(idempotencyKey: string) {
    super("購買要求逾時；伺服器可能仍在處理，請先檢查購買狀態。");
    this.name = "SalesScriptPurchaseTimeoutError";
    this.idempotencyKey = idempotencyKey;
  }
}

function generationId(item: Generation | null | undefined) {
  return item?.id || item?.jobId || item?.generationId || "";
}

function generationStatus(item: Generation | null | undefined) {
  return String(item?.status || item?.state || "").toLowerCase();
}

function isRunning(item: Generation | null | undefined) {
  return ["queued", "pending", "running", "processing", "generating"].includes(
    generationStatus(item),
  );
}

function isComplete(item: Generation | null | undefined) {
  return ["completed", "complete", "succeeded", "success"].includes(
    generationStatus(item),
  );
}

function outputFor(item: Generation | null | undefined) {
  if (item?.output || item?.script) return item.output || item.script || "";
  const result = item?.result;
  if (!result?.sections?.length) return "";
  return [
    "# 銷售演講逐字稿",
    `\n總時長：${result.totalDurationMinutes ?? "請核對"} 分鐘`,
    ...result.sections.map((section) => [
      `\n## 【段落 ${section.sectionNumber}：${section.title}】⏱ ${section.durationMinutes} 分鐘`,
      ...section.slides.map((slide, index) => [
        `\n### 投影片 ${index + 1}：${slide.slideTitle}`,
        `**目的**：${slide.purpose}`,
        `\n---逐字腳本---\n${slide.spokenVerbatim}`,
        `\n---互動指令---\n${slide.interaction}`,
        `\n建議時間：${slide.durationMinutes} 分鐘`,
      ].join("\n")),
    ].join("\n")),
  ].join("\n");
}

function normalizeGenerations(payload: unknown): Generation[] {
  if (Array.isArray(payload)) return payload as Generation[];
  if (!payload || typeof payload !== "object") return [];
  const record = payload as { generations?: unknown; items?: unknown; data?: unknown };
  if (Array.isArray(record.generations)) return record.generations as Generation[];
  if (Array.isArray(record.items)) return record.items as Generation[];
  if (Array.isArray(record.data)) return record.data as Generation[];
  if ("id" in (payload as object)) return [payload as Generation];
  return [];
}

function createIdempotencyKey() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `sales-script-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function requestJson(url: string, init?: RequestInit) {
  const response = await fetch(url, { ...init, credentials: "include" });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${response.status}: ${body || response.statusText}`);
  }
  return response.json();
}

async function requestWithTimeout(
  url: string,
  body: unknown,
  idempotencyKey: string,
  timeoutMs = 10_000,
) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await requestJson(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (error) {
    if ((error as Error)?.name === "AbortError") {
      throw new SalesScriptTimeoutError(idempotencyKey);
    }
    throw error;
  } finally {
    window.clearTimeout(timer);
  }
}

async function requestPurchaseWithTimeout(
  url: string,
  body: unknown,
  idempotencyKey: string,
  timeoutMs = 10_000,
) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await requestJson(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (error) {
    if ((error as Error)?.name === "AbortError") {
      throw new SalesScriptPurchaseTimeoutError(idempotencyKey);
    }
    throw error;
  } finally {
    window.clearTimeout(timer);
  }
}

function pendingStorageKey(webinarId: string) {
  return `sales-script-pending-request:${webinarId}`;
}

function pendingPurchaseStorageKey(webinarId: string) {
  return `sales-script-pending-purchase:${webinarId}`;
}

function readPendingRequest(webinarId: string): PendingSalesScriptRequest | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(pendingStorageKey(webinarId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PendingSalesScriptRequest>;
    if (!parsed.idempotencyKey || !parsed.answers || typeof parsed.answers !== "object") {
      return null;
    }
    return {
      idempotencyKey: parsed.idempotencyKey,
      answers: parsed.answers as SalesScriptAnswers,
    };
  } catch {
    return null;
  }
}

function readPendingPurchase(webinarId: string): PendingPurchaseRequest | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(pendingPurchaseStorageKey(webinarId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PendingPurchaseRequest>;
    if (!parsed.idempotencyKey || !parsed.answers || typeof parsed.answers !== "object") {
      return null;
    }
    return {
      idempotencyKey: parsed.idempotencyKey,
      answers: parsed.answers as SalesScriptAnswers,
    };
  } catch {
    return null;
  }
}

const handoffPrompt =
  "請把以下銷講逐字稿整理成 PPT：逐頁給出投影片標題、重點、講者備註與互動提示；只使用稿件中的真實資料，不新增見證、數字、折扣或保證。";

const basicQuestionnaireFields: QuestionnaireField[] = [
  {
    id: "planName",
    label: "課程／方案正式名稱",
    required: true,
    help: "請填正式名稱；副標可另填。",
    example: "請輸入你的方案名稱",
  },
  {
    id: "audience",
    label: "目標受眾",
    required: true,
    help: "誰最適合參加，以及目前處於哪個階段。",
    example: "請描述最適合的參加者",
    multiline: true,
  },
  {
    id: "painPoints",
    label: "核心痛點",
    required: true,
    help: "填觀眾真實困難與代價，不要替觀眾捏造經歷。",
    example: "請描述觀眾真實遇到的困難",
    multiline: true,
  },
  {
    id: "modules",
    label: "商品包含什麼",
    required: true,
    help: "列出包含的單元、服務或交付內容。",
    example: "請列出課程單元或實際交付內容",
    multiline: true,
  },
  {
    id: "pricing",
    label: "定價策略（原價／優惠價／分期／限制）",
    required: true,
    help: "可先填摘要；細節購買後可補充。",
    example: "請填實際價格、付款方式與限制",
    multiline: true,
  },
];

function fieldFor(id: string, questionnaire?: SalesScriptQuestionnaire | null) {
  return (
    questionnaire?.fields.find((field) => field.id === id) ||
    basicQuestionnaireFields.find((field) => field.id === id)
  );
}

function basicAnswers(answers: SalesScriptAnswers): SalesScriptAnswers {
  return Object.fromEntries(
    BASIC_QUESTION_IDS.map((id) => [id, String(answers[id] || "")]),
  );
}

function questionnaireFromPayload(payload: unknown): SalesScriptQuestionnaire | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as {
    fields?: unknown;
    groups?: unknown;
    requiredIds?: unknown;
    requiredQuestionIds?: unknown;
    data?: unknown;
  };
  const source =
    record.data && typeof record.data === "object"
      ? (record.data as typeof record)
      : record;
  if (!Array.isArray(source.groups)) return null;
  const rawFields = Array.isArray(source.fields)
    ? source.fields
    : source.groups.flatMap((group) =>
        group && typeof group === "object" && Array.isArray((group as QuestionnaireGroup).fields)
          ? (group as QuestionnaireGroup).fields
          : [],
      );
  const fields = rawFields.filter(
    (field): field is QuestionnaireField =>
      !!field &&
      typeof field === "object" &&
      typeof (field as QuestionnaireField).id === "string" &&
      typeof (field as QuestionnaireField).label === "string",
  );
  const groups = source.groups
    .filter(
      (group): group is QuestionnaireGroup =>
        !!group &&
        typeof group === "object" &&
        typeof (group as QuestionnaireGroup).id === "string" &&
        typeof (group as QuestionnaireGroup).title === "string" &&
        Array.isArray((group as QuestionnaireGroup).fields),
    )
    .map((group) => ({
      ...group,
      fields: group.fields.filter((field) =>
        fields.some((validField) => validField.id === field.id),
      ),
    }))
    .filter((group) => group.fields.length > 0);
  if (!fields.length || !groups.length) return null;
  const requiredSource = Array.isArray(source.requiredIds)
    ? source.requiredIds
    : source.requiredQuestionIds;
  const requiredIds = Array.isArray(requiredSource)
    ? requiredSource.filter((id): id is string => typeof id === "string")
    : fields.filter((field) => field.required).map((field) => field.id);
  return { fields, groups, requiredIds };
}

export interface SalesScriptGeneratorProps {
  webinarId: string;
  webinarTitle?: string | null;
  webinarDescription?: string | null;
}

export function SalesScriptGenerator({
  webinarId,
  webinarTitle,
}: SalesScriptGeneratorProps) {
  const { toast } = useToast();
  const [answers, setAnswers] = useState<SalesScriptAnswers>(() =>
    basicAnswers({}),
  );
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [isPurchaseConfirmOpen, setIsPurchaseConfirmOpen] = useState(false);
  const [confirmPurchase, setConfirmPurchase] = useState(false);
  const [activeJobId, setActiveJobId] = useState("");
  const [viewedOutputId, setViewedOutputId] = useState("");
  const [timedOutKey, setTimedOutKey] = useState(
    () => readPendingRequest(webinarId)?.idempotencyKey || "",
  );
  const [pendingRequest, setPendingRequest] = useState<PendingSalesScriptRequest | null>(
    () => readPendingRequest(webinarId),
  );
  const [pendingPurchase, setPendingPurchase] = useState<PendingPurchaseRequest | null>(
    () => readPendingPurchase(webinarId),
  );
  const [lastCompleted, setLastCompleted] = useState<Generation | null>(null);
  const [isEditingOutput, setIsEditingOutput] = useState(false);
  const [editableOutput, setEditableOutput] = useState("");
  const observedPurchasedAccess = useRef(false);

  const stateQuery = useQuery<SalesScriptState>({
    queryKey: [STATE_ENDPOINT(webinarId)],
    enabled: !!webinarId,
    staleTime: 0,
    refetchInterval: pendingPurchase ? 2000 : false,
  });
  const hasPurchasedAccess =
    stateQuery.data?.hasPurchasedAccess === true ||
    stateQuery.data?.purchasedAccess === true;
  const statePurchaseId =
    stateQuery.data?.purchaseId ||
    stateQuery.data?.purchase?.id ||
    stateQuery.data?.purchase?.purchaseId ||
    stateQuery.data?.activePurchase?.id ||
    stateQuery.data?.activePurchase?.purchaseId ||
    "";
  const questionnaireQuery = useQuery<SalesScriptQuestionnaire>({
    queryKey: [`${STATE_ENDPOINT(webinarId)}/questionnaire`],
    enabled: stateQuery.isSuccess && hasPurchasedAccess,
    staleTime: 0,
    queryFn: async () => {
      const metadata = questionnaireFromPayload(
        await requestJson(`${STATE_ENDPOINT(webinarId)}/questionnaire`),
      );
      if (!metadata) throw new Error("問卷格式不完整，請重新嘗試。");
      return metadata;
    },
  });

  const history = useMemo(
    () =>
      [...(stateQuery.data?.jobs || [])].sort(
        (a, b) =>
          new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime(),
      ),
    [stateQuery.data?.jobs],
  );
  const runningFromHistory = history.find(isRunning);
  const polledJobId = activeJobId || generationId(runningFromHistory);
  const statusQuery = useQuery<Generation>({
    queryKey: [JOB_ENDPOINT(webinarId, polledJobId)],
    enabled: !!polledJobId,
    staleTime: 0,
    refetchInterval: polledJobId ? 2000 : false,
    refetchIntervalInBackground: true,
  });
  const activeGeneration =
    statusQuery.data ||
    (activeJobId
      ? history.find((item) => generationId(item) === activeJobId)
      : null);
  const viewedQuery = useQuery<Generation>({
    queryKey: [JOB_ENDPOINT(webinarId, viewedOutputId)],
    enabled: !!viewedOutputId && viewedOutputId !== polledJobId,
    staleTime: 0,
    refetchInterval: false,
  });
  const selectedGeneration =
    viewedQuery.data ||
    (viewedOutputId
      ? history.find((item) => generationId(item) === viewedOutputId)
      : null);
  const effectiveGeneration = activeGeneration || lastCompleted;
  const displayGeneration = selectedGeneration || lastCompleted;
  const basicMissing = BASIC_QUESTION_IDS.filter(
    (id) => !String(answers[id] || "").trim(),
  );
  const questionnaire = questionnaireQuery.data;
  const missingRequired = questionnaire?.requiredIds.filter(
    (id) => !String(answers[id] || "").trim(),
  ) || [];
  const hasActiveGeneration = Boolean(
    isRunning(activeGeneration) || history.some(isRunning),
  );
  const hasUnusedPurchaseAccess = Boolean(
    hasPurchasedAccess &&
      stateQuery.data?.canGenerate === true &&
      statePurchaseId &&
      !hasActiveGeneration,
  );
  const questionnaireReady =
    questionnaireQuery.isSuccess &&
    Boolean(questionnaire?.fields.length && questionnaire?.groups.length);
  const points = Number(stateQuery.data?.availablePoints ?? 0);
  const canGenerate =
    hasUnusedPurchaseAccess &&
    questionnaireReady &&
    missingRequired.length === 0 &&
    !isRunning(activeGeneration) &&
    !activeJobId &&
    !pendingRequest;
  const status = generationStatus(effectiveGeneration);
  const statusProgress = Math.max(
    0,
    Math.min(
      100,
      Number(
        effectiveGeneration?.progress ??
          ((effectiveGeneration?.completedStages ?? 0) / 6) * 100,
      ),
    ),
  );

  const rememberPending = (request: PendingSalesScriptRequest | null) => {
    setPendingRequest(request);
    if (typeof window === "undefined") return;
    try {
      if (request) {
        window.sessionStorage.setItem(
          pendingStorageKey(webinarId),
          JSON.stringify(request),
        );
      } else {
        window.sessionStorage.removeItem(pendingStorageKey(webinarId));
      }
    } catch {
      // A storage policy can reject sessionStorage; in-memory state still
      // blocks a second request for the lifetime of this mounted component.
    }
  };

  const rememberPendingPurchase = (request: PendingPurchaseRequest | null) => {
    setPendingPurchase(request);
    if (typeof window === "undefined") return;
    try {
      if (request) {
        window.localStorage.setItem(
          pendingPurchaseStorageKey(webinarId),
          JSON.stringify(request),
        );
      } else {
        window.localStorage.removeItem(pendingPurchaseStorageKey(webinarId));
      }
    } catch {
      // A storage policy can reject localStorage; the mounted state still
      // prevents a second purchase request.
    }
  };

  useEffect(() => {
    const restored = readPendingRequest(webinarId);
    setPendingRequest(restored);
    setTimedOutKey(restored?.idempotencyKey || "");
    setPendingPurchase(readPendingPurchase(webinarId));
    observedPurchasedAccess.current = false;
  }, [webinarId]);

  useEffect(() => {
    if (!stateQuery.isSuccess) return;
    const saved = stateQuery.data?.draft?.answers || {};
    setAnswers((current) => {
      const merged = { ...current };
      const pendingAnswers = pendingRequest?.answers || {};
      // A timed-out generation body is immutable and must be restored exactly.
      Object.assign(merged, pendingAnswers);
      for (const [id, value] of Object.entries(saved)) {
        // Never overwrite text entered in the current form. After purchase
        // this also hydrates server-saved private fields on the second state
        // response without disturbing typed basic answers.
        if (!String(merged[id] || "").trim() && String(value || "").trim()) {
          merged[id] = value;
        }
      }
      // These values come from the already-saved webinar, never from an
      // example. Existing non-empty draft answers always win.
      if (!String(merged.planName || "").trim() && webinarTitle?.trim()) {
        merged.planName = webinarTitle.trim();
      }
      return merged;
    });
  }, [
    hasPurchasedAccess,
    pendingRequest,
    stateQuery.data,
    stateQuery.isSuccess,
    webinarTitle,
  ]);

  useEffect(() => {
    if (!stateQuery.isSuccess) return;
    if (hasUnusedPurchaseAccess || hasActiveGeneration) {
      observedPurchasedAccess.current = true;
      if (pendingPurchase) rememberPendingPurchase(null);
      if (step === 1 || pendingPurchase) setStep(3);
      return;
    }
    if (
      (observedPurchasedAccess.current || hasPurchasedAccess) &&
      step === 3 &&
      !hasActiveGeneration
    ) {
      // A failed/refunded or already-consumed purchase is no longer an unlock.
      // Completed history remains available below.
      setStep(2);
    }
  }, [
    activeGeneration,
    hasActiveGeneration,
    hasUnusedPurchaseAccess,
    hasPurchasedAccess,
    pendingPurchase,
    stateQuery.isSuccess,
    step,
  ]);

  useEffect(() => {
    if (lastCompleted || !history.length) return;
    const latestRunning = history.find(isRunning);
    if (latestRunning) {
      const id = generationId(latestRunning);
      if (id && activeJobId !== id) setActiveJobId(id);
      return;
    }
    if (activeJobId || viewedOutputId) return;
    const latestCompleted = history.find(isComplete);
    if (latestCompleted) {
      setActiveJobId(generationId(latestCompleted));
    }
  }, [activeJobId, history, lastCompleted, viewedOutputId]);

  useEffect(() => {
    if (!pendingRequest || !history.length) return;
    // Summaries intentionally do not expose idempotency keys. Adopt the
    // owner's running job rather than blindly creating a second charge.
    const matching =
      history.find(isRunning) ||
      history.find((item) => item.idempotencyKey === pendingRequest.idempotencyKey);
    if (matching && generationId(matching)) {
      setActiveJobId(generationId(matching));
    }
  }, [history, pendingRequest]);

  useEffect(() => {
    if (!statusQuery.data) return;
    if (isComplete(statusQuery.data)) {
      setLastCompleted(statusQuery.data);
      setActiveJobId("");
      setTimedOutKey("");
      if (pendingRequest) rememberPending(null);
      queryClient.invalidateQueries({ queryKey: [STATE_ENDPOINT(webinarId)] });
      queryClient.invalidateQueries({ queryKey: ["/api/ai-points"] });
      return;
    }
    if (["failed", "error", "refunded"].includes(generationStatus(statusQuery.data))) {
      setLastCompleted(statusQuery.data);
      setActiveJobId("");
      setTimedOutKey("");
      if (pendingRequest) rememberPending(null);
      queryClient.invalidateQueries({ queryKey: [STATE_ENDPOINT(webinarId)] });
      queryClient.invalidateQueries({ queryKey: ["/api/ai-points"] });
    }
  }, [pendingRequest, statusQuery.data, webinarId]);

  const saveDraft = useMutation({
    mutationFn: async (nextAnswers: SalesScriptAnswers) => {
      return apiRequest("PUT", DRAFT_ENDPOINT(webinarId), {
        answers: nextAnswers,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [STATE_ENDPOINT(webinarId)] });
      toast({ title: "銷售演講草稿已儲存" });
    },
    onError: (error: Error) => {
      toast({
        title: "草稿儲存失敗",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const generate = useMutation({
    mutationFn: async (request: PendingSalesScriptRequest) =>
      requestWithTimeout(
        JOBS_ENDPOINT(webinarId),
        {
          purchaseId: statePurchaseId,
          answers: request.answers,
          idempotencyKey: request.idempotencyKey,
        },
        request.idempotencyKey,
      ),
    onSuccess: (payload: Generation) => {
      setTimedOutKey("");
      rememberPending(null);
      const jobId = generationId(payload);
      if (jobId) setActiveJobId(jobId);
      queryClient.invalidateQueries({ queryKey: [STATE_ENDPOINT(webinarId)] });
      queryClient.invalidateQueries({ queryKey: ["/api/ai-points"] });
      toast({
        title: "已開始生成銷售演講",
        description: "可留在此頁查看進度；重新載入後也會繼續顯示執行中的工作。",
      });
    },
    onError: (error: Error, request: PendingSalesScriptRequest) => {
      const unresolved =
        error instanceof SalesScriptTimeoutError || error.name === "TypeError";
      if (unresolved) {
        // Keep both values immutable until the server reports a matching
        // terminal job. A retry must never create a fresh charge.
        setAnswers(request.answers);
        setTimedOutKey(request.idempotencyKey);
        rememberPending(request);
        queryClient.invalidateQueries({ queryKey: [STATE_ENDPOINT(webinarId)] });
        toast({
          title: "生成要求逾時",
          description: "已保留本次辨識碼並重新查詢執行狀態，請不要再次付款重送。",
          variant: "destructive",
        });
        return;
      }
      rememberPending(null);
      setTimedOutKey("");
      toast({
        title: "生成失敗",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const purchase = useMutation({
    mutationFn: async (request: PendingPurchaseRequest) =>
      requestPurchaseWithTimeout(
        `${STATE_ENDPOINT(webinarId)}/purchase`,
        {
          answers: basicAnswers(request.answers),
          ackCost: GENERATION_FEE_POINTS,
          idempotencyKey: request.idempotencyKey,
        },
        request.idempotencyKey,
      ),
    onSuccess: async (payload: {
      purchase?: Purchase;
      hasPurchasedAccess?: boolean;
      canGenerate?: boolean;
    }) => {
      const refreshed = await stateQuery.refetch();
      const accessConfirmed =
        refreshed.data?.hasPurchasedAccess === true ||
        refreshed.data?.purchasedAccess === true;
      if (!accessConfirmed) {
        toast({
          title: "購買仍在確認中",
          description: "已保留本次購買辨識碼，確認完成前不會再次扣點。",
        });
        return;
      }
      rememberPendingPurchase(null);
      setIsPurchaseConfirmOpen(false);
      setConfirmPurchase(false);
      setStep(3);
      queryClient.invalidateQueries({
        queryKey: [`${STATE_ENDPOINT(webinarId)}/questionnaire`],
      });
      toast({
        title: "已確認購買",
        description: "專屬問卷已解鎖；填寫並儲存後即可使用這次生成。",
      });
    },
    onError: (error: Error, request: PendingPurchaseRequest) => {
      const unresolved =
        error instanceof SalesScriptPurchaseTimeoutError ||
        error.name === "TypeError";
      if (unresolved) {
        if (
          stateQuery.data?.hasPurchasedAccess === true ||
          stateQuery.data?.purchasedAccess === true
        ) {
          rememberPendingPurchase(null);
        } else {
          rememberPendingPurchase(request);
        }
        setIsPurchaseConfirmOpen(false);
        setConfirmPurchase(false);
        void stateQuery.refetch();
        toast({
          title: "購買要求逾時",
          description: "已保留本次購買辨識碼，請先重新檢查狀態，不會再次扣點。",
          variant: "destructive",
        });
        return;
      }
      rememberPendingPurchase(null);
      setIsPurchaseConfirmOpen(false);
      setConfirmPurchase(false);
      toast({
        title: "購買失敗",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const updateAnswer = (
    id: string,
    value: string,
  ) => {
    setAnswers((current) => ({ ...current, [id]: value }));
  };

  const transition = async (next: 1 | 2 | 3) => {
    try {
      await saveDraft.mutateAsync(basicAnswers(answers));
      setStep(next);
    } catch {
      // The save mutation displays the error; do not advance on failure.
    }
  };

  const askGenerate = () => {
    if (!canGenerate) return;
    setViewedOutputId("");
    setLastCompleted(null);
    const request: PendingSalesScriptRequest = {
      idempotencyKey: createIdempotencyKey(),
      answers: { ...answers },
    };
    void saveDraft
      .mutateAsync(answers)
      .then(() => {
        // A draft failure means no job POST was attempted, so do not leave a
        // phantom pending request that would block the next valid attempt.
        rememberPending(request);
        return generate.mutateAsync(request);
      })
      .catch(() => {
        // Mutations already surface an actionable error and preserve the body.
      });
  };

  const askPurchase = async () => {
    if (
      hasUnusedPurchaseAccess ||
      hasActiveGeneration ||
      pendingPurchase ||
      basicMissing.length
    ) return;
    try {
      await saveDraft.mutateAsync(basicAnswers(answers));
      setConfirmPurchase(false);
      setIsPurchaseConfirmOpen(true);
    } catch {
      // The save mutation displays the error; do not open payment confirmation.
    }
  };

  const confirmPurchaseRequest = async () => {
    if (!confirmPurchase || pendingPurchase || basicMissing.length) return;
    const request: PendingPurchaseRequest = {
        idempotencyKey: createIdempotencyKey(),
        answers: basicAnswers(answers),
    };
    // Persist before POST so reload/network timeout can reconcile this exact
    // purchase rather than creating another debit.
    rememberPendingPurchase(request);
    try {
      await purchase.mutateAsync(request);
    } catch {
      // The mutation displays a retryable error and keeps its immutable request.
    }
  };

  const retryPendingPurchase = () => {
    if (!pendingPurchase || purchase.isPending) return;
    void purchase.mutateAsync(pendingPurchase).catch(() => {
      // The mutation displays a retryable error.
    });
  };

  const retryPendingGeneration = () => {
    if (!pendingRequest || generate.isPending) return;
    void generate.mutateAsync(pendingRequest).catch(() => {
      // The mutation displays a retryable error.
    });
  };

  const copyText = async (text: string, title = "已複製到剪貼簿") => {
    try {
      await navigator.clipboard.writeText(text);
      toast({ title });
    } catch {
      toast({
        title: "複製失敗",
        description: "瀏覽器拒絕剪貼簿存取，請選取文字後手動複製。",
        variant: "destructive",
      });
    }
  };

  const download = (extension: "md" | "txt") => {
    const output = isEditingOutput
      ? editableOutput
      : outputFor(displayGeneration);
    if (!output) return;
    const blob = new Blob([output], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `sales-script-${webinarId}.${extension}`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const setOutputForEditing = () => {
    setEditableOutput(outputFor(displayGeneration));
    setIsEditingOutput(true);
  };

  const isFailure = ["failed", "error", "refunded"].includes(status);
  const failureText =
    effectiveGeneration?.errorMessage ||
    effectiveGeneration?.error ||
    "伺服器生成失敗。";
  const genericGroups = useMemo(
    () =>
      (questionnaire?.groups || [])
        .map((group) => ({
          ...group,
          fields: group.fields.filter((field) => !BASIC_QUESTION_ID_SET.has(field.id)),
        }))
        .filter((group) => group.fields.length > 0),
    [questionnaire],
  );

  return (
    <div className="space-y-5" data-testid="sales-script-generator">
      <Card className="overflow-hidden border-[#75d6ca]/60 bg-gradient-to-br from-[#e7f7f4] via-card to-[#edf5fa]">
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <Badge className="mb-3 bg-[#123d59] text-[#dff8f7]">
                文字輸出 · 銷講內容
              </Badge>
              <CardTitle className="text-2xl text-[#123d59]">
                把你的商品資訊，變成一份可直接練習的銷售演講稿
              </CardTitle>
              <CardDescription className="mt-2 max-w-2xl">
                交付文字稿與簡報建議，非PPT檔；請自行審閱內容，不保證銷售成果。
              </CardDescription>
              <p className="mt-3 text-sm font-semibold text-[#0b8b86]">
                確認購買即扣除3600AI點數，解鎖專屬問卷及一次生成
              </p>
            </div>
            <FileText className="h-9 w-9 text-[#0b8b86]" />
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-4">
            {["投影片內容建議", "可直接練習的逐字稿", "互動與時間安排", "可讀文字匯出"].map(
              (item) => (
                <div
                  key={item}
                  className="rounded-md border border-[#b9dfda] bg-background/70 px-3 py-2 text-xs font-semibold text-[#123d59]"
                >
                  <CheckCircle2 className="mr-1 inline h-3.5 w-3.5 text-[#0b8b86]" />
                  {item}
                </div>
              ),
            )}
          </div>
        </CardHeader>
      </Card>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <Card data-testid="sales-script-form-card">
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle className="text-lg">建立內容資料</CardTitle>
                <CardDescription>
                  步驟 {step} / 3。草稿可隨時儲存，返回不會清除內容。
                </CardDescription>
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  saveDraft.mutate(hasPurchasedAccess ? answers : basicAnswers(answers))
                }
                disabled={saveDraft.isPending}
                data-testid="button-save-sales-script-draft"
              >
                {saveDraft.isPending ? (
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                ) : (
                  <Save className="mr-1.5 h-4 w-4" />
                )}
                儲存草稿
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="mb-6 flex gap-2">
              {["基本資料", "內容確認", "補充資料"].map((label, index) => (
                <div
                  key={label}
                  className={`flex-1 border-t-2 pt-2 text-xs font-bold ${
                    step >= index + 1
                      ? "border-[#0b8b86] text-[#123d59]"
                      : "border-muted text-muted-foreground"
                  }`}
                >
                  {index + 1}. {label}
                </div>
              ))}
            </div>

            {step === 1 ? (
              <div data-testid="sales-script-step-basics" className="space-y-5">
                {BASIC_QUESTION_IDS.map((id) => {
                  const field = fieldFor(id)!;
                  return (
                    <Question
                      key={id}
                      field={field}
                      value={answers[id] || ""}
                      onChange={updateAnswer}
                    />
                  );
                })}
                <div className="flex justify-end">
                  <Button
                    type="button"
                    onClick={() => {
                      if (basicMissing.length) {
                        toast({
                          title: "請完成五項基本資料",
                          description: basicMissing
                            .map((id) => fieldFor(id)?.label || id)
                            .join("、"),
                          variant: "destructive",
                        });
                        return;
                      }
                      void transition(2);
                    }}
                    data-testid="button-sales-script-to-summary"
                  >
                    查看內容確認
                  </Button>
                </div>
              </div>
            ) : null}

            {step === 2 ? (
              <div data-testid="sales-script-step-summary" className="space-y-5">
                <div className="rounded-xl border border-[#b9dfda] bg-[#f2fbf9] p-5">
                  <p className="text-xs font-bold tracking-widest text-[#0b8b86]">
                    你的內容摘要
                  </p>
                  <h3 className="mt-2 text-xl font-bold text-[#123d59]">
                    {answers.planName}
                  </h3>
                  <dl className="mt-4 space-y-3">
                    {BASIC_QUESTION_IDS.slice(1).map((id) => (
                      <div key={id}>
                        <dt className="text-xs font-bold text-muted-foreground">
                          {fieldFor(id)?.label}
                        </dt>
                        <dd className="mt-1 whitespace-pre-wrap text-sm leading-6">
                          {answers[id]}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </div>
                <div className="rounded-lg border border-[#0b8b86]/30 bg-[#f7fcfb] p-4">
                  <p className="font-semibold text-[#123d59]">你會收到什麼</p>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                    <li>可直接練習的完整銷售演講文字稿</li>
                    <li>逐頁簡報內容建議、目的與講者說明</li>
                    <li>每頁互動提示與建議時間安排</li>
                    <li>可複製並下載的文字版本</li>
                  </ul>
                </div>
                <div className="rounded-lg border border-[#123d59]/20 p-4">
                  <p className="font-semibold text-[#123d59]">
                    確認購買專屬銷講稿
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    確認購買即扣除3600AI點數，解鎖專屬問卷及一次生成。基本資料會先儲存，
                    後續填寫、儲存、重新載入及生成不會再次扣點。
                  </p>
                </div>
                <div className="flex flex-wrap justify-between gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setStep(1)}
                    data-testid="button-sales-script-back-basics"
                  >
                    返回修改
                  </Button>
                  <Button
                    type="button"
                    onClick={() => {
                      if (hasUnusedPurchaseAccess || hasActiveGeneration) {
                        setStep(3);
                      } else {
                        void askPurchase();
                      }
                    }}
                    disabled={
                      saveDraft.isPending ||
                      purchase.isPending ||
                      Boolean(pendingPurchase) ||
                      hasActiveGeneration ||
                      (!hasUnusedPurchaseAccess &&
                        !hasActiveGeneration &&
                        basicMissing.length > 0)
                    }
                    data-testid="button-sales-script-buy-intent"
                  >
                    {hasUnusedPurchaseAccess || hasActiveGeneration
                      ? "繼續填寫已解鎖問卷"
                      : pendingPurchase
                        ? "購買確認中"
                        : hasPurchasedAccess
                          ? "再次購買並解鎖（3,600 點）"
                          : "確認購買並解鎖（3,600 點）"}
                  </Button>
                </div>
                {pendingPurchase ? (
                  <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                    <p>
                      購買要求仍在確認中，已保留辨識碼；不會建立新的購買或扣點。
                    </p>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="mt-2"
                      onClick={retryPendingPurchase}
                      disabled={purchase.isPending}
                      data-testid="button-retry-sales-script-purchase"
                    >
                      {purchase.isPending ? (
                        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                      ) : null}
                      使用原辨識碼重試
                    </Button>
                  </div>
                ) : null}
              </div>
            ) : null}

            {step === 3 ? (
              <div data-testid="sales-script-step-details" className="space-y-5">
                {!hasPurchasedAccess ? (
                  <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
                    這次專屬問卷的使用權已結束，請返回內容確認重新購買後再填寫。
                  </div>
                ) : questionnaireQuery.isPending ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    正在載入已購買的專屬問卷…
                  </div>
                ) : questionnaireQuery.isError || !questionnaireReady ? (
                  <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
                    <p className="text-destructive">
                      無法載入專屬問卷，未顯示進階欄位，也無法生成。
                    </p>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="mt-3"
                      onClick={() => void questionnaireQuery.refetch()}
                      data-testid="button-retry-sales-script-questionnaire"
                    >
                      <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                      重新載入問卷
                    </Button>
                  </div>
                ) : (
                  <>
                    <p className="text-sm text-muted-foreground">
                      請補充真實事實資料。必填欄位以星號標示；填寫、儲存、重新載入及生成不會再次扣點。
                    </p>
                    {genericGroups.map((group) => (
                      <details key={group.id} open className="rounded-lg border p-4">
                        <summary className="cursor-pointer font-semibold text-[#123d59]">
                          {group.title}
                          <span className="ml-2 text-xs font-normal text-muted-foreground">
                            選填補充
                          </span>
                        </summary>
                        <div className="mt-5 grid gap-5">
                          {group.fields.map((field) => (
                            <Question
                              key={field.id}
                              field={field}
                              value={answers[field.id] || ""}
                              onChange={updateAnswer}
                            />
                          ))}
                        </div>
                      </details>
                    ))}
                  </>
                )}
                <div className="flex flex-wrap justify-between gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setStep(2)}
                    data-testid="button-sales-script-back-summary"
                  >
                    返回摘要
                  </Button>
                  <Button
                    type="button"
                    onClick={() => {
                      if (missingRequired.length) {
                        toast({
                          title: "請完成生成所需資料",
                          description: missingRequired
                            .map((id) => questionnaire?.fields.find((field) => field.id === id)?.label)
                            .filter((label): label is string => Boolean(label))
                            .join("、"),
                          variant: "destructive",
                        });
                        return;
                      }
                      askGenerate();
                    }}
                    disabled={
                      !canGenerate ||
                      generate.isPending ||
                      saveDraft.isPending
                    }
                    data-testid="button-generate-sales-script"
                  >
                    {generate.isPending ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Sparkles className="mr-2 h-4 w-4" />
                    )}
                    生成專屬銷講稿
                  </Button>
                </div>
                {missingRequired.length > 0 ? (
                  <p className="text-xs text-muted-foreground">
                    尚缺必填：
                    {missingRequired
                      .map((id) => questionnaire?.fields.find((field) => field.id === id)?.label)
                      .filter((label): label is string => Boolean(label))
                      .join("、")}
                  </p>
                ) : null}
              </div>
            ) : null}
          </CardContent>
        </Card>

        <aside className="space-y-5">
          <Card className="border-[#e6bc5d] bg-[#fff9e9]">
            <CardHeader className="pb-3">
              <CardTitle className="flex gap-2 text-base text-[#123d59]">
                <WalletCards className="h-5 w-5 text-[#aa7213]" />
                價格與點數
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p
                className="text-3xl font-bold text-[#aa7213]"
                data-testid="sales-script-final-fee"
              >
                3,600 點
              </p>
              <p className="text-xs text-muted-foreground">
                確認購買即扣除3600AI點數，解鎖專屬問卷及一次生成。生成失敗時，
                未使用的專屬使用權會由伺服器退款並重新鎖定。
              </p>
              <div className="flex justify-between border-t pt-3 text-sm">
                <span>可用點數</span>
                <b data-testid="text-sales-script-points">
                  {stateQuery.isLoading ? "—" : points.toLocaleString()}
                </b>
              </div>
              {hasPurchasedAccess ? (
                <p className="text-xs font-medium text-[#0b8b86]">
                  已確認購買：本次問卷與一次生成已解鎖。
                </p>
              ) : pendingPurchase ? (
                <p className="text-xs text-amber-700">
                  購買確認中；重新載入也會沿用原辨識碼，不會再次扣點。
                </p>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">工作狀態</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {effectiveGeneration && isRunning(effectiveGeneration) ? (
                <div className="space-y-3" data-testid="sales-script-running">
                  <div className="flex gap-2 text-sm font-semibold">
                    <Loader2 className="h-4 w-4 animate-spin text-primary" />
                    {effectiveGeneration.stageLabel ||
                      effectiveGeneration.stage ||
                      "伺服器處理中"}
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full bg-[#0b8b86] transition-[width]"
                      style={{ width: `${statusProgress}%` }}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {statusProgress > 0 ? `${statusProgress}% · ` : ""}
                    工作編號 {generationId(effectiveGeneration) || "等待伺服器回傳"}
                  </p>
                </div>
              ) : null}
              {timedOutKey ? (
                <div
                  className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"
                  data-testid="sales-script-timeout"
                >
                  <p className="font-medium">要求仍可能在伺服器執行</p>
                  <p className="mt-1 text-xs">
                    已保留辨識碼 {timedOutKey}，系統會先檢查執行中工作，不會盲目重新收費。
                  </p>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="mt-2"
                    onClick={() => stateQuery.refetch()}
                    data-testid="button-check-sales-script-status"
                  >
                    <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                    重新檢查
                  </Button>
                   <Button
                     type="button"
                     size="sm"
                     variant="outline"
                     className="ml-2 mt-2"
                     onClick={retryPendingGeneration}
                     disabled={generate.isPending || !pendingRequest}
                     data-testid="button-retry-sales-script-generation"
                   >
                     {generate.isPending ? (
                       <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                     ) : null}
                     使用原辨識碼重試
                   </Button>
                </div>
              ) : null}
              {isFailure ? (
                <div
                  className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"
                  data-testid="sales-script-failed"
                >
                  <p className="flex items-center gap-2 font-medium">
                    <AlertCircle className="h-4 w-4" />
                    生成失敗
                  </p>
                  <p className="mt-1 text-xs">{failureText}</p>
                  <p className="mt-2 text-xs font-medium">
                    本次 3,600 點已退款，沒有產生成功稿件。
                  </p>
                </div>
              ) : null}
              {!effectiveGeneration && !selectedGeneration && !timedOutKey ? (
                <p className="text-sm text-muted-foreground">
                  尚未生成。先完成基本資料並確認購買，再填寫專屬問卷。
                </p>
              ) : null}
            </CardContent>
          </Card>
        </aside>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex gap-2 text-lg">
            <Clock3 className="h-5 w-5" />
            歷史版本
          </CardTitle>
          <CardDescription>
            已完成且已扣款成功的版本可隨時開啟、複製或下載。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {history.length === 0 ? (
            <p className="text-sm text-muted-foreground">尚無歷史版本。</p>
          ) : (
            history.map((item) => {
              const itemId = generationId(item);
              const completed = isComplete(item);
              const failed = ["failed", "error", "refunded"].includes(
                generationStatus(item),
              );
              return (
                <div
                  key={itemId || item.createdAt}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"
                  data-testid={`sales-script-history-${itemId}`}
                >
                  <div>
                    <b className="text-sm">
                      {completed
                        ? "已完成"
                        : failed
                          ? "失敗（已退款）"
                          : isRunning(item)
                            ? "生成中"
                            : "尚未完成"}
                    </b>
                    <p className="text-xs text-muted-foreground">
                      {item.createdAt
                        ? new Date(item.createdAt).toLocaleString("zh-TW")
                        : "時間未提供"}
                      {item.pointsCharged || item.costPoints
                        ? ` · ${(item.pointsCharged || item.costPoints)?.toLocaleString()} 點`
                        : ""}
                    </p>
                  </div>
                  {completed ? (
                    <Button
                      type="button"
                      size="sm"
                      variant={viewedOutputId === itemId ? "default" : "outline"}
                      onClick={() => {
                        setLastCompleted(null);
                        setViewedOutputId(itemId);
                        setEditableOutput("");
                        setIsEditingOutput(false);
                      }}
                      data-testid={`button-view-sales-script-${itemId}`}
                    >
                      查看版本
                    </Button>
                  ) : null}
                </div>
              );
            })
          )}
        </CardContent>
      </Card>

      {displayGeneration &&
      isComplete(displayGeneration) &&
      outputFor(displayGeneration) ? (
        <Card data-testid="sales-script-output">
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle className="text-lg">已完成的銷講演講稿</CardTitle>
                <CardDescription>
                  這是唯讀生成版本。編輯副本只存在目前瀏覽器記憶體，不會寫回伺服器。
                </CardDescription>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    copyText(
                      isEditingOutput
                        ? editableOutput
                        : outputFor(displayGeneration),
                    )
                  }
                  data-testid="button-copy-sales-script"
                >
                  <Copy className="mr-1 h-4 w-4" />
                  複製
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => download("md")}
                  data-testid="button-download-sales-script-md"
                >
                  <Download className="mr-1 h-4 w-4" />
                  .md
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => download("txt")}
                  data-testid="button-download-sales-script-txt"
                >
                  <Download className="mr-1 h-4 w-4" />
                  .txt
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={setOutputForEditing}
                >
                  編輯副本
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {isEditingOutput ? (
              <Textarea
                value={editableOutput}
                onChange={(event) => setEditableOutput(event.target.value)}
                rows={22}
                className="font-mono text-sm leading-6"
                data-testid="textarea-sales-script-local-copy"
              />
            ) : (
              <pre
                className="max-h-[42rem] overflow-auto whitespace-pre-wrap break-words rounded-lg border bg-muted/20 p-4 text-sm leading-6"
                data-testid="text-sales-script-output"
              >
                {outputFor(displayGeneration)}
              </pre>
            )}
            <div className="rounded-lg border border-primary/30 bg-primary/5 p-4">
              <b className="text-sm">交給其他 AI 排版</b>
              <p className="mt-1 text-sm text-muted-foreground">
                可把真實稿件整理成投影片；請保留原稿結構，勿新增見證、數字、折扣或保證。
              </p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="mt-3"
                onClick={() =>
                  copyText(
                    `${handoffPrompt}\n\n${
                      isEditingOutput
                        ? editableOutput
                        : outputFor(displayGeneration)
                    }`,
                    "已複製交接提示詞與稿件",
                  )
                }
                data-testid="button-copy-sales-script-handoff"
              >
                <Copy className="mr-1 h-4 w-4" />
                複製交接提示詞與稿件
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <AlertDialog
        open={isPurchaseConfirmOpen}
        onOpenChange={setIsPurchaseConfirmOpen}
      >
        <AlertDialogContent data-testid="sales-script-fee-modal">
          <AlertDialogHeader>
            <AlertDialogTitle>確認購買專屬銷講稿</AlertDialogTitle>
            <AlertDialogDescription>
              確認購買即扣除 <strong>3,600 AI 點數</strong>，解鎖專屬問卷及一次生成。
              這次購買只會送出一次；若伺服器未確認，重新載入也不會再次扣點。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <label className="flex gap-3 rounded-lg border p-3 text-sm">
            <Checkbox
              checked={confirmPurchase}
              onCheckedChange={(checked) => setConfirmPurchase(checked === true)}
              data-testid="checkbox-confirm-sales-script-fee"
            />
            <span>我確認現在購買並收取 3,600 點，解鎖問卷及一次生成。</span>
          </label>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={
                !confirmPurchase ||
                purchase.isPending ||
                saveDraft.isPending
              }
              onClick={(event) => {
                event.preventDefault();
                void confirmPurchaseRequest();
              }}
              data-testid="button-confirm-sales-script-fee"
            >
              {purchase.isPending || saveDraft.isPending ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : null}
              確認購買並扣除 3,600 點
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Question({
  field,
  value,
  onChange,
}: {
  field: QuestionnaireField;
  value: string;
  onChange: (id: string, value: string) => void;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={`sales-script-${field.id}`}>
        {field.label}
        {field.required ? (
          <span className="ml-1 text-destructive">*</span>
        ) : null}
      </Label>
      {field.help ? (
        <p className="text-xs text-muted-foreground">{field.help}</p>
      ) : null}
      {field.multiline ? (
        <Textarea
          id={`sales-script-${field.id}`}
          value={value}
          onChange={(event) => onChange(field.id, event.target.value)}
          placeholder={field.example || field.placeholder}
          rows={4}
          data-testid={`input-sales-script-${field.id}`}
        />
      ) : (
        <Input
          id={`sales-script-${field.id}`}
          value={value}
          onChange={(event) => onChange(field.id, event.target.value)}
          placeholder={field.example || field.placeholder}
          data-testid={`input-sales-script-${field.id}`}
        />
      )}
    </div>
  );
}