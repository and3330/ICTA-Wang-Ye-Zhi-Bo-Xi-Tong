import { useEffect, useState } from "react";
import { Radio } from "lucide-react";

function parts(msLeft: number) {
  const total = Math.max(0, Math.floor(msLeft / 1000));
  return {
    minutes: String(Math.floor(total / 60)).padStart(2, "0"),
    seconds: String(total % 60).padStart(2, "0"),
    done: total === 0,
  };
}

/**
 * The room before the start: opens up to 30 minutes early and counts down.
 * When the time comes the page's watch-state check lets the viewer in.
 */
export function WaitingLobby({ title, startsAt, timezone, logo, style }: {
  title: string;
  startsAt: string | Date;
  timezone?: string | null;
  logo?: string | null;
  style?: React.CSSProperties;
}) {
  const startMs = new Date(startsAt).getTime();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const left = parts(startMs - now);
  const startLabel = new Date(startsAt).toLocaleString("zh-TW", {
    month: "long", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: timezone || "Asia/Taipei",
  });

  return (
    <div className="waiting-lobby" style={style} data-testid="waiting-lobby">
      <div className="waiting-lobby__card">
        {logo && <img src={logo} alt="" className="waiting-lobby__logo" />}
        <p className="waiting-lobby__eyebrow"><Radio className="h-3.5 w-3.5" aria-hidden /> 直播即將開始</p>
        <h1>{title}</h1>
        <div className="waiting-lobby__clock" role="timer" aria-live="off" aria-label={`距離開播 ${left.minutes} 分 ${left.seconds} 秒`}>
          <span><b>{left.minutes}</b><small>分</small></span>
          <i aria-hidden>:</i>
          <span><b>{left.seconds}</b><small>秒</small></span>
        </div>
        <p className="waiting-lobby__note" aria-live="polite">
          {left.done ? "直播開始中，畫面會自動切換…" : "時間到會自動開始，請保持此頁面開啟。"}
        </p>
        <p className="waiting-lobby__meta">開播時間：{startLabel}</p>
      </div>
    </div>
  );
}
