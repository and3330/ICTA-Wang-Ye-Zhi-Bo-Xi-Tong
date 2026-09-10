import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertCircle, CheckCircle2, Loader2, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { AiReplyLogEntry, AiReplyLogResponse } from "@shared/aiAssistant";

const statusLabel: Record<AiReplyLogEntry["status"], string> = {
  answered: "已回答", fallback: "資訊不足回覆", error: "錯誤", no_credits: "點數不足",
};
const reviewLabel: Record<AiReplyLogEntry["reviewStatus"], string> = {
  unreviewed: "未審閱", incorrect: "標記不正確", corrected: "已提供正確答案",
};

export function AiLogsPanel({ webinarId, onKnowledgeChanged }: { webinarId: string; onKnowledgeChanged: () => void }) {
  const { toast } = useToast();
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [kind, setKind] = useState("all");
  const [reviewStatus, setReviewStatus] = useState("all");
  const [sessionId, setSessionId] = useState("");
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [correctedAnswer, setCorrectedAnswer] = useState("");
  const [notes, setNotes] = useState("");
  const [addToKnowledge, setAddToKnowledge] = useState(true);
  const queryUrl = useMemo(() => {
    const params = new URLSearchParams({ page: String(page), pageSize: "20" });
    if (search) params.set("search", search);
    if (status !== "all") params.set("status", status);
    if (kind !== "all") params.set("kind", kind);
    if (reviewStatus !== "all") params.set("reviewStatus", reviewStatus);
    if (sessionId.trim()) params.set("sessionId", sessionId.trim());
    return `/api/webinars/${webinarId}/ai/logs?${params.toString()}`;
  }, [webinarId, page, search, status, kind, reviewStatus, sessionId]);
  const query = useQuery<AiReplyLogResponse>({ queryKey: [queryUrl], enabled: !!webinarId });
  const selected = query.data?.items.find(item => item.id === selectedId) || null;
  useEffect(() => {
    if (query.data && (!selectedId || !query.data.items.some(item => item.id === selectedId))) setSelectedId(query.data.items[0]?.id || null);
  }, [query.data, selectedId]);
  useEffect(() => {
    if (selected) {
      setCorrectedAnswer(selected.correctedAnswer || "");
      setNotes(selected.reviewNotes || "");
      setAddToKnowledge(true);
    }
  }, [selected?.id]);
  const refreshLogs = () => queryClient.invalidateQueries({ predicate: item => String(item.queryKey[0]).startsWith(`/api/webinars/${webinarId}/ai/logs?`) });
  const review = useMutation({
    mutationFn: async (body: { reviewStatus: "incorrect" } | { reviewStatus: "corrected"; correctedAnswer: string; notes: string; addToKnowledge: boolean }) => {
      if (!selected) throw new Error("請選擇一筆紀錄");
      const response = await apiRequest("PATCH", `/api/webinars/${webinarId}/ai/logs/${selected.id}/review`, body);
      return response.json() as Promise<AiReplyLogEntry>;
    },
    onSuccess: result => {
      refreshLogs();
      if (result.correctionDocumentId) onKnowledgeChanged();
      toast({ title: result.reviewStatus === "corrected" ? "正確答案已儲存" : "已標記為不正確" });
    },
    onError: (error: Error) => toast({ title: "審閱失敗", description: error.message, variant: "destructive" }),
  });
  const totalPages = Math.max(1, Math.ceil((query.data?.total || 0) / 20));
  const applyFilters = () => { setPage(1); setSearch(searchInput.trim()); };
  return (
    <Card>
      <CardHeader><CardTitle>實際回覆紀錄</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-5">
          <div className="flex gap-1 md:col-span-2">
            <Input data-testid="ai-log-search" aria-label="搜尋回覆紀錄" placeholder="搜尋問題或回答" value={searchInput} onChange={event => setSearchInput(event.target.value)} onKeyDown={event => { if (event.key === "Enter") applyFilters(); }} />
            <Button size="icon" variant="outline" aria-label="搜尋" onClick={applyFilters}><Search className="h-4 w-4" /></Button>
          </div>
          <Select value={status} onValueChange={value => { setStatus(value); setPage(1); }}><SelectTrigger aria-label="回覆狀態"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">全部狀態</SelectItem><SelectItem value="answered">已回答</SelectItem><SelectItem value="fallback">資訊不足</SelectItem><SelectItem value="error">錯誤</SelectItem><SelectItem value="no_credits">點數不足</SelectItem></SelectContent></Select>
          <Select value={kind} onValueChange={value => { setKind(value); setPage(1); }}><SelectTrigger aria-label="回覆類型"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">直播與測試</SelectItem><SelectItem value="live">直播</SelectItem><SelectItem value="test">測試</SelectItem></SelectContent></Select>
          <Select value={reviewStatus} onValueChange={value => { setReviewStatus(value); setPage(1); }}><SelectTrigger aria-label="審閱狀態"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">全部審閱狀態</SelectItem><SelectItem value="unreviewed">未審閱</SelectItem><SelectItem value="incorrect">標記不正確</SelectItem><SelectItem value="corrected">已修正</SelectItem></SelectContent></Select>
        </div>
        <div className="flex items-center gap-2">
          <Label htmlFor="ai-session-filter" className="shrink-0">場次 ID</Label>
          <Input id="ai-session-filter" className="max-w-sm" value={sessionId} onChange={event => { setSessionId(event.target.value); setPage(1); }} placeholder="只查看特定直播場次" />
        </div>
        {query.isLoading && <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin" /></div>}
        {query.error && <p role="alert" className="text-sm text-destructive">{(query.error as Error).message}</p>}
        {!query.isLoading && !query.error && !query.data?.items.length && <p className="py-14 text-center text-sm text-muted-foreground">目前沒有符合條件的回覆紀錄</p>}
        {!!query.data?.items.length && (
          <div className="grid min-h-[550px] min-w-0 overflow-hidden rounded-lg border lg:grid-cols-[minmax(260px,36%)_minmax(0,1fr)]">
            <div className="max-h-[700px] overflow-y-auto border-b lg:border-b-0 lg:border-r">
              {query.data.items.map(item => (
                <button key={item.id} type="button" data-testid={`ai-log-row-${item.id}`} onClick={() => setSelectedId(item.id)} className={`block w-full border-b p-4 text-left transition-colors hover:bg-muted/50 ${selectedId === item.id ? "bg-primary/5" : ""}`}>
                  <div className="mb-2 flex items-center justify-between gap-2"><Badge variant={item.kind === "test" ? "secondary" : "default"}>{item.kind === "test" ? "測試" : "直播"}</Badge><span className="text-xs text-muted-foreground">{new Date(item.createdAt).toLocaleString("zh-TW")}</span></div>
                  <p className="line-clamp-2 text-sm font-medium">{item.question}</p>
                  <p className="mt-2 text-xs text-muted-foreground">{statusLabel[item.status]} · {reviewLabel[item.reviewStatus]}</p>
                </button>
              ))}
            </div>
            {selected && <LogDetail selected={selected} correctedAnswer={correctedAnswer} setCorrectedAnswer={setCorrectedAnswer} notes={notes} setNotes={setNotes} addToKnowledge={addToKnowledge} setAddToKnowledge={setAddToKnowledge} pending={review.isPending} markIncorrect={() => review.mutate({ reviewStatus: "incorrect" })} save={() => review.mutate({ reviewStatus: "corrected", correctedAnswer: correctedAnswer.trim(), notes: notes.trim(), addToKnowledge })} />}
          </div>
        )}
        {(query.data?.total || 0) > 20 && <div className="flex items-center justify-center gap-3"><Button variant="outline" disabled={page <= 1} onClick={() => setPage(value => value - 1)}>上一頁</Button><span className="text-sm">第 {page} / {totalPages} 頁</span><Button variant="outline" disabled={page >= totalPages} onClick={() => setPage(value => value + 1)}>下一頁</Button></div>}
      </CardContent>
    </Card>
  );
}

function LogDetail({ selected, correctedAnswer, setCorrectedAnswer, notes, setNotes, addToKnowledge, setAddToKnowledge, pending, markIncorrect, save }: {
  selected: AiReplyLogEntry; correctedAnswer: string; setCorrectedAnswer: (value: string) => void; notes: string; setNotes: (value: string) => void; addToKnowledge: boolean; setAddToKnowledge: (value: boolean) => void; pending: boolean; markIncorrect: () => void; save: () => void;
}) {
  return <div className="min-w-0 space-y-6 overflow-y-auto p-4 sm:p-6">
    <div className="flex flex-wrap items-center gap-2"><Badge>{selected.kind === "test" ? "測試" : "直播"}</Badge><Badge variant="outline">{statusLabel[selected.status]}</Badge><Badge variant="secondary">{reviewLabel[selected.reviewStatus]}</Badge></div>
    <section><h3 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">原始問題</h3><p className="break-words whitespace-pre-wrap text-sm leading-6">{selected.question}</p></section>
    <section><h3 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">原始回答</h3>{selected.answer ? <p className="break-words whitespace-pre-wrap text-sm leading-6">{selected.answer}</p> : <p className="flex items-center gap-2 break-words text-sm text-destructive"><AlertCircle className="h-4 w-4 shrink-0" />{selected.errorMessage || statusLabel[selected.status]}</p>}</section>
    <div className="grid gap-2 rounded-md bg-muted/40 p-3 text-xs text-muted-foreground sm:grid-cols-2">
      <span>時間：{new Date(selected.createdAt).toLocaleString("zh-TW")}</span><span>耗時：{selected.durationMs.toLocaleString()} 毫秒</span><span>點數：{selected.pointsCharged}</span><span className="break-all">模型：{selected.model || "—"}</span><span className="break-all sm:col-span-2">場次：{selected.sessionId || "無（測試）"}</span>
    </div>
    {selected.sources.length > 0 && <section><h3 className="mb-2 text-xs font-semibold text-muted-foreground">引用來源</h3><div className="space-y-2">{selected.sources.map(source => <div key={source.id} className="rounded border p-3"><p className="text-sm font-medium">{source.title}</p><p className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">{source.excerpt}</p></div>)}</div></section>}
    <div className="border-t pt-5">
      <div className="mb-4 flex items-center justify-between gap-2"><div><h3 className="font-medium">提供正確答案</h3><p className="text-xs text-muted-foreground">只會記錄審閱與建立知識，不會改寫過去對話。</p></div><Button variant="outline" onClick={markIncorrect} disabled={pending}>標記不正確</Button></div>
      <div className="space-y-4">
        <div className="space-y-2"><Label htmlFor="corrected-answer">正確答案</Label><Textarea id="corrected-answer" data-testid="ai-log-corrected-answer" rows={6} maxLength={8000} value={correctedAnswer} onChange={event => setCorrectedAnswer(event.target.value)} /></div>
        <div className="space-y-2"><Label htmlFor="review-notes">內部備註（選填）</Label><Textarea id="review-notes" rows={3} maxLength={2000} value={notes} onChange={event => setNotes(event.target.value)} /></div>
        <label className="flex items-start gap-2 text-sm"><Checkbox checked={addToKnowledge} onCheckedChange={value => setAddToKnowledge(value === true)} /><span>將此問答加入知識庫，供後續回覆參考</span></label>
        <Button data-testid="ai-log-review-save" onClick={save} disabled={!correctedAnswer.trim() || pending}>{pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}儲存正確答案</Button>
      </div>
    </div>
  </div>;
}