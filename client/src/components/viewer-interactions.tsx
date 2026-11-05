import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Star } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { pickTimedItem, type TimedItem } from "@/lib/timed-interactions";
import type { FeedbackSurvey, Poll, Question } from "@shared/schema";

/** Shows tips or polls at their video time; see pickTimedItem for the rules. */
export function useTimedItems<T extends TimedItem>(
  items: T[] | undefined,
  currentTime: number,
  isPlaying: boolean,
  defaultSeconds: number,
  show: (item: T, remainingSeconds: number) => void,
) {
  const shownRef = useRef<Set<string>>(new Set());
  const showRef = useRef(show);
  showRef.current = show;
  useEffect(() => {
    if (!items || !isPlaying) return;
    const picked = pickTimedItem(items, currentTime, shownRef.current, defaultSeconds);
    if (picked) showRef.current(picked.item, picked.remainingSeconds);
  }, [items, currentTime, isPlaying, defaultSeconds]);
}

export type ActivePoll = { poll: Poll; seconds: number };

/**
 * Poll prompt and results. The viewer may skip it, and an unanswered poll
 * closes when its open time runs out.
 */
export function ViewerPollDialog({
  active,
  results,
  onVote,
  onClose,
}: {
  active: ActivePoll | null;
  results: Record<number, number> | null;
  onVote: (optionIndex: number) => boolean;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState<number | null>(null);
  const [voted, setVoted] = useState(false);
  const [notice, setNotice] = useState("");
  const pollId = active?.poll.id;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    setSelected(null);
    setVoted(false);
    setNotice("");
  }, [pollId]);

  useEffect(() => {
    if (!active || voted) return;
    const timer = setTimeout(() => onCloseRef.current(), Math.max(1, active.seconds) * 1000);
    return () => clearTimeout(timer);
  }, [active, voted]);

  const options = (active?.poll.options as string[] | undefined) || [];
  const total = results ? Object.values(results).reduce((a, b) => a + b, 0) : 0;

  return (
    <Dialog open={!!active} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{voted ? "投票結果" : "投票"}</DialogTitle>
          <DialogDescription>{active?.poll.question}</DialogDescription>
        </DialogHeader>
        {!voted ? (
          <>
            <div className="py-4">
              <RadioGroup value={selected?.toString()} onValueChange={(v) => setSelected(parseInt(v, 10))}>
                {options.map((option, index) => (
                  <div key={index} className="flex items-center space-x-2">
                    <RadioGroupItem value={index.toString()} id={`poll-option-${index}`} />
                    <Label htmlFor={`poll-option-${index}`}>{option}</Label>
                  </div>
                ))}
              </RadioGroup>
            </div>
            {notice && <p className="text-xs text-destructive" role="alert">{notice}</p>}
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={onClose} data-testid="button-skip-poll">
                略過
              </Button>
              <Button
                className="flex-1"
                disabled={selected === null}
                onClick={() => {
                  if (selected === null) return;
                  if (onVote(selected)) setVoted(true);
                  else setNotice("連線中斷，請稍後再投一次。");
                }}
                data-testid="button-submit-vote"
              >
                提交投票
              </Button>
            </div>
          </>
        ) : (
          <>
            <div className="py-4 space-y-3">
              {!results ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  已送出，正在統計…
                </div>
              ) : options.map((option, index) => {
                const percentage = total > 0 ? Math.round(((results[index] || 0) / total) * 100) : 0;
                return (
                  <div key={index}>
                    <div className="flex justify-between text-sm mb-1">
                      <span>{option}</span>
                      <span>{percentage}%</span>
                    </div>
                    <div className="h-2 bg-muted rounded-full overflow-hidden">
                      <div className="h-full bg-primary transition-all" style={{ width: `${percentage}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
            <Button onClick={onClose} variant="outline" className="w-full" data-testid="button-close-poll">
              關閉
            </Button>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

type SurveyQuestion = { id: string; type: string; question: string; options?: string[]; required: boolean };

export function ViewerSurveyDialog({
  survey,
  open,
  onOpenChange,
  watchToken,
  onSubmitted,
}: {
  survey: FeedbackSurvey | null | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  watchToken: string | null | undefined;
  onSubmitted: () => void;
}) {
  const [responses, setResponses] = useState<Record<string, any>>({});
  const [notice, setNotice] = useState("");
  const questions = (survey?.questions as SurveyQuestion[] | undefined) || [];
  const submit = useMutation({
    mutationFn: () => apiRequest("POST", "/api/feedback-responses", {
      surveyId: survey!.id,
      responses,
      watchToken: watchToken || undefined,
    }),
    onSuccess: () => {
      setNotice("");
      onSubmitted();
    },
    onError: () => setNotice("沒有送出，請重新整理頁面後再試一次。"),
  });

  return (
    <Dialog open={open && !!survey} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{survey?.title || "回饋問卷"}</DialogTitle>
          <DialogDescription>請花一點時間分享您的想法</DialogDescription>
        </DialogHeader>
        <div className="py-4 space-y-4 max-h-[60vh] overflow-y-auto">
          {questions.map((q) => (
            <div key={q.id} className="space-y-2">
              <Label className="text-sm font-medium">
                {q.question}
                {q.required && <span className="text-destructive ml-1">*</span>}
              </Label>
              {q.type === "rating" && (
                <div className="flex gap-1">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <Button
                      key={star}
                      variant="ghost"
                      size="icon"
                      aria-label={`${star} 顆星`}
                      onClick={() => setResponses((prev) => ({ ...prev, [q.id]: star }))}
                      data-testid={`survey-rating-${q.id}-${star}`}
                    >
                      <Star className={`w-6 h-6 ${(responses[q.id] || 0) >= star ? "fill-yellow-400 text-yellow-400" : "text-muted-foreground"}`} />
                    </Button>
                  ))}
                </div>
              )}
              {q.type === "text" && (
                <Textarea
                  placeholder="請輸入您的回答..."
                  value={responses[q.id] || ""}
                  onChange={(e) => setResponses((prev) => ({ ...prev, [q.id]: e.target.value }))}
                  data-testid={`survey-text-${q.id}`}
                />
              )}
              {q.type === "multiChoice" && q.options && (
                <RadioGroup
                  value={responses[q.id] || ""}
                  onValueChange={(v) => setResponses((prev) => ({ ...prev, [q.id]: v }))}
                >
                  {q.options.map((opt, i) => (
                    <div key={i} className="flex items-center space-x-2">
                      <RadioGroupItem value={opt} id={`survey-${q.id}-${i}`} />
                      <Label htmlFor={`survey-${q.id}-${i}`}>{opt}</Label>
                    </div>
                  ))}
                </RadioGroup>
              )}
            </div>
          ))}
        </div>
        {notice && <p className="text-xs text-destructive" role="alert">{notice}</p>}
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} className="flex-1">
            稍後再說
          </Button>
          <Button
            onClick={() => {
              const missing = questions.find((q) => q.required && (responses[q.id] === undefined || responses[q.id] === ""));
              if (missing) {
                setNotice(`請回答「${missing.question}」`);
                return;
              }
              submit.mutate();
            }}
            disabled={submit.isPending}
            className="flex-1"
            data-testid="button-submit-survey"
          >
            {submit.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
            提交回饋
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export const VIEWER_QUESTION_MAX_LENGTH = 500;

/**
 * Lets a registered viewer ask the host a question and read the answered
 * public questions. Asker names are not shown to other viewers.
 */
export function ViewerQaDialog({
  webinarId,
  watchToken,
  open,
  onOpenChange,
}: {
  webinarId: string;
  watchToken: string | null | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [text, setText] = useState("");
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const { data: questions, isLoading } = useQuery<Question[]>({
    queryKey: ["/api/webinars", webinarId, "questions"],
    enabled: open && !!webinarId,
    refetchInterval: open ? 30_000 : false,
  });
  const ask = useMutation({
    mutationFn: (question: string) => apiRequest("POST", `/api/webinars/${webinarId}/questions`, {
      question,
      watchToken: watchToken || undefined,
    }),
    onSuccess: () => {
      setText("");
      setNotice({ kind: "ok", text: "已送出，講師回覆後會顯示在下方。" });
      queryClient.invalidateQueries({ queryKey: ["/api/webinars", webinarId, "questions"] });
    },
    onError: (error: Error) => setNotice({
      kind: "error",
      text: error.message.startsWith("429")
        ? "發問太頻繁了，請稍後再試。"
        : error.message.startsWith("401")
          ? "請從報名信裡的連結進入後再發問。"
          : "沒有送出，請稍後再試。",
    }),
  });
  const answered = (questions || []).filter((q) => q.answer);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>向講師提問</DialogTitle>
          <DialogDescription>問題會私下送給講師，回覆後會公開在這裡（不顯示你的名字）。</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Textarea
            value={text}
            maxLength={VIEWER_QUESTION_MAX_LENGTH}
            onChange={(e) => setText(e.target.value)}
            placeholder="想問講師什麼？"
            data-testid="input-viewer-question"
          />
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">{text.length}/{VIEWER_QUESTION_MAX_LENGTH}</span>
            <Button
              size="sm"
              disabled={!text.trim() || ask.isPending}
              onClick={() => ask.mutate(text.trim())}
              data-testid="button-submit-viewer-question"
            >
              {ask.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              送出問題
            </Button>
          </div>
          {notice && (
            <p className={`text-xs ${notice.kind === "ok" ? "text-muted-foreground" : "text-destructive"}`} role="status">
              {notice.text}
            </p>
          )}
        </div>
        <div className="border-t pt-3">
          <p className="text-sm font-medium mb-2">已回覆的問題</p>
          {isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          ) : answered.length === 0 ? (
            <p className="text-xs text-muted-foreground">目前還沒有回覆。</p>
          ) : (
            <ScrollArea className="max-h-[40vh]">
              <div className="space-y-3 pr-2">
                {answered.map((q) => (
                  <div key={q.id} className="text-sm" data-testid={`viewer-qa-${q.id}`}>
                    <p className="font-medium">{q.question}</p>
                    <p className="mt-1 pl-3 border-l-2 border-primary text-muted-foreground whitespace-pre-wrap">{q.answer}</p>
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
