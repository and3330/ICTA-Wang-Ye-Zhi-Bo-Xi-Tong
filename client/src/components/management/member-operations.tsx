import { useEffect, useRef, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { MemberManualPlanPanel } from "@/components/management/member-manual-plan-panel";
import type {
  EntitlementOverrideDto,
  MemberProfileDto,
  SubscriptionDto,
} from "@shared/adminManagement";
import type { EffectiveMemberPlanDto, MemberManualPlanDto } from "@shared/memberManualPlans";

const roleLabels: Record<string, string> = {
  member: "一般會員",
  support: "客服",
  billing: "帳務",
  read_only: "唯讀",
  super_admin: "超級管理員",
};

type Action = {
  isPending?: boolean;
  mutate: (
    value: { method?: string; url: string; data?: unknown },
    options?: {
      onSuccess?: (response: any) => void;
      onError?: (error: Error) => void;
      onSettled?: () => void;
    },
  ) => void;
};

type MemberOperationsProps = {
  memberId: string;
  profile: MemberProfileDto;
  subscription?: SubscriptionDto | null;
  override?: EntitlementOverrideDto | null;
  manualPlan?: MemberManualPlanDto | null;
  effectivePlan?: EffectiveMemberPlanDto | null;
  noCardTrial?: {
    state: "eligible" | "active" | "expired" | "ineligible" | "upgraded";
    startsAt: string | null;
    expiresAt: string | null;
    retentionUntil: string | null;
    remainingAI: number;
    usedAI: number;
  } | null;
  canWrite: boolean;
  canDisable: boolean;
  canCredit: boolean;
  canRoles: boolean;
  canSubscriptions: boolean;
  canReadSubscriptions: boolean;
  isRoot: boolean;
  action: Action;
  onConflict: () => void;
};

export function MemberOperations({
  memberId,
  profile,
  subscription,
  override,
  manualPlan,
  effectivePlan,
  noCardTrial,
  canWrite,
  canDisable,
  canCredit,
  canRoles,
  canSubscriptions,
  canReadSubscriptions,
  isRoot,
  action,
  onConflict,
}: MemberOperationsProps) {
  const { toast } = useToast();
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState("");
  const reasonInput = useRef<HTMLTextAreaElement>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [username, setUsername] = useState(profile.username || "");
  const [email, setEmail] = useState(profile.email || "");
  const [company, setCompany] = useState(profile.companyName || "");
  const [notes, setNotes] = useState(profile.notes.join("\n"));
  const [tags, setTags] = useState(profile.tags.join(", "));
  const [role, setRole] = useState<string>(profile.managementRole || "member");
  const [points, setPoints] = useState("100");
  const [expires, setExpires] = useState("");
  const [slots, setSlots] = useState("1");
  const aiGrantRequest = useRef<{ fingerprint: string; key: string } | null>(null);

  useEffect(() => {
    setUsername(profile.username || "");
    setEmail(profile.email || "");
    setCompany(profile.companyName || "");
    setNotes(profile.notes.join("\n"));
    setTags(profile.tags.join(", "));
    setRole(profile.managementRole || "member");
    aiGrantRequest.current = null;
  }, [profile.id]);

  const requireReason = () => {
    if (reason.trim()) return true;
    const message = "請先填寫此操作的原因，才能送出並保留稽核紀錄。";
    setReasonError(message);
    toast({ title: "需要操作原因", description: message, variant: "destructive" });
    reasonInput.current?.focus();
    return false;
  };
  const targetLocked = profile.protectedRoot && !isRoot;
  const run = (
    key: string,
    method: string,
    url: string,
    data: Record<string, unknown>,
    onSuccess?: (response: any) => void,
  ) => {
    if (!requireReason() || pendingAction) return;
    setPendingAction(key);
    action.mutate(
      { method, url, data: { ...data, reason: reason.trim() } },
      {
        onSuccess,
        onError: (error) =>
          toast({ title: "操作未完成", description: error.message, variant: "destructive" }),
        onSettled: () => setPendingAction(null),
      },
    );
  };
  const confirmHighRisk = (summary: string) =>
    window.confirm(`請確認高風險操作\n\n${summary}\n\n此操作會留下稽核紀錄。`);
  const submitAiGrant = () => {
    if (!requireReason() || pendingAction) return;
    const expiresAt = expires ? new Date(expires).toISOString() : undefined;
    const fingerprint = `${memberId}:${points}:${expiresAt || ""}:${reason.trim()}`;
    if (aiGrantRequest.current?.fingerprint !== fingerprint) {
      aiGrantRequest.current = { fingerprint, key: crypto.randomUUID() };
    }
    setPendingAction("ai-grant");
    action.mutate(
      {
        method: "POST",
        url: `members/${memberId}/ai-grants`,
        data: {
          points: Number(points),
          expiresAt,
          reason: reason.trim(),
          idempotencyKey: aiGrantRequest.current.key,
        },
      },
      {
        onSuccess: () => (aiGrantRequest.current = null),
        onError: (error) =>
          toast({ title: "無法授予 AI 點數", description: error.message, variant: "destructive" }),
        onSettled: () => setPendingAction(null),
      },
    );
  };

  return (
    <>
      <section className="mc-card mc-panel mc-reason-panel" aria-labelledby="management-reason-heading">
        <div className="mc-section-head">
          <div>
            <h3 id="management-reason-heading">操作原因</h3>
            <p>所有會變更會員、權益或帳務設定的操作都必須記錄原因。</p>
          </div>
          <span className={`mc-badge ${reason.trim() ? "" : "warn"}`} role="status">
            {reason.trim() ? "原因已填寫" : "請先填寫原因"}
          </span>
        </div>
        <label htmlFor="management-reason-input" className="sr-only">敏感操作原因（必填）</label>
        <textarea
          id="management-reason-input"
          ref={reasonInput}
          className="mc-input"
          data-testid="management-reason-input"
          aria-describedby="management-reason-help management-reason-error"
          aria-invalid={!!reasonError}
          value={reason}
          onChange={(event) => {
            setReason(event.target.value);
            if (event.target.value.trim()) setReasonError("");
          }}
          placeholder="必填，說明為何需要這項操作（1 至 1000 字元）"
          maxLength={1000}
        />
        <p id="management-reason-help" className="mc-id">點擊尚未填寫原因的操作時，系統會帶您回到這裡。</p>
        {reasonError && <p id="management-reason-error" className="mc-inline-error" role="alert">{reasonError}</p>}
      </section>

      {canReadSubscriptions && (
        <MemberManualPlanPanel
          memberId={memberId}
          manualPlan={manualPlan}
          effectivePlan={effectivePlan}
          paidPlan={subscription?.plan || profile.subscriptionPlan}
          paidStatus={subscription?.status || profile.subscriptionStatus}
          paidPeriodEnd={subscription?.currentPeriodEnd || profile.planExpiresAt}
          canWrite={canSubscriptions}
          protectedRoot={profile.protectedRoot}
          isRoot={isRoot}
          reason={reason}
          requireReason={requireReason}
          action={action}
          onConflict={onConflict}
        />
      )}
      {noCardTrial && (
        <section className="mc-card mc-panel" data-testid="management-no-card-trial-readonly">
          <h3>免信用卡試用（唯讀）</h3>
          <p className="mc-id">此為獨立試用權益，不會改變 Stripe 付費訂閱或 AI 點數批次。管理介面不能重設、延長或授予試用。</p>
          {noCardTrial.state === "upgraded" ? (
            <p className="mc-id">已升級為付費方案；後續 AI 與發布權益以付費訂閱或人工方案為準。免信用卡試用資料僅保留供稽核，不顯示到期警示或可重設操作。</p>
          ) : (
            <dl className="mc-plan-summary">
              <dt>狀態</dt><dd>{noCardTrial.state}</dd>
              <dt>開始時間</dt><dd>{noCardTrial.startsAt ? new Date(noCardTrial.startsAt).toLocaleString("zh-TW") : "—"}</dd>
              <dt>到期時間</dt><dd>{noCardTrial.expiresAt ? new Date(noCardTrial.expiresAt).toLocaleString("zh-TW") : "—"}</dd>
              <dt>AI 次數</dt><dd>{noCardTrial.remainingAI} 次剩餘（已用 {noCardTrial.usedAI} 次）</dd>
              <dt>資料保留至</dt><dd>{noCardTrial.retentionUntil ? new Date(noCardTrial.retentionUntil).toLocaleString("zh-TW") : "—"}</dd>
            </dl>
          )}
        </section>
      )}

      <div className="mc-detail-grid">
        <div className="mc-card mc-panel">
          <h3>帳戶資料與角色</h3>
          {!canWrite && <p className="mc-id">您的角色只能檢視帳戶資料。</p>}
          <input className="mc-input" data-testid="management-company-input" readOnly={!canWrite} value={company} onChange={(event) => setCompany(event.target.value)} placeholder="公司名稱" />
          <input className="mc-input" data-testid="management-username-input" readOnly={!canWrite} value={username} onChange={(event) => setUsername(event.target.value)} placeholder="使用者名稱" />
          <input className="mc-input" type="email" data-testid="management-email-input" readOnly={!canWrite} value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Email" />
          <div className="mc-actions" style={{ marginTop: 8 }}>
            {canWrite && (
              <button type="button" className="mc-action" data-testid="management-profile-save" disabled={pendingAction === "profile"} onClick={() => run("profile", "PATCH", `members/${memberId}/profile`, { username, email, companyName: company })}>
                儲存資料
              </button>
            )}
            {canRoles ? (
              <>
                <select className="mc-select" aria-label="會員管理角色" data-testid="management-role-select" value={role} disabled={pendingAction === "role"} onChange={(event) => setRole(event.target.value)}>
                  {Object.entries(roleLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
                </select>
                <button type="button" className="mc-action" data-testid="management-role-save" disabled={pendingAction === "role"} onClick={() => requireReason() && confirmHighRisk(`將 ${profile.username} 的管理角色變更為 ${roleLabels[role] || role}。`) && run("role", "PATCH", `members/${memberId}/role`, { role })}>
                  變更管理角色
                </button>
              </>
            ) : (
              <span className="mc-id">需要 members.roles 權限才能變更管理角色。</span>
            )}
          </div>
          <p className="mc-id">角色只影響後台權限，不會變更會員訂閱。</p>
        </div>
        <div className="mc-card mc-panel">
          <h3>帳戶安全</h3>
          <p className="mc-id">停用帳號不等於取消訂閱。</p>
          {targetLocked && <p className="mc-warning">此為受保護根帳戶；只有根管理員可變更帳戶安全或人工權益。</p>}
          {!canDisable && <p className="mc-id">您的角色沒有停用帳戶或撤銷工作階段的權限。</p>}
          <div className="mc-actions">
            {canDisable && (
              <>
                <button type="button" className="mc-action danger" data-testid="management-account-toggle" disabled={targetLocked || pendingAction === "account"} onClick={() => requireReason() && confirmHighRisk(profile.isActive ? `將停用 ${profile.username} 的管理帳戶。` : `將恢復 ${profile.username} 的管理帳戶。`) && run("account", "POST", `members/${memberId}/${profile.isActive ? "disable" : "enable"}`, {})}>
                  {profile.isActive ? "停用帳戶" : "啟用帳戶"}
                </button>
                <button type="button" className="mc-action" data-testid="management-revoke-sessions" disabled={targetLocked || pendingAction === "sessions"} onClick={() => run("sessions", "POST", `members/${memberId}/revoke-sessions`, {})}>
                  撤銷所有工作階段
                </button>
              </>
            )}
            {canWrite && <button type="button" className="mc-action" data-testid="management-password-reset" disabled={pendingAction === "password"} onClick={() => run("password", "POST", `members/${memberId}/password-reset`, {})}>寄送重設密碼流程</button>}
          </div>
        </div>
        <div className="mc-card mc-panel">
          <h3>備註與標籤</h3>
          <textarea className="mc-input" data-testid="management-notes-input" readOnly={!canWrite} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="每行一則內部備註" />
          <input className="mc-input" data-testid="management-tags-input" readOnly={!canWrite} value={tags} onChange={(event) => setTags(event.target.value)} placeholder="標籤，以逗號分隔" />
          {canWrite && <button type="button" className="mc-action" data-testid="management-notes-save" disabled={pendingAction === "notes"} onClick={() => run("notes", "PUT", `members/${memberId}/notes`, { notes: notes.split("\n").filter(Boolean), tags: tags.split(",").map((value) => value.trim()).filter(Boolean) })}>儲存備註</button>}
        </div>
        {canSubscriptions && (
          <div className="mc-card mc-panel">
            <h3>Stripe 付費訂閱與臨時容量</h3>
            <p className="mc-id">付費方案：{subscription?.plan || profile.subscriptionPlan || "—"} · {subscription?.status || profile.subscriptionStatus || "—"}</p>
            <p className="mc-id">僅下列按鈕會向 Stripe 請求期末取消或恢復續訂；人工方案不會影響 Stripe 的下一次扣款，也不會授予 AI 點數。</p>
            {subscription?.providerEnvironment && subscription.providerEnvironment !== "connected" && <p className="mc-id mc-provider-inline" role="status">Stripe 資料不可用</p>}
            <div className="mc-actions">
              {subscription && <button type="button" className="mc-action" data-testid="management-subscription-toggle" disabled={pendingAction === "subscription"} onClick={() => requireReason() && (subscription.cancelAtPeriodEnd || confirmHighRisk(`將在本期結束時取消 ${profile.username} 的 Stripe 訂閱。`)) && run("subscription", "POST", `subscriptions/${memberId}/${subscription.cancelAtPeriodEnd ? "resume" : "cancel-at-period-end"}`, {})}>{subscription.cancelAtPeriodEnd ? "恢復 Stripe 續訂" : "Stripe 期末取消"}</button>}
              <input className="mc-input" type="number" min={1} max={999} data-testid="management-override-slots" value={slots} onChange={(event) => setSlots(event.target.value)} placeholder="發布總容量" />
              <input className="mc-input" type="datetime-local" data-testid="management-override-expires" value={expires} onChange={(event) => setExpires(event.target.value)} />
              <button type="button" className="mc-action" data-testid="management-override-grant" disabled={!expires || pendingAction === "override"} onClick={() => run("override", "POST", `members/${memberId}/overrides`, { publishingSlots: Number(slots), expiresAt: new Date(expires).toISOString() })}>授予暫時發布總容量</button>
              {override && <button type="button" className="mc-action danger" data-testid="management-override-revoke" disabled={pendingAction === "override-revoke"} onClick={() => requireReason() && confirmHighRisk(`將撤銷 ${profile.username} 的臨時發布容量覆寫。`) && run("override-revoke", "DELETE", `members/${memberId}/overrides/${override.id}`, {})}>撤銷覆寫</button>}
            </div>
            <p className="mc-id">暫時發布總容量與人工方案不同；它只提高發布容量，後端取付費權益與覆寫容量的較高值。</p>
          </div>
        )}
        {canCredit && (
          <div className="mc-card mc-panel">
            <h3>AI 點數管理</h3>
            <div className="mc-actions">
              <input className="mc-input" type="number" min={1} max={100000} data-testid="management-ai-points-input" value={points} onChange={(event) => setPoints(event.target.value)} placeholder="點數" />
              <button type="button" className="mc-action primary" data-testid="management-ai-grant" disabled={pendingAction === "ai-grant"} onClick={submitAiGrant}>授予 AI 點數</button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}