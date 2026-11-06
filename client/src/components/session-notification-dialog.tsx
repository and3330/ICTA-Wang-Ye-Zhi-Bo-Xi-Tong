import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

export function SessionNotificationDialog({ webinarId, session, onClose }: {
  webinarId: string; session: { id: string; scheduledStart: string }; onClose: () => void;
}) {
  const [audience, setAudience] = useState<"all" | "absent">("absent");
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [attempted, setAttempted] = useState(false);
  const { toast } = useToast();
  const path = `/api/webinars/${webinarId}/sessions/${session.id}/notifications`;
  const preview = useQuery<{ recipientCount: number; timezone: string; scheduledStart: string }>({
    queryKey: [path, "preview", audience],
    queryFn: async () => (await apiRequest("GET", `${path}/preview?audience=${audience}`)).json(),
    staleTime: 0,
  });
  const send = useMutation({
    mutationFn: async () => {
      setAttempted(true);
      return (await apiRequest("POST", path, { audience, requestId, expectedCount: preview.data!.recipientCount })).json();
    },
    onSuccess: data => {
      toast({ title: "已加入寄送排程", description: `共 ${data.queuedCount} 封上線通知，系統將依序寄送。` });
      onClose();
    },
    onError: () => { void preview.refetch(); },
    retry: false,
  });
  return <Dialog open onOpenChange={open => { if (!open && !send.isPending) onClose(); }}>
    <DialogContent className="max-w-md max-h-[90dvh] overflow-y-auto" onEscapeKeyDown={event => { if (send.isPending) event.preventDefault(); }}>
      <DialogHeader>
        <DialogTitle>補發上線通知</DialogTitle>
        <DialogDescription>每次可選擇收件對象。這封通知不會取代原本的自動提醒。</DialogDescription>
      </DialogHeader>
      <p className="text-sm">場次：{new Date(session.scheduledStart).toLocaleString("zh-TW", { timeZone: preview.data?.timezone || "Asia/Taipei" })}（{preview.data?.timezone || "Asia/Taipei"}）</p>
      <Label htmlFor="session-notice-audience">收件對象</Label>
      <Select value={audience} disabled={send.isPending || attempted} onValueChange={value => { setAudience(value as "all" | "absent"); setRequestId(crypto.randomUUID()); }}>
        <SelectTrigger id="session-notice-audience" data-testid="select-session-notice-audience"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">該場次全部報名者</SelectItem>
          <SelectItem value="absent">該場次尚未出席者</SelectItem>
        </SelectContent>
      </Select>
      <p className="text-sm" aria-live="polite" data-testid="session-notice-recipient-count">
        {preview.isFetching ? "正在確認收件人數…" : preview.error ? "無法取得收件人數" : `將寄送給 ${preview.data?.recipientCount ?? 0} 位收件人`}
      </p>
      <div className="rounded-md bg-muted p-3 text-sm space-y-2">
        <p className="font-medium">要上線囉！</p>
        <p>您報名的說明會即將與您見面，點擊您的專屬觀看連結，進入直播間！</p>
        <p className="text-muted-foreground">每位收件人會收到自己的觀看連結。同一 Email 在同一場次只寄一封；選擇尚未出席者時，寄出前會再確認出席狀態。</p>
      </div>
      {(preview.error || send.error) && <p role="alert" className="text-sm text-destructive">{String((send.error || preview.error) instanceof Error ? ((send.error || preview.error) as Error).message : "無法寄送通知")}</p>}
      {attempted && <p className="text-xs text-muted-foreground">若連線中斷，請留在此視窗重試同次通知，系統不會重複建立寄送排程。</p>}
      <div className="flex justify-end gap-2">
        <Button variant="outline" disabled={send.isPending} onClick={onClose}>取消</Button>
        <Button data-testid="button-confirm-session-notice" disabled={send.isPending || preview.isFetching || !!preview.error || !preview.data?.recipientCount}
          onClick={() => send.mutate()}>{send.isPending ? "正在加入排程…" : attempted ? "重試同次通知" : "確認補發"}</Button>
      </div>
    </DialogContent>
  </Dialog>;
}
