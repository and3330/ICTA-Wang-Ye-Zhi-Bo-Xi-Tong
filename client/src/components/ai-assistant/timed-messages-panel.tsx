import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertCircle, Clock3, ExternalLink, Loader2, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import type { ScheduledMessage } from "@shared/schema";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { parseClock } from "@/lib/clock-time";
import { apiRequest, queryClient } from "@/lib/queryClient";

type TimedMessageForm = {
  id?: string;
  triggerTime: string;
  text: string;
  link: string;
  fullMessage: string;
};

const emptyForm = (): TimedMessageForm => ({ triggerTime: "", text: "", link: "", fullMessage: "" });

function formatClock(seconds: number) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
    : `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function isHttpsUrl(value: string) {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

export function TimedMessagesPanel({ webinarId }: { webinarId: string }) {
  const { toast } = useToast();
  const [form, setForm] = useState<TimedMessageForm | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ScheduledMessage | null>(null);
  const [formError, setFormError] = useState("");
  const messagesUrl = `/api/webinars/${webinarId}/scheduled-messages`;
  const queryKey = ["/api/webinars", webinarId, "scheduled-messages"];
  const messagesQuery = useQuery<ScheduledMessage[]>({ queryKey, enabled: !!webinarId });
  const assistantMessages = useMemo(
    () => (messagesQuery.data ?? []).filter(message => message.messageType === "assistant").sort((a, b) => a.triggerTime - b.triggerTime),
    [messagesQuery.data],
  );

  const refresh = () => queryClient.invalidateQueries({ queryKey });
  const saveMutation = useMutation({
    mutationFn: async ({ id, message, triggerTime }: { id?: string; message: string; triggerTime: number }) => {
      const url = id ? `${messagesUrl}/${id}` : messagesUrl;
      const payload = id ? { message, triggerTime } : { messageType: "assistant", fakeUserId: null, message, triggerTime };
      const response = await apiRequest(id ? "PATCH" : "POST", url, payload);
      return response.json();
    },
    onSuccess: async () => {
      setForm(null);
      setFormError("");
      await refresh();
      toast({ title: "定時素材已儲存" });
    },
    onError: (error: Error) => toast({ title: "儲存失敗", description: error.message, variant: "destructive" }),
  });
  const deleteMutation = useMutation({
    mutationFn: async (messageId: string) => {
      await apiRequest("DELETE", `${messagesUrl}/${messageId}`);
    },
    onSuccess: async () => {
      setDeleteTarget(null);
      await refresh();
      toast({ title: "定時素材已刪除" });
    },
    onError: (error: Error) => toast({ title: "刪除失敗", description: error.message, variant: "destructive" }),
  });

  const beginEdit = (message: ScheduledMessage) => {
    setForm({
      id: message.id,
      triggerTime: formatClock(message.triggerTime),
      text: "",
      link: "",
      fullMessage: message.message,
    });
    setFormError("");
  };

  const submitForm = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!form) return;
    const seconds = parseClock(form.triggerTime);
    if (seconds === null || !Number.isInteger(seconds) || seconds < 0 || seconds > 86400) {
      setFormError("請輸入有效影片時間（分:秒或時:分:秒），秒數需介於 0 至 86,400。");
      return;
    }
    let message: string;
    if (form.id) {
      message = form.fullMessage.trim();
    } else {
      const text = form.text.trim();
      const link = form.link.trim();
      if (!text) {
        setFormError("請輸入要傳送的文字。");
        return;
      }
      if (link && !isHttpsUrl(link)) {
        setFormError("素材連結必須是有效的 HTTPS 網址。");
        return;
      }
      message = link ? `${text}\n${link}` : text;
    }
    if (!message) {
      setFormError("訊息不可為空。");
      return;
    }
    if (message.length > 2000) {
      setFormError("完整訊息不可超過 2,000 個字元。");
      return;
    }
    setFormError("");
    saveMutation.mutate({ id: form.id, message, triggerTime: seconds });
  };

  return (
    <>
      <Card>
        <CardHeader className="gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2"><Clock3 className="h-5 w-5 text-primary" />定時素材</CardTitle>
            <CardDescription className="mt-2 max-w-2xl leading-6">
              在指定的影片播放秒數，由助理把文字與連結送進觀眾聊天室。暫停時時間不會前進；同一觀眾每次載入房間只會送出一次，往後拖曳會補送已到時間的素材。連結只會顯示在聊天室，不會自動跳轉。
            </CardDescription>
          </div>
          <Button onClick={() => { setForm(emptyForm()); setFormError(""); }} disabled={!!form} className="shrink-0">
            <Plus className="mr-2 h-4 w-4" />新增素材
          </Button>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="rounded-lg border border-primary/15 bg-primary/[0.035] px-4 py-3 text-sm leading-6 text-muted-foreground">
            這些素材獨立於 AI 自動回覆設定，也不需要建立假觀眾；即使關閉 AI 自動回覆，仍可依影片進度送出。
          </div>

          {form && (
            <form onSubmit={submitForm} className="space-y-4 rounded-xl border bg-muted/20 p-4 sm:p-5" aria-labelledby="timed-message-form-title">
              <div className="flex items-center justify-between gap-3">
                <h3 id="timed-message-form-title" className="font-semibold">{form.id ? "編輯定時素材" : "新增定時素材"}</h3>
                <Button type="button" variant="ghost" size="sm" onClick={() => { setForm(null); setFormError(""); }}>取消</Button>
              </div>
              <div className="grid gap-4 sm:grid-cols-[190px_minmax(0,1fr)]">
                <div className="space-y-2">
                  <Label htmlFor="timed-message-time">影片播放時間</Label>
                  <Input
                    id="timed-message-time"
                    autoFocus
                    inputMode="numeric"
                    placeholder="例如 5:30"
                    value={form.triggerTime}
                    aria-describedby="timed-message-time-hint"
                    onChange={event => setForm({ ...form, triggerTime: event.target.value })}
                  />
                  <p id="timed-message-time-hint" className="text-xs leading-5 text-muted-foreground">分:秒或時:分:秒，最長 24 小時。</p>
                </div>
                {form.id ? (
                  <div className="space-y-2">
                    <div className="flex justify-between gap-2"><Label htmlFor="timed-message-full">完整聊天室訊息</Label><span className="text-xs text-muted-foreground">{form.fullMessage.length} / 2,000</span></div>
                    <Textarea id="timed-message-full" rows={4} maxLength={2000} value={form.fullMessage} onChange={event => setForm({ ...form, fullMessage: event.target.value })} aria-describedby="timed-message-edit-hint" />
                    <p id="timed-message-edit-hint" className="text-xs leading-5 text-muted-foreground">保留原始完整內容；如有連結，請勿移除或改寫不需要變更的部分。</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <div className="flex justify-between gap-2"><Label htmlFor="timed-message-text">聊天室文字</Label><span className="text-xs text-muted-foreground">{form.text.length} / 2,000</span></div>
                      <Textarea id="timed-message-text" rows={3} maxLength={2000} placeholder="輸入助理要傳送的內容" value={form.text} onChange={event => setForm({ ...form, text: event.target.value })} aria-describedby="timed-message-link-hint" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="timed-message-link">素材連結（選填）</Label>
                      <Input id="timed-message-link" type="url" inputMode="url" placeholder="https://example.com/resource" value={form.link} onChange={event => setForm({ ...form, link: event.target.value })} />
                      <p id="timed-message-link-hint" className="text-xs leading-5 text-muted-foreground">只接受 HTTPS 網址，儲存後會接在文字下一行。</p>
                    </div>
                  </div>
                )}
              </div>
              {formError && <p role="alert" className="flex items-start gap-2 text-sm text-destructive"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{formError}</p>}
              {saveMutation.isError && <p role="alert" className="text-sm text-destructive">儲存時發生錯誤，請確認內容後重試。</p>}
              <div className="flex justify-end">
                <Button type="submit" disabled={saveMutation.isPending}>
                  {saveMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {form.id ? "儲存修改" : "建立定時素材"}
                </Button>
              </div>
            </form>
          )}

          {messagesQuery.isLoading ? (
            <div className="space-y-3" aria-label="載入定時素材">
              {[0, 1, 2].map(item => <div key={item} className="h-[76px] animate-pulse rounded-lg bg-muted" />)}
            </div>
          ) : messagesQuery.isError ? (
            <div className="rounded-lg border border-destructive/25 bg-destructive/[0.035] p-5 text-center">
              <AlertCircle className="mx-auto mb-2 h-5 w-5 text-destructive" />
              <p className="font-medium">定時素材載入失敗</p>
              <p className="mt-1 text-sm text-muted-foreground">{(messagesQuery.error as Error).message}</p>
              <Button variant="outline" size="sm" className="mt-4" onClick={() => void messagesQuery.refetch()}><RefreshCw className="mr-2 h-4 w-4" />重新載入</Button>
            </div>
          ) : assistantMessages.length === 0 ? (
            <div className="rounded-xl border border-dashed px-5 py-10 text-center">
              <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-primary/10 text-primary"><Clock3 className="h-5 w-5" /></span>
              <h3 className="mt-3 font-semibold">還沒有定時素材</h3>
              <p className="mx-auto mt-1 max-w-md text-sm leading-6 text-muted-foreground">建立一則素材，讓重點提醒或資源連結在影片進度到達時出現在聊天室。</p>
              {!form && <Button variant="outline" size="sm" className="mt-4" onClick={() => { setForm(emptyForm()); setFormError(""); }}><Plus className="mr-2 h-4 w-4" />新增第一則素材</Button>}
            </div>
          ) : (
            <div className="space-y-2" aria-label="定時素材清單">
              {assistantMessages.map(message => {
                const url = message.message.split(/\s+/).find(part => /^https:\/\//i.test(part));
                return (
                  <article key={message.id} className="group flex flex-col gap-3 rounded-lg border bg-card p-3.5 transition-colors hover:bg-muted/20 sm:flex-row sm:items-start sm:gap-4 sm:p-4">
                    <div className="flex shrink-0 items-center gap-2 sm:w-24 sm:flex-col sm:items-start sm:gap-0">
                      <span className="font-mono text-sm font-semibold tabular-nums text-primary">{formatClock(message.triggerTime)}</span>
                      <span className="text-xs text-muted-foreground">影片時間</span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="whitespace-pre-wrap break-words text-sm leading-6">{message.message}</p>
                      {url && <span className="mt-2 inline-flex items-center gap-1 text-xs text-muted-foreground"><ExternalLink className="h-3 w-3" />聊天室顯示連結</span>}
                    </div>
                    <div className="flex shrink-0 gap-2 sm:opacity-70 sm:transition-opacity sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
                      <Button variant="outline" size="sm" onClick={() => beginEdit(message)} disabled={!!form || deleteMutation.isPending} aria-label={`編輯 ${formatClock(message.triggerTime)} 定時素材`}><Pencil className="mr-1.5 h-3.5 w-3.5" />編輯</Button>
                      <Button variant="outline" size="sm" className="text-destructive hover:text-destructive" onClick={() => setDeleteTarget(message)} disabled={deleteMutation.isPending} aria-label={`刪除 ${formatClock(message.triggerTime)} 定時素材`}><Trash2 className="mr-1.5 h-3.5 w-3.5" />刪除</Button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
          {messagesQuery.isFetching && !messagesQuery.isLoading && <p className="text-right text-xs text-muted-foreground">正在同步最新資料…</p>}
        </CardContent>
      </Card>

      <AlertDialog open={!!deleteTarget} onOpenChange={open => { if (!open && !deleteMutation.isPending) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>刪除此定時素材？</AlertDialogTitle>
            <AlertDialogDescription>將永久刪除影片 {deleteTarget ? formatClock(deleteTarget.triggerTime) : ""} 的聊天室訊息。此動作無法復原。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleteMutation.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={event => { event.preventDefault(); if (deleteTarget) deleteMutation.mutate(deleteTarget.id); }}
            >
              {deleteMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}確認刪除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
