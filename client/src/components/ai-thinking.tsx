import { useCallback, useEffect, useRef, useState } from "react";

/** Longest the indicator stays up if the server never says the answer is done. */
const AI_THINKING_MAX_MS = 75_000;

/** Tracks the server's "aiThinking" signal for this viewer, with a safety timeout. */
export function useAiThinking() {
  const [thinking, setThinking] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const update = useCallback((active: boolean) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = active ? setTimeout(() => setThinking(false), AI_THINKING_MAX_MS) : null;
    setThinking(active);
  }, []);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  return [thinking, update] as const;
}

export function AiThinkingIndicator({ className = "" }: { className?: string }) {
  return (
    <div className={`flex items-center gap-2 text-xs text-muted-foreground ${className}`} role="status" data-testid="ai-thinking">
      <span className="flex gap-0.5" aria-hidden>
        <span className="h-1.5 w-1.5 rounded-full bg-current animate-bounce [animation-delay:-0.3s]" />
        <span className="h-1.5 w-1.5 rounded-full bg-current animate-bounce [animation-delay:-0.15s]" />
        <span className="h-1.5 w-1.5 rounded-full bg-current animate-bounce" />
      </span>
      AI 助教思考中…
    </div>
  );
}
