import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { AiTestReplyResponse } from "@shared/aiAssistant";

export function AiTestQuestionPanel({ webinarId }: { webinarId: string }) {
  const [question, setQuestion] = useState("");
  const [result, setResult] = useState<AiTestReplyResponse | null>(null);
  const test = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", `/api/webinars/${webinarId}/ai/test-question`, { question: question.trim() });
      return response.json() as Promise<AiTestReplyResponse>;
    },
    onSuccess: data => {
      setResult(data);
      queryClient.invalidateQueries({ queryKey: ["/api/ai-points"] });
      queryClient.invalidateQueries({ predicate: query => String(query.queryKey[0]).startsWith(`/api/webinars/${webinarId}/ai/logs?`) });
    },
    onError: () => setResult(null),
  });
  const error = test.error as Error | null;
  const noCredits = !!error && /^402:/.test(error.message);
  return (
    <Card className="lg:sticky lg:top-5">
      <CardHeader>
        <CardTitle className="text-base">測試一個問題</CardTitle>
        <CardDescription>使用已儲存的設定與知識資料。試問依一般 AI 點數規則計費，並會寫入回覆紀錄。</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Textarea aria-label="測試問題" data-testid="ai-test-question" maxLength={2000} rows={5} value={question} onChange={event => setQuestion(event.target.value)} placeholder="輸入學員可能會問的問題" />
        <Button className="w-full" data-testid="ai-test-submit" disabled={!question.trim() || test.isPending} onClick={() => test.mutate()}>
          {test.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}送出試問
        </Button>
        {error && <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error.message}{noCredits && <a className="mt-2 block font-medium underline" href="/admin/dashboard?buy-points=1">購買 AI 點數</a>}</div>}
        {result && (
          <div data-testid="ai-test-answer" className="space-y-3 rounded-md border bg-muted/20 p-4">
            <div className="flex justify-between text-xs text-muted-foreground"><span>{result.status === "answered" ? "已回答" : result.status === "fallback" ? "資訊不足回覆" : result.status === "no_credits" ? "點數不足" : "回覆錯誤"}</span><span>{result.unlimited ? "不限量方案" : `使用 ${result.pointsCharged} 點`}</span></div>
            <p className="whitespace-pre-wrap text-sm leading-6">{result.answer}</p>
            {result.sources.length > 0 && <div className="border-t pt-2 text-xs text-muted-foreground">參考：{result.sources.map(source => source.title).join("、")}</div>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}