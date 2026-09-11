import { useEffect, useRef, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import type {
  EffectiveMemberPlanDto,
  MemberManualPlanDto,
  MemberManualPlanKey,
} from "@shared/memberManualPlans";

type Action = {
  isPending?: boolean;
  mutate: (
    value: { method?: string; url: string; data?: unknown },
    options?: {
      onSuccess?: (response: MemberManualPlanDto) => void;
      onError?: (error: Error) => void;
      onSettled?: () => void;
    },
  ) => void;
};

type Props = {
  memberId: string;
  manualPlan?: MemberManualPlanDto | null;
  effectivePlan?: EffectiveMemberPlanDto | null;
  paidPlan?: string | null;
  paidStatus?: string | null;
  paidPeriodEnd?: string | null;
  canWrite: boolean;
  protectedRoot: boolean;
  isRoot: boolean;
  reason: string;
  requireReason: () => boolean;
  action: Action;
  onConflict: () => void;
};

const planOptions: Array<{ value: MemberManualPlanKey; label: string }> = [
  { value: "starter", label: "入門方案（Starter）" },
  { value: "growth", label: "成長方案（Growth）" },
  { value: "scale", label: "擴展方案（Scale）" },
];
const quickDurations = [["+1 天", 24], ["+7 天", 168], ["+30 天", 720]] as const;
const planLabel = (value: string | null | undefined) =>
  planOptions.find((item) => item.value === value)?.label ||
  ({ free: "免費方案", enterprise: "企業方案", legacy: "舊版方案" } as Record<string, string>)[value || ""] ||
  value ||
  "—";
const sourceLabel: Record<EffectiveMemberPlanDto["source"], string> = {
  paid: "Stripe 付費權益",
  manual: "人工方案授權",
  override: "臨時發布容量覆寫",
  free: "免費方案",
  enterprise: "企業方案",
};
const stateLabel: Record<MemberManualPlanDto["state"], string> = {
  pending: "尚未生效",
  active: "使用中",
  expired: "已到期",
  revoked: "已撤銷",
};
const paidStatusLabel: Record<string, string> = {
  active: "使用中",
  trialing: "試用中",
  canceled: "已取消",
  past_due: "待付款",
  unpaid: "未付款",
  incomplete: "待完成",
  incomplete_expired: "已失效",
  paused: "已暫停",
  none: "無付費訂閱",
};

const taipeiDate = (value: string | null | undefined) =>
  value
    ? new Intl.DateTimeFormat("zh-TW", {
        timeZone: "Asia/Taipei",
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(value))
    : "—";

const taipeiInput = (value: string) => {
  const pieces = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(value));
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    pieces.find((part) => part.type === type)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
};

const taipeiNow = () => taipeiInput(new Date().toISOString());
const taipeiIso = (value: string) => `${value}:00+08:00`;

export function MemberManualPlanPanel({
  memberId,
  manualPlan,
  effectivePlan,
  paidPlan,
  paidStatus,
  paidPeriodEnd,
  canWrite,
  protectedRoot,
  isRoot,
  reason,
  requireReason,
  action,
  onConflict,
}: Props) {
  const { toast } = useToast();
  const [plan, setPlan] = useState<MemberManualPlanKey>(manualPlan?.plan || "starter");
  const [startsAt, setStartsAt] = useState(manualPlan ? taipeiInput(manualPlan.startsAt) : taipeiNow());
  const [expiresAt, setExpiresAt] = useState(manualPlan ? taipeiInput(manualPlan.expiresAt) : "");
  const [hours, setHours] = useState("24");
  const [pending, setPending] = useState(false);
  const request = useRef<{ fingerprint: string; key: string } | null>(null);

  useEffect(() => {
    setPlan(manualPlan?.plan || "starter");
    setStartsAt(manualPlan ? taipeiInput(manualPlan.startsAt) : taipeiNow());
    setExpiresAt(manualPlan ? taipeiInput(manualPlan.expiresAt) : "");
    request.current = null;
  }, [manualPlan?.id, manualPlan?.version]);

  const setDuration = (requestedHours: number) => {
    const parsedHours = Math.max(1, Math.min(43800, Math.floor(requestedHours)));
    if (!Number.isFinite(parsedHours)) return;
    const currentExpiry = manualPlan?.expiresAt ? new Date(manualPlan.expiresAt).getTime() : 0;
    const base = Math.max(Date.now(), currentExpiry);
    setExpiresAt(taipeiInput(new Date(base + parsedHours * 60 * 60 * 1000).toISOString()));
  };

  const canEdit = canWrite && (!protectedRoot || isRoot);
  const save = () => {
    if (!canEdit || pending || !requireReason()) return;
    if (!startsAt || !expiresAt || new Date(taipeiIso(expiresAt)) <= new Date(taipeiIso(startsAt))) {
      toast({
        title: "請設定有效的開始與到期時間",
        description: "到期時間必須晚於開始時間。",
        variant: "destructive",
      });
      return;
    }
    const isUpdate = !!manualPlan && manualPlan.state !== "revoked";
    const summary = [
      `${isUpdate ? "更新" : "授予"}人工方案：${planOptions.find((item) => item.value === plan)?.label}`,
      `開始：${startsAt.replace("T", " ")}（台灣時間）`,
      `到期：${expiresAt.replace("T", " ")}（台灣時間）`,
      "此操作不會扣款、不會建立或變更 Stripe 訂閱。",
    ].join("\n");
    if (!window.confirm(`請確認\n\n${summary}\n\n原因會寫入稽核紀錄。`)) return;

    const fingerprint = `${isUpdate ? manualPlan?.version : "create"}:${plan}:${startsAt}:${expiresAt}:${reason.trim()}`;
    if (request.current?.fingerprint !== fingerprint) {
      request.current = { fingerprint, key: crypto.randomUUID() };
    }
    setPending(true);
    action.mutate(
      {
        method: isUpdate ? "PATCH" : "POST",
        url: `members/${memberId}/manual-plan`,
        data: isUpdate
          ? {
              plan,
              startsAt: taipeiIso(startsAt),
              expiresAt: taipeiIso(expiresAt),
              reason: reason.trim(),
              version: manualPlan!.version,
              idempotencyKey: request.current.key,
            }
          : {
              plan,
              startsAt: taipeiIso(startsAt),
              expiresAt: taipeiIso(expiresAt),
              reason: reason.trim(),
              idempotencyKey: request.current.key,
            },
      },
      {
        onSuccess: () => {
          request.current = null;
          toast({ title: isUpdate ? "人工方案已更新" : "人工方案已授予" });
        },
        onError: (error) => {
          if (String(error.message).startsWith("409:")) {
            toast({
              title: "方案資料已被其他管理員更新",
              description: "已重新取得最新資料，請確認後再儲存。",
              variant: "destructive",
            });
            onConflict();
          } else {
            toast({ title: "無法儲存人工方案", description: error.message, variant: "destructive" });
          }
        },
        onSettled: () => setPending(false),
      },
    );
  };

  const revoke = () => {
    if (!manualPlan || !canEdit || pending || !requireReason()) return;
    if (
      !window.confirm(
        `確認撤銷 ${planOptions.find((item) => item.value === manualPlan.plan)?.label || manualPlan.plan} 人工方案？\n\n這只會撤銷人工授權，不會取消或修改 Stripe 付費訂閱。`,
      )
    )
      return;
    const fingerprint = `revoke:${manualPlan.id}:${manualPlan.version}:${reason.trim()}`;
    if (request.current?.fingerprint !== fingerprint) {
      request.current = { fingerprint, key: crypto.randomUUID() };
    }
    setPending(true);
    action.mutate(
      {
        method: "DELETE",
        url: `members/${memberId}/manual-plan`,
        data: {
          reason: reason.trim(),
          version: manualPlan.version,
          idempotencyKey: request.current.key,
        },
      },
      {
        onSuccess: () => {
          request.current = null;
          toast({ title: "人工方案已撤銷", description: "Stripe 付費訂閱未受影響。" });
        },
        onError: (error) => {
          if (String(error.message).startsWith("409:")) {
            toast({
              title: "方案資料已被其他管理員更新",
              description: "已重新取得最新資料，請確認後再操作。",
              variant: "destructive",
            });
            onConflict();
          } else {
            toast({ title: "無法撤銷人工方案", description: error.message, variant: "destructive" });
          }
        },
        onSettled: () => setPending(false),
      },
    );
  };

  return (
    <section className="mc-card mc-panel mc-manual-plan" aria-labelledby="manual-plan-heading">
      <div className="mc-section-head">
        <div>
          <h3 id="manual-plan-heading">會員方案與使用期限</h3>
          <p>人工授權與付費帳務分開；人工方案不會收費或變更 Stripe。</p>
        </div>
        <span className="mc-badge">{effectivePlan?.source === "manual" ? "人工權益生效" : "有效權益"}</span>
      </div>
      <dl className="mc-plan-summary">
        <div>
          <dt>目前有效權益</dt>
          <dd>
            {planLabel(effectivePlan?.plan)} · {effectivePlan ? sourceLabel[effectivePlan.source] : "—"}
            {effectivePlan ? ` · 直播 ${effectivePlan.maxWebinars}` : ""}
          </dd>
        </div>
        <div>
          <dt>Stripe 付費狀態</dt>
          <dd>{planLabel(paidPlan)} · {paidStatusLabel[paidStatus || ""] || paidStatus || "—"} · 到期 {taipeiDate(paidPeriodEnd)}</dd>
        </div>
        <div>
          <dt>人工授權</dt>
          <dd>
            {manualPlan
              ? `${planLabel(manualPlan.plan)} · ${stateLabel[manualPlan.state]} · ${taipeiDate(manualPlan.startsAt)} 至 ${taipeiDate(manualPlan.expiresAt)}`
              : "目前沒有人工方案"}
          </dd>
        </div>
      </dl>
      {!canWrite && <p className="mc-id">您的角色僅能檢視方案，無法變更人工授權；請洽具備方案管理權限的管理員。</p>}
      {protectedRoot && !isRoot && <p className="mc-warning">此為受保護根帳戶；只有根管理員能變更人工方案。</p>}
      <div className="mc-manual-controls">
        <label>
          人工方案
          <select
            className="mc-select"
            data-testid="management-manual-plan-select"
            value={plan}
            disabled={!canEdit || pending}
            onChange={(event) => setPlan(event.target.value as MemberManualPlanKey)}
          >
            {planOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <label>
          開始時間（台灣時間 UTC+08:00）
          <input
            className="mc-input"
            type="datetime-local"
            data-testid="management-manual-plan-starts-at"
            value={startsAt}
            disabled={!canEdit || pending}
            onChange={(event) => setStartsAt(event.target.value)}
          />
        </label>
        <label>
          到期時間（台灣時間 UTC+08:00）
          <input
            className="mc-input"
            type="datetime-local"
            data-testid="management-manual-plan-expires-at"
            value={expiresAt}
            disabled={!canEdit || pending}
            onChange={(event) => setExpiresAt(event.target.value)}
          />
        </label>
      </div>
      <div className="mc-actions mc-manual-quick">
        <label>
          快速延長時數
          <input
            className="mc-input"
            type="number"
            min={1}
            max={43800}
            data-testid="management-manual-plan-hours"
            value={hours}
            disabled={!canEdit || pending}
            onChange={(event) => setHours(event.target.value)}
          />
        </label>
        <button type="button" className="mc-action" disabled={!canEdit || pending} onClick={() => setDuration(Number(hours))}>
          加入時數
        </button>
        {quickDurations.map(([label, duration]) => (
          <button type="button" className="mc-action" disabled={!canEdit || pending} onClick={() => setDuration(duration)} key={label}>
            {label}
          </button>
        ))}
        <button type="button" className="mc-action primary" data-testid="management-manual-plan-save" disabled={!canEdit || pending} onClick={save}>
          {manualPlan && manualPlan.state !== "revoked" ? "更新人工方案" : "授予人工方案"}
        </button>
        {manualPlan && manualPlan.state !== "revoked" && (
          <button type="button" className="mc-action danger" data-testid="management-manual-plan-revoke" disabled={!canEdit || pending} onClick={revoke}>
            撤銷人工方案
          </button>
        )}
      </div>
      <p className="mc-id">快速延長會從目前時間與既有到期時間較晚者計算；可直接調整日期以排程未來開始。</p>
    </section>
  );
}