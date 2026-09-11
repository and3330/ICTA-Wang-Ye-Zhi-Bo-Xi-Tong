import { useEffect, useRef, useState } from "react";
import type {
  EntitlementOverrideDto,
  MemberProfileDto,
  SubscriptionDto,
} from "@shared/adminManagement";

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
    options?: { onSuccess?: (response: any) => void },
  ) => void;
};

type MemberOperationsProps = {
  memberId: string;
  profile: MemberProfileDto;
  subscription?: SubscriptionDto | null;
  override?: EntitlementOverrideDto | null;
  canWrite: boolean;
  canDisable: boolean;
  canCredit: boolean;
  canRoles: boolean;
  canSubscriptions: boolean;
  action: Action;
};

export function MemberOperations({
  memberId,
  profile,
  subscription,
  override,
  canWrite,
  canDisable,
  canCredit,
  canRoles,
  canSubscriptions,
  action,
}: MemberOperationsProps) {
  const [reason, setReason] = useState("");
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

  const run = (method: string, url: string, data: Record<string, unknown>) => {
    if (!reason.trim()) return;
    action.mutate({
      method,
      url,
      data: { ...data, reason: reason.trim() },
    });
  };
  const confirmHighRisk = (summary: string) =>
    window.confirm(`請確認高風險操作\n\n${summary}\n\n此操作會留下稽核紀錄。`);
  const submitAiGrant = () => {
    if (!reason.trim()) return;
    const expiresAt = expires ? new Date(expires).toISOString() : undefined;
    const fingerprint = `${memberId}:${points}:${expiresAt || ""}:${reason.trim()}`;
    if (aiGrantRequest.current?.fingerprint !== fingerprint) {
      aiGrantRequest.current = { fingerprint, key: crypto.randomUUID() };
    }
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
      { onSuccess: () => (aiGrantRequest.current = null) },
    );
  };

  return (
    <>
      <div className="mc-detail-grid">
        <div className="mc-card mc-panel">
          <h3>帳戶資料與角色</h3>
          <input
            className="mc-input"
            data-testid="management-company-input"
            readOnly={!canWrite}
            value={company}
            onChange={(event) => setCompany(event.target.value)}
            placeholder="公司名稱"
          />
          {canRoles && (
            <>
              <input
                className="mc-input"
                data-testid="management-username-input"
                readOnly={!canWrite}
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                placeholder="使用者名稱"
              />
              <input
                className="mc-input"
                type="email"
                data-testid="management-email-input"
                readOnly={!canWrite}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="Email"
              />
            </>
          )}
          <div className="mc-actions" style={{ marginTop: 8 }}>
            {canWrite && (
              <button
                type="button"
                className="mc-action"
                data-testid="management-profile-save"
                disabled={!reason.trim() || !!action.isPending}
                onClick={() =>
                  run("PATCH", `members/${memberId}/profile`, {
                    ...(canRoles ? { username, email } : {}),
                    companyName: company,
                  })
                }
              >
                儲存資料
              </button>
            )}
            {canRoles && (
              <>
                <select
                  className="mc-select"
                  aria-label="會員管理角色"
                  data-testid="management-role-select"
                  value={role}
                  onChange={(event) => setRole(event.target.value)}
                >
                  {Object.entries(roleLabels).map(([value, label]) => (
                    <option value={value} key={value}>
                      {label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="mc-action"
                  data-testid="management-role-save"
                  disabled={!reason.trim() || !!action.isPending}
                  onClick={() =>
                    confirmHighRisk(
                      `將 ${profile.username} 的管理角色變更為 ${
                        roleLabels[role] || role
                      }。`,
                    ) && run("PATCH", `members/${memberId}/role`, { role })
                  }
                >
                  變更管理角色
                </button>
              </>
            )}
          </div>
          <p className="mc-id">角色只影響後台權限，不會變更會員訂閱。</p>
        </div>
        <div className="mc-card mc-panel">
          <h3>帳戶安全</h3>
          <p className="mc-id">停用帳號不等於取消訂閱。</p>
          <div className="mc-actions">
            {canDisable && (
              <>
                <button
                  type="button"
                  className="mc-action danger"
                  data-testid="management-account-toggle"
                  disabled={profile.protectedRoot || !reason.trim() || !!action.isPending}
                  onClick={() =>
                    confirmHighRisk(
                      profile.isActive
                        ? `將停用 ${profile.username} 的管理帳戶。`
                        : `將恢復 ${profile.username} 的管理帳戶。`,
                    ) &&
                    run(
                      "POST",
                      `members/${memberId}/${profile.isActive ? "disable" : "enable"}`,
                      {},
                    )
                  }
                >
                  {profile.isActive ? "停用帳戶" : "啟用帳戶"}
                </button>
                <button
                  type="button"
                  className="mc-action"
                  data-testid="management-revoke-sessions"
                  disabled={!reason.trim() || !!action.isPending}
                  onClick={() => run("POST", `members/${memberId}/revoke-sessions`, {})}
                >
                  撤銷所有工作階段
                </button>
              </>
            )}
            {canWrite && (
              <button
                type="button"
                className="mc-action"
                data-testid="management-password-reset"
                disabled={!reason.trim() || !!action.isPending}
                onClick={() => run("POST", `members/${memberId}/password-reset`, {})}
              >
                寄送重設密碼流程
              </button>
            )}
          </div>
        </div>
        <div className="mc-card mc-panel">
          <h3>備註與標籤</h3>
          <textarea
            className="mc-input"
            data-testid="management-notes-input"
            readOnly={!canWrite}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="每行一則內部備註"
          />
          <input
            className="mc-input"
            data-testid="management-tags-input"
            readOnly={!canWrite}
            value={tags}
            onChange={(event) => setTags(event.target.value)}
            placeholder="標籤，以逗號分隔"
          />
          {canWrite && (
            <button
              type="button"
              className="mc-action"
              data-testid="management-notes-save"
              disabled={!reason.trim() || !!action.isPending}
              onClick={() =>
                run("PUT", `members/${memberId}/notes`, {
                  notes: notes.split("\n").filter(Boolean),
                  tags: tags
                    .split(",")
                    .map((value) => value.trim())
                    .filter(Boolean),
                })
              }
            >
              儲存備註
            </button>
          )}
        </div>
        {canSubscriptions && (
          <div className="mc-card mc-panel">
            <h3>訂閱、臨時權益與 AI</h3>
            <p className="mc-id">
              目前訂閱：{subscription?.plan || profile.subscriptionPlan || "—"} ·{" "}
              {subscription?.status || profile.subscriptionStatus || "—"}
            </p>
            {subscription?.providerEnvironment &&
              subscription.providerEnvironment !== "connected" && (
                <p className="mc-id mc-provider-inline" role="status">
                  Stripe 資料不可用
                </p>
              )}
            <p className="mc-id">
              手動覆寫是暫時的發布總容量；後端會取付費權益與覆寫容量的較高值，不會降低既有付費權益。
            </p>
            <div className="mc-actions">
              {subscription && (
                <button
                  type="button"
                  className="mc-action"
                  data-testid="management-subscription-toggle"
                  disabled={!reason.trim() || !!action.isPending}
                  onClick={() =>
                    (subscription.cancelAtPeriodEnd ||
                      confirmHighRisk(
                        `將在本期結束時取消 ${profile.username} 的訂閱。`,
                      )) &&
                    run(
                      "POST",
                      `subscriptions/${memberId}/${
                        subscription.cancelAtPeriodEnd ? "resume" : "cancel-at-period-end"
                      }`,
                      {},
                    )
                  }
                >
                  {subscription.cancelAtPeriodEnd ? "恢復續訂" : "期末取消"}
                </button>
              )}
              <input
                className="mc-input"
                type="number"
                min={1}
                max={999}
                data-testid="management-override-slots"
                value={slots}
                onChange={(event) => setSlots(event.target.value)}
                placeholder="發布總容量"
              />
              <input
                className="mc-input"
                type="datetime-local"
                data-testid="management-override-expires"
                value={expires}
                onChange={(event) => setExpires(event.target.value)}
              />
              <button
                type="button"
                className="mc-action"
                data-testid="management-override-grant"
                disabled={!reason.trim() || !expires || !!action.isPending}
                onClick={() =>
                  run("POST", `members/${memberId}/overrides`, {
                    publishingSlots: Number(slots),
                    expiresAt: new Date(expires).toISOString(),
                  })
                }
              >
                授予暫時發布總容量
              </button>
              {override && (
                <button
                  type="button"
                  className="mc-action danger"
                  data-testid="management-override-revoke"
                  disabled={!reason.trim() || !!action.isPending}
                  onClick={() =>
                    confirmHighRisk(
                      `將撤銷 ${profile.username} 的臨時發布容量覆寫。`,
                    ) &&
                    run("DELETE", `members/${memberId}/overrides/${override.id}`, {})
                  }
                >
                  撤銷覆寫
                </button>
              )}
            </div>
          </div>
        )}
        {canCredit && (
          <div className="mc-card mc-panel">
            <h3>AI 點數管理</h3>
            <div className="mc-actions">
              <input
                className="mc-input"
                type="number"
                min={1}
                max={100000}
                data-testid="management-ai-points-input"
                value={points}
                onChange={(event) => setPoints(event.target.value)}
                placeholder="點數"
              />
              <button
                type="button"
                className="mc-action primary"
                data-testid="management-ai-grant"
                disabled={!reason.trim() || !!action.isPending}
                onClick={submitAiGrant}
              >
                授予 AI 點數
              </button>
            </div>
          </div>
        )}
        <div className="mc-card mc-panel">
          <h3>敏感操作原因</h3>
          <textarea
            className="mc-input"
            data-testid="management-reason-input"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="必填，1 至 1000 字元"
            maxLength={1000}
          />
          <p className="mc-id">操作會交由後端授權及稽核。</p>
        </div>
      </div>
    </>
  );
}