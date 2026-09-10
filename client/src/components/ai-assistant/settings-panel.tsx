import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { AiReplySettings, AiReplySettingsResponse } from "@shared/aiAssistant";

export function AiSettingsPanel({ webinarId }: { webinarId: string }) {
  const { toast } = useToast();
  const initializedFor = useRef<string | null>(null);
  const [form, setForm] = useState<AiReplySettings | null>(null);
  const settingsUrl = `/api/webinars/${webinarId}/ai/settings`;
  const query = useQuery<AiReplySettingsResponse>({ queryKey: [settingsUrl], enabled: !!webinarId });

  useEffect(() => {
    if (query.data && initializedFor.current !== webinarId) {
      setForm(query.data.settings);
      initializedFor.current = webinarId;
    }
  }, [query.data, webinarId]);

  const save = useMutation({
    mutationFn: async () => {
      if (!form) throw new Error("設定尚未載入");
      const response = await apiRequest("PATCH", settingsUrl, form);
      return response.json() as Promise<AiReplySettingsResponse>;
    },
    onSuccess: (data) => {
      setForm(data.settings);
      queryClient.setQueryData([settingsUrl], data);
      toast({ title: "AI 助理設定已儲存" });
    },
    onError: (error: Error) => toast({ title: "儲存失敗", description: error.message, variant: "destructive" }),
  });

  if (query.error) return <p className="rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">{(query.error as Error).message}</p>;
  if (query.isLoading || !form) return <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  const update = <K extends keyof AiReplySettings>(key: K, value: AiReplySettings[K]) => setForm(current => current ? { ...current, [key]: value } : current);

  return (
    <Card>
      <CardHeader>
        <CardTitle>人設與回覆方式</CardTitle>
        <CardDescription>設定代表品牌回覆學員的助理。儲存後才會套用到正式回覆與右側試問。</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex items-start justify-between gap-4 rounded-lg border p-4">
          <div><Label htmlFor="ai-enabled">啟用 AI 自動回覆</Label><p className="mt-1 text-sm text-muted-foreground">停用時不會在直播聊天室自動回覆。</p></div>
          <Switch id="ai-enabled" checked={form.enabled} onCheckedChange={value => update("enabled", value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="ai-teacher-name">講師或品牌名稱</Label>
          <Input id="ai-teacher-name" value={form.teacherName} maxLength={100} onChange={event => update("teacherName", event.target.value)} />
        </div>
        <div className="space-y-2">
          <div className="flex justify-between gap-3"><Label htmlFor="ai-instructions">助理人設與指示</Label><span className="text-xs text-muted-foreground">{form.instructions.length.toLocaleString()} / 12,000</span></div>
          <p className="text-sm text-muted-foreground">可包含角色、業務情境、語氣及不可回答的界線。請勿放入密碼或個人機密。</p>
          <Textarea id="ai-instructions" data-testid="ai-instructions" rows={14} maxLength={12000} value={form.instructions} onChange={event => update("instructions", event.target.value)} placeholder={"角色：你是本課程的品牌助理。\n業務情境：協助學員理解課程與產品。\n語氣：清楚、親切、使用繁體中文。\n界線：不臆測未提供的價格或承諾。"} />
        </div>
        <div className="flex items-start justify-between gap-4 rounded-lg border p-4">
          <div><Label htmlFor="knowledge-only">只根據知識資料回答</Label><p className="mt-1 text-sm text-muted-foreground">建議保持開啟，資訊不足時改用無法確認訊息，不自行臆測。</p></div>
          <Switch id="knowledge-only" checked={form.knowledgeOnly} onCheckedChange={value => update("knowledgeOnly", value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="ai-fallback">資訊不足時的訊息</Label>
          <Textarea id="ai-fallback" rows={3} maxLength={2000} value={form.fallbackMessage} onChange={event => update("fallbackMessage", event.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="ai-out-of-points">AI 點數不足時的訊息</Label>
          <Textarea id="ai-out-of-points" rows={3} maxLength={2000} value={form.outOfPointsMessage} onChange={event => update("outOfPointsMessage", event.target.value)} />
        </div>
        <Button data-testid="ai-settings-save" onClick={() => save.mutate()} disabled={save.isPending}>
          {save.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}儲存設定
        </Button>
      </CardContent>
    </Card>
  );
}