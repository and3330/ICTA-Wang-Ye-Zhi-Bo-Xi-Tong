import { AlertTriangle, CalendarClock, CircleOff, RefreshCw, ShieldX, VideoOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ViewerAccessKind } from "@/lib/watch-access-state";

type ViewerAccessStateProps = {
  kind: ViewerAccessKind;
  title: string;
  startsAt?: string | Date | null;
  timezone?: string | null;
  compact?: boolean;
  onRetry?: () => void;
  onRegister?: () => void;
};

const content: Record<Exclude<ViewerAccessKind, "verified">, { label: string; heading: string; body: string; icon: typeof CalendarClock; tone: "default" | "warning" | "danger" }> = {
  verifying: { label: "正在確認觀看資格", heading: "請稍候，正在確認存取資格", body: "為了保護本場內容，確認完成前不會載入影片。", icon: RefreshCw, tone: "default" },
  upcoming: { label: "尚未開放", heading: "這一場還沒開始", body: "請在指定時間回到此頁面；開放後會自動更新觀看資格。", icon: CalendarClock, tone: "warning" },
  expired: { label: "觀看期限已結束", heading: "本場次目前已無法觀看", body: "您的觀看時段可能已結束。若您認為這是誤判，請重新確認資格。", icon: CircleOff, tone: "warning" },
  unavailable: { label: "內容暫時無法使用", heading: "此直播目前未開放觀看", body: "可能尚未發布、已下架，或需要先完成報名與場次選擇。", icon: VideoOff, tone: "warning" },
  revoked: { label: "觀看資格已失效", heading: "您已無法觀看這場直播", body: "此連結的觀看資格已失效或被撤銷。為保護內容，播放已停止。", icon: ShieldX, tone: "danger" },
  "verification-failed": { label: "暫時無法確認資格", heading: "目前無法安全驗證觀看資格", body: "網路或服務暫時沒有回應。影片已暫停，請恢復連線後再試一次。", icon: AlertTriangle, tone: "danger" },
};

export function ViewerAccessState({ kind, title, startsAt, timezone, compact = false, onRetry, onRegister }: ViewerAccessStateProps) {
  if (kind === "verified") return null;
  const item = content[kind];
  const Icon = item.icon;
  const startLabel = startsAt ? new Date(startsAt).toLocaleString("zh-TW", { month: "long", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: timezone || "Asia/Taipei" }) : null;
  return (
    <section className={`watch-access-state ${compact ? "watch-access-state--compact" : ""}`} data-tone={item.tone} aria-live="polite" aria-atomic="true">
      <div className="watch-access-state__mark">{kind === "verifying" ? <RefreshCw className="h-6 w-6 animate-spin" aria-hidden="true" /> : <Icon className="h-6 w-6" aria-hidden="true" />}</div>
      <p className="watch-access-state__title">{item.label}</p>
      <h1>{title || item.heading}</h1>
      <p className="watch-access-state__body">{item.body}</p>
      {kind === "upcoming" && startLabel && <p className="watch-access-state__meta">預計開放：{startLabel}（{timezone || "Asia/Taipei"}）</p>}
      {(onRetry || onRegister) && <div className="watch-access-state__actions">
        {onRetry && <Button type="button" variant={kind === "revoked" ? "outline" : "default"} onClick={onRetry}><RefreshCw className="mr-2 h-4 w-4" />重新確認</Button>}
        {onRegister && <Button type="button" variant="outline" onClick={onRegister}>前往報名</Button>}
      </div>}
    </section>
  );
}