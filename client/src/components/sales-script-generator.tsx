import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
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
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
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
import {
  createEmptySalesScriptQuestionnaire,
  missingSalesScriptQuestionIds,
  salesScriptQuestionnaireFields,
  SALES_SCRIPT_QUESTIONNAIRE_GROUPS,
  type SalesScriptQuestionnaireAnswers,
} from "@shared/salesScriptQuestionnaire";

const GENERATION_FEE_POINTS = 3600;
const STATE_ENDPOINT = (webinarId: string) =>
  `/api/webinars/${encodeURIComponent(webinarId)}/sales-script`;
const DRAFT_ENDPOINT = (webinarId: string) =>
  `${STATE_ENDPOINT(webinarId)}/draft`;
const JOBS_ENDPOINT = (webinarId: string) =>
  `${STATE_ENDPOINT(webinarId)}/jobs`;
const JOB_ENDPOINT = (webinarId: string, jobId: string) =>
  `${JOBS_ENDPOINT(webinarId)}/${encodeURIComponent(jobId)}`;

type Balance = { points?: number; unlimited?: boolean };
type DraftPayload = {
  answers?: SalesScriptQuestionnaireAnswers;
  questionnaire?: SalesScriptQuestionnaireAnswers;
  data?: SalesScriptQuestionnaireAnswers;
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
  draft?: { answers?: SalesScriptQuestionnaireAnswers; updatedAt?: string } | null;
  jobs?: Generation[];
};

class SalesScriptTimeoutError extends Error {
  idempotencyKey: string;

  constructor(idempotencyKey: string) {
    super("生成要求逾時；伺服器可能仍在處理，請先檢查執行狀態。");
    this.name = "SalesScriptTimeoutError";
    this.idempotencyKey = idempotencyKey;
  }
}

function extractAnswers(payload: DraftPayload | SalesScriptQuestionnaireAnswers | null | undefined) {
  if (!payload || typeof payload !== "object") return {};
  if ("answers" in payload && payload.answers) return payload.answers;
  if ("questionnaire" in payload && payload.questionnaire) return payload.questionnaire;
  if ("data" in payload && payload.data) return payload.data;
  return payload as SalesScriptQuestionnaireAnswers;
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
    `# 銷售演講逐字稿`,
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

const handoffPrompt =
  "請把以下銷講逐字稿整理成 PPT：保留六段式架構，逐頁給出投影片標題、重點、講者備註與互動提示；只使用稿件中的真實資料，不新增見證、數字、折扣或保證。";

export interface SalesScriptGeneratorProps {
  webinarId: string;
  webinarTitle?: string | null;
  webinarDescription?: string | null;
}

export function SalesScriptGenerator({
  webinarId,
  webinarTitle,
  webinarDescription,
}: SalesScriptGeneratorProps) {
  const { toast } = useToast();
  const [answers, setAnswers] = useState<SalesScriptQuestionnaireAnswers>(
    createEmptySalesScriptQuestionnaire,
  );
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [confirmCharge, setConfirmCharge] = useState(false);
  const [activeJobId, setActiveJobId] = useState("");
  const [viewedOutputId, setViewedOutputId] = useState("");
  const [timedOutKey, setTimedOutKey] = useState("");
  const [lastCompleted, setLastCompleted] = useState<Generation | null>(null);
  const [isEditingOutput, setIsEditingOutput] = useState(false);
  const [editableOutput, setEditableOutput] = useState("");
  const hydratedFor = useRef("");

  const stateQuery = useQuery<SalesScriptState>({
    queryKey: [STATE_ENDPOINT(webinarId)],
    enabled: !!webinarId,
    staleTime: 0,
  });
  const balanceQuery = useQuery<Balance>({
    queryKey: ["/api/ai-points"],
    staleTime: 0,
  });
  const trialQuery = useQuery<{ state?: string; remainingAI?: number }>({
    queryKey: ["/api/trial"],
    staleTime: 0,
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
  const activeGeneration = statusQuery.data || (activeJobId ? history.find((item) => generationId(item) === activeJobId) : null);
  const viewedQuery = useQuery<Generation>({
    queryKey: [JOB_ENDPOINT(webinarId, viewedOutputId)],
    enabled: !!viewedOutputId && viewedOutputId !== polledJobId,
    staleTime: 0,
    refetchInterval: false,
  });
  const selectedGeneration = viewedQuery.data || (
    viewedOutputId ? history.find((item) => generationId(item) === viewedOutputId) : null
  );
  const effectiveGeneration = activeGeneration || lastCompleted;
  const displayGeneration = selectedGeneration || lastCompleted;
  const missingRequired = missingSalesScriptQuestionIds(answers);
  const points = Number(stateQuery.data?.availablePoints ?? balanceQuery.data?.points ?? 0);
  // The worker always reserves a real credit lot. An "unlimited" plan flag
  // from the general AI assistant must never turn this feature into free use.
  const canAfford = points >= GENERATION_FEE_POINTS;
  const canGenerate =
    missingRequired.length === 0 && canAfford && !isRunning(activeGeneration);
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

  useEffect(() => {
    if (!stateQuery.isFetched || hydratedFor.current === webinarId) return;
    hydratedFor.current = webinarId;
    const saved = stateQuery.data?.draft?.answers || {};
    setAnswers((current) => {
      const merged = { ...current, ...saved };
      // These values come from the already-saved webinar, never from an
      // example. Existing non-empty draft answers always win.
      if (!String(merged.planName || "").trim() && webinarTitle?.trim()) {
        merged.planName = webinarTitle.trim();
      }
      if (!String(merged.outcome || "").trim() && webinarDescription?.trim()) {
        merged.outcome = webinarDescription.trim();
      }
      return merged;
    });
  }, [stateQuery.data, stateQuery.isFetched, webinarDescription, webinarId, webinarTitle]);

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
    if (!statusQuery.data) return;
    if (isComplete(statusQuery.data)) {
      setLastCompleted(statusQuery.data);
      setActiveJobId("");
      setTimedOutKey("");
      queryClient.invalidateQueries({ queryKey: [STATE_ENDPOINT(webinarId)] });
      queryClient.invalidateQueries({ queryKey: ["/api/ai-points"] });
      return;
    }
    if (["failed", "error", "refunded"].includes(generationStatus(statusQuery.data))) {
      setLastCompleted(statusQuery.data);
      setActiveJobId("");
      queryClient.invalidateQueries({ queryKey: [STATE_ENDPOINT(webinarId)] });
      queryClient.invalidateQueries({ queryKey: ["/api/ai-points"] });
    }
  }, [statusQuery.data, webinarId]);

  const saveDraft = useMutation({
    mutationFn: async (nextAnswers: SalesScriptQuestionnaireAnswers) => {
      const response = await apiRequest("PUT", DRAFT_ENDPOINT(webinarId), {
        answers: nextAnswers,
      });
      return response;
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
    mutationFn: async (idempotencyKey: string) =>
      requestWithTimeout(
        JOBS_ENDPOINT(webinarId),
        { answers, ackCost: GENERATION_FEE_POINTS, idempotencyKey },
        idempotencyKey,
      ),
    onSuccess: (payload: Generation) => {
      const jobId = generationId(payload);
      setIsConfirmOpen(false);
      setConfirmCharge(false);
      setTimedOutKey("");
      if (jobId) setActiveJobId(jobId);
      queryClient.invalidateQueries({ queryKey: [STATE_ENDPOINT(webinarId)] });
      queryClient.invalidateQueries({ queryKey: ["/api/ai-points"] });
      toast({
        title: "已開始生成銷售演講",
        description: "可留在此頁查看進度；重新載入後也會繼續顯示執行中的工作。",
      });
    },
    onError: (error: Error) => {
      if (error instanceof SalesScriptTimeoutError) {
        setTimedOutKey(error.idempotencyKey);
        queryClient.invalidateQueries({ queryKey: [STATE_ENDPOINT(webinarId)] });
        toast({
          title: "生成要求逾時",
          description: "已保留本次辨識碼並重新查詢執行狀態，請不要再次付款重送。",
          variant: "destructive",
        });
        return;
      }
      toast({
        title: "生成失敗",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  useEffect(() => {
    if (!timedOutKey || !history.length) return;
    // Summaries intentionally do not expose idempotency keys. Adopt the
    // owner's running job rather than blindly creating a second charge.
    const matching = history.find(isRunning);
    if (matching && generationId(matching)) {
      setActiveJobId(generationId(matching));
    }
  }, [history, timedOutKey]);

  const updateAnswer = (id: keyof SalesScriptQuestionnaireAnswers, value: string) => {
    setAnswers((current) => ({ ...current, [id]: value }));
  };

  const askGenerate = () => {
    if (!canGenerate) return;
    setConfirmCharge(false);
    setIsConfirmOpen(true);
  };

  const confirmGenerate = async () => {
    if (!confirmCharge || !canGenerate) return;
    try {
      await saveDraft.mutateAsync(answers);
      setViewedOutputId("");
      setLastCompleted(null);
      const key = createIdempotencyKey();
      await generate.mutateAsync(key);
    } catch {
      // Mutations already surface an actionable error and keep all answers.
    }
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
    const output = isEditingOutput ? editableOutput : outputFor(displayGeneration);
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
  const failureText = effectiveGeneration?.errorMessage || effectiveGeneration?.error || "伺服器生成失敗。";

  return (
    <div className="space-y-5" data-testid="sales-script-generator">
      <Card className="border-primary/30 bg-gradient-to-br from-primary/10 via-background to-background">
        <CardHeader className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2 text-xl">
                <Sparkles className="h-5 w-5 text-primary" />
                銷售演講生成器
              </CardTitle>
              <CardDescription className="mt-2 max-w-3xl">
                填寫真實資料後，生成六段式專業銷講架構、逐頁簡報建議與可直接念的逐字稿，再自行交給其他 AI 美化成 PPT。
              </CardDescription>
            </div>
            <Badge variant="secondary" className="gap-1.5 whitespace-nowrap">
              <FileText className="h-3.5 w-3.5" />
              文字輸出，不改動 Webinar
            </Badge>
          </div>
          <div className="grid gap-2 sm:grid-cols-4">
            {["六段式專業銷講架構", "逐頁簡報建議", "可直接念逐字稿", "自行交其他 AI 美化"].map((item) => (
              <div key={item} className="rounded-lg border bg-background/70 px-3 py-2 text-sm">
                <CheckCircle2 className="mr-1.5 inline h-4 w-4 text-emerald-600" />
                {item}
              </div>
            ))}
          </div>
        </CardHeader>
      </Card>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_21rem]">
        <Card data-testid="sales-script-form-card">
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle className="text-lg">銷講資料問卷</CardTitle>
                <CardDescription>
                  必填欄位有七個。每個示例都標示「示例」，只作提示，不會成為你的使用者主張。
                </CardDescription>
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={() => saveDraft.mutate(answers)}
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
            <Accordion type="multiple" defaultValue={["foundation", "story"]} className="w-full">
              {SALES_SCRIPT_QUESTIONNAIRE_GROUPS.map((group) => (
                <AccordionItem value={group.id} key={group.id}>
                  <AccordionTrigger className="text-left hover:no-underline">
                    <span>
                      <span className="block">{group.title}</span>
                      <span className="mt-1 block text-xs font-normal text-muted-foreground">
                        {group.description}
                      </span>
                    </span>
                  </AccordionTrigger>
                  <AccordionContent>
                    <div className="grid gap-5 md:grid-cols-2">
                      {group.fields.map((question) => {
                        const value = answers[question.id] || "";
                        return (
                          <div
                            key={question.id}
                            className={question.multiline ? "space-y-2 md:col-span-2" : "space-y-2"}
                          >
                            <Label htmlFor={`sales-script-${question.id}`}>
                              {question.label}
                              {question.required ? (
                                <span className="ml-1 text-destructive" aria-label="必填">
                                  *
                                </span>
                              ) : null}
                            </Label>
                            <p className="text-xs text-muted-foreground">{question.help}</p>
                            {question.multiline ? (
                              <Textarea
                                id={`sales-script-${question.id}`}
                                value={value}
                                onChange={(event) => updateAnswer(question.id, event.target.value)}
                                placeholder={question.example}
                                rows={4}
                                data-testid={`input-sales-script-${question.id}`}
                              />
                            ) : (
                              <Input
                                id={`sales-script-${question.id}`}
                                value={value}
                                onChange={(event) => updateAnswer(question.id, event.target.value)}
                                placeholder={question.example}
                                data-testid={`input-sales-script-${question.id}`}
                              />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </CardContent>
        </Card>

        <div className="space-y-5">
          <Card className="border-amber-400/70 bg-amber-50/60 dark:bg-amber-950/20">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <WalletCards className="h-5 w-5 text-amber-700" />
                本次生成費用
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-xl border border-amber-500/40 bg-background p-4 text-center">
                <p className="text-3xl font-bold tabular-nums text-amber-700">
                  {GENERATION_FEE_POINTS.toLocaleString()} 點
                </p>
                <p className="mt-1 text-xs text-muted-foreground">每次生成／重新生成都會重新收取</p>
              </div>
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="text-muted-foreground">目前可用點數</span>
                <span className="font-semibold tabular-nums" data-testid="text-sales-script-points">
                  {balanceQuery.isLoading ? "—" : points.toLocaleString()}
                </span>
              </div>
              {trialQuery.data?.state === "active" ? (
                <p className="rounded-md border border-amber-300 bg-amber-100/70 p-2 text-xs text-amber-900">
                  試用額度不能用於此生成器；已購買的點數可以使用。試用不會被當成免費生成。
                </p>
              ) : null}
              {!canAfford ? (
                <div className="space-y-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
                  <p className="font-medium text-destructive">點數不足，生成按鈕已停用。</p>
                  <p className="text-xs text-muted-foreground">
                    需要 {GENERATION_FEE_POINTS.toLocaleString()} 點；先購買點數後再回來，草稿不會遺失。
                  </p>
                  <a className="inline-block font-medium text-primary underline" href="/admin/dashboard?buy-points=1">
                    購買 AI 點數
                  </a>
                </div>
              ) : null}
              <Button
                type="button"
                className="w-full"
                onClick={askGenerate}
                disabled={!canGenerate || generate.isPending || saveDraft.isPending}
                data-testid="button-generate-sales-script"
              >
                {generate.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="mr-2 h-4 w-4" />
                )}
                生成銷售演講（{GENERATION_FEE_POINTS.toLocaleString()} 點）
              </Button>
              {missingRequired.length > 0 ? (
                <p className="text-xs text-muted-foreground">
                  尚缺必填：{missingRequired.map((id) => salesScriptQuestionnaireFields.find((item) => item.id === id)?.label || id).join("、")}
                </p>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">生成狀態</CardTitle>
              <CardDescription>離開或重新載入頁面後，會從伺服器恢復草稿與歷史版本。</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {activeGeneration && isRunning(activeGeneration) ? (
                <div className="space-y-3 rounded-lg border bg-muted/30 p-3" data-testid="sales-script-running">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <Loader2 className="h-4 w-4 animate-spin text-primary" />
                    {activeGeneration.stageLabel || activeGeneration.stage || "伺服器處理中"}
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full bg-primary transition-[width]"
                      style={{ width: `${statusProgress}%` }}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {statusProgress > 0 ? `${statusProgress}% · ` : ""}
                    工作編號 {generationId(activeGeneration) || "等待伺服器回傳"}
                  </p>
                </div>
              ) : null}
              {timedOutKey ? (
                <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900" data-testid="sales-script-timeout">
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
                    <RefreshCw className="mr-1.5 h-3.5 w-3.5" />重新檢查
                  </Button>
                </div>
              ) : null}
              {isFailure ? (
                <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive" data-testid="sales-script-failed">
                  <p className="flex items-center gap-2 font-medium">
                    <AlertCircle className="h-4 w-4" />生成失敗
                  </p>
                  <p className="mt-1 text-xs">{failureText}</p>
                  <p className="mt-2 text-xs font-medium">本次 3,600 點已退款，沒有產生成功稿件。</p>
                </div>
              ) : null}
              {!activeGeneration && !selectedGeneration && !timedOutKey ? (
                <p className="text-sm text-muted-foreground">尚未生成。先儲存資料，再確認費用即可開始。</p>
              ) : null}
            </CardContent>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Clock3 className="h-5 w-5" />
            歷史版本
          </CardTitle>
          <CardDescription>只有伺服器回報已完成且已扣款成功的版本可以查看、複製或下載。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {history.length === 0 ? (
            <p className="text-sm text-muted-foreground">尚無歷史版本。</p>
          ) : (
            history.map((item) => {
              const itemId = generationId(item);
              const completed = isComplete(item);
              const failed = ["failed", "error", "refunded"].includes(generationStatus(item));
              return (
                <div
                  key={itemId || item.createdAt}
                  className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between"
                  data-testid={`sales-script-history-${itemId}`}
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      {completed ? "已完成" : failed ? "失敗（已退款）" : isRunning(item) ? "生成中" : "尚未完成"}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {item.createdAt ? new Date(item.createdAt).toLocaleString("zh-TW") : "時間未提供"}
                      {item.pointsCharged ? ` · ${item.pointsCharged.toLocaleString()} 點` : ""}
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

      {displayGeneration && isComplete(displayGeneration) && outputFor(displayGeneration) ? (
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
                  onClick={() => copyText(isEditingOutput ? editableOutput : outputFor(displayGeneration))}
                  data-testid="button-copy-sales-script"
                >
                  <Copy className="mr-1.5 h-4 w-4" />複製
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={() => download("md")} data-testid="button-download-sales-script-md">
                  <Download className="mr-1.5 h-4 w-4" />.md
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={() => download("txt")} data-testid="button-download-sales-script-txt">
                  <Download className="mr-1.5 h-4 w-4" />.txt
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={setOutputForEditing}>
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
              <pre className="max-h-[42rem] overflow-auto whitespace-pre-wrap break-words rounded-lg border bg-muted/20 p-4 text-sm leading-6" data-testid="text-sales-script-output">
                {outputFor(displayGeneration)}
              </pre>
            )}
            <div className="rounded-lg border border-primary/30 bg-primary/5 p-4">
              <p className="text-sm font-semibold">交給其他 AI 美化成 PPT</p>
              <p className="mt-1 text-sm text-muted-foreground">
                複製稿件後，連同以下提示詞貼到你選擇的 AI；請人工核對所有真實資料。
              </p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="mt-3"
                onClick={() => copyText(`${handoffPrompt}\n\n${isEditingOutput ? editableOutput : outputFor(displayGeneration)}`, "已複製 PPT 交接提示詞與稿件")}
                data-testid="button-copy-sales-script-handoff"
              >
                <Copy className="mr-1.5 h-4 w-4" />複製交接提示詞與稿件
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <AlertDialog open={isConfirmOpen} onOpenChange={setIsConfirmOpen}>
        <AlertDialogContent data-testid="sales-script-fee-modal">
          <AlertDialogHeader>
            <AlertDialogTitle>確認生成銷售演講</AlertDialogTitle>
            <AlertDialogDescription>
              本次將收取 <strong>{GENERATION_FEE_POINTS.toLocaleString()} 點</strong>。重新生成也是新的收費工作；伺服器失敗時會退款。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <label className="flex items-start gap-3 rounded-lg border p-3 text-sm">
            <Checkbox
              checked={confirmCharge}
              onCheckedChange={(checked) => setConfirmCharge(checked === true)}
              data-testid="checkbox-confirm-sales-script-fee"
            />
            <span>我已確認本次生成會收取 3,600 點，並同意送出這次工作。</span>
          </label>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={!confirmCharge || generate.isPending || saveDraft.isPending}
              onClick={(event) => {
                event.preventDefault();
                void confirmGenerate();
              }}
              data-testid="button-confirm-sales-script-fee"
            >
              {generate.isPending || saveDraft.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
              確認並收取 3,600 點
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
