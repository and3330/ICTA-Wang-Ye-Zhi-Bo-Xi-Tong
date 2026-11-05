import { useEffect, useRef, useState } from "react";
import type { ActivePoll } from "./viewer-interactions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Loader2 } from "lucide-react";

type ChatPollCardProps = {
  active: ActivePoll;
  results: Record<number, number> | null;
  onVote: (optionIndex: number) => boolean;
};

export function ChatPollCard({ active, results, onVote }: ChatPollCardProps) {
  const pollId = String(active.poll.id);
  const options = (active.poll.options as string[] | undefined) ?? [];
  const safePollId = encodeURIComponent(pollId);
  const questionId = `chat-poll-${safePollId}-question`;
  const groupId = `chat-poll-${safePollId}-options`;

  const [selected, setSelected] = useState<number | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [skipped, setSkipped] = useState(false);
  const [expired, setExpired] = useState(false);
  const [notice, setNotice] = useState("");
  const deadlineRef = useRef<number | null>(null);
  const onVoteRef = useRef(onVote);
  onVoteRef.current = onVote;

  useEffect(() => {
    setSelected(null);
    setSubmitted(false);
    setSkipped(false);
    setExpired(false);
    setNotice("");
    deadlineRef.current = null;
  }, [pollId]);

  useEffect(() => {
    if (submitted) {
      deadlineRef.current = null;
      return;
    }

    const duration = Math.max(0, active.seconds) * 1000;
    const deadline = Date.now() + duration;
    deadlineRef.current = deadline;

    if (duration === 0) {
      setExpired(true);
      return;
    }

    const timer = window.setTimeout(() => {
      setExpired(true);
    }, duration);

    return () => {
      window.clearTimeout(timer);
      if (deadlineRef.current === deadline) deadlineRef.current = null;
    };
  }, [pollId, active.seconds, submitted]);

  const isClosed = expired || skipped;
  const total = results
    ? Object.values(results).reduce((sum, count) => sum + count, 0)
    : 0;

  const submitVote = () => {
    if (selected === null || submitted || skipped || expired) return;
    const deadline = deadlineRef.current;
    if (deadline !== null && Date.now() >= deadline) {
      setExpired(true);
      return;
    }

    if (onVoteRef.current(selected)) {
      setSubmitted(true);
      setNotice("");
    } else {
      setNotice("連線中斷，請稍後再試。");
    }
  };

  return (
    <Card className="w-full min-w-0 overflow-hidden rounded-lg border-card-border bg-card shadow-none" data-testid={`chat-poll-${pollId}`}>
      <CardHeader className="space-y-1 px-3.5 pb-2 pt-3">
        <CardTitle className="text-xs font-semibold tracking-wide text-muted-foreground">
          小幫手 · 投票
        </CardTitle>
        <p id={questionId} className="break-words text-sm font-semibold leading-5 text-card-foreground">
          {active.poll.question}
        </p>
      </CardHeader>

      <CardContent className="space-y-3 px-3.5 pb-3.5 pt-0">
        {submitted ? (
          results === null ? (
            <div className="flex items-center gap-2 py-1 text-xs text-muted-foreground" role="status">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              <span>已送出，正在統計…</span>
            </div>
          ) : (
            <div className="space-y-2" aria-live="polite" aria-atomic="true">
              {options.map((option, index) => {
                const count = results[index] ?? 0;
                const percentage = total > 0 ? Math.round((count / total) * 100) : 0;
                return (
                  <div key={`${index}-${option}`} className="min-w-0">
                    <div className="mb-1 flex min-w-0 items-start justify-between gap-3 text-xs">
                      <span className="min-w-0 break-words">{option}</span>
                      <span className="shrink-0 tabular-nums text-muted-foreground">
                        {percentage}% <span className="sr-only">（{count} 票）</span>
                      </span>
                    </div>
                    <div
                      className="h-1.5 overflow-hidden rounded-full bg-muted"
                      role="img"
                      aria-label={`${option}：${percentage}%，${count} 票`}
                    >
                      <div
                        className="h-full rounded-full bg-primary"
                        style={{ width: `${percentage}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )
        ) : expired ? (
          <p className="rounded-md bg-muted/70 px-2.5 py-2 text-xs font-medium text-muted-foreground" role="status">
            投票已結束
          </p>
        ) : skipped ? (
          <p className="rounded-md bg-muted/70 px-2.5 py-2 text-xs text-muted-foreground" role="status">
            已略過此投票
          </p>
        ) : (
          <>
            <fieldset className="min-w-0 space-y-2">
              <legend className="sr-only">選擇一個選項</legend>
              <RadioGroup
                id={groupId}
                aria-labelledby={questionId}
                value={selected === null ? "" : String(selected)}
                onValueChange={(value) => {
                  setSelected(Number(value));
                  setNotice("");
                }}
                className="gap-1.5"
              >
                {options.map((option, index) => {
                  const optionId = `chat-poll-${safePollId}-option-${index}`;
                  return (
                    <div
                      key={`${index}-${option}`}
                      className="flex min-w-0 items-start gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-muted/60"
                    >
                      <RadioGroupItem
                        id={optionId}
                        value={String(index)}
                        className="mt-0.5 h-4 w-4 shrink-0"
                      />
                      <Label
                        htmlFor={optionId}
                        className="min-w-0 cursor-pointer break-words text-xs font-normal leading-4"
                      >
                        {option}
                      </Label>
                    </div>
                  );
                })}
              </RadioGroup>
            </fieldset>
            {notice && (
              <p className="text-xs text-destructive" role="alert">
                {notice}
              </p>
            )}
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 flex-1 px-2 text-xs"
                onClick={() => {
                  setSkipped(true);
                  setSelected(null);
                  setNotice("");
                }}
              >
                略過
              </Button>
              <Button
                type="button"
                size="sm"
                className="h-8 flex-1 px-2 text-xs"
                disabled={selected === null || isClosed}
                onClick={submitVote}
              >
                提交投票
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
