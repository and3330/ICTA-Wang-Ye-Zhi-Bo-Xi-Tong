import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation, useSearch } from "wouter";
import {
  BookOpen,
  CircleDollarSign,
  CreditCard,
  FileSearch,
  LayoutDashboard,
  Menu,
  PackageCheck,
  ShieldCheck,
  Users,
} from "lucide-react";
import {
  useAiLedger,
  useAudit,
  useManagementAction,
  useManagementCatalog,
  useManagementMe,
  useManagementOverview,
  useCourseMarketplaceQueue,
  useMember,
  useMembers,
  useOrders,
  useSubscriptions,
  useSupport,
  type ListFilters,
} from "@/hooks/use-management";
import type {
  AuditEventDto,
  CollectionAvailabilityDto,
  ManagementPermission,
  OrderDto,
  SupportCaseDto,
} from "@shared/adminManagement";
import type { CourseMarketplaceManagementItemDto } from "@shared/courseMarketplace";
import { useToast } from "@/hooks/use-toast";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import { MemberOperations } from "@/components/management/member-operations";

type Section =
  | "overview"
  | "members"
  | "subscriptions"
  | "orders"
  | "catalog"
  | "support"
  | "roles"
  | "audit"
  | "course-marketplace";

const sections: Section[] = [
  "overview",
  "members",
  "subscriptions",
  "orders",
  "catalog",
  "support",
  "roles",
  "audit",
  "course-marketplace",
];

const nav: Array<{
  id: Section;
  label: string;
  icon: typeof Users;
  permission: ManagementPermission;
}> = [
  {
    id: "overview",
    label: "營運總覽",
    icon: LayoutDashboard,
    permission: "members.read",
  },
  {
    id: "members",
    label: "會員中心",
    icon: Users,
    permission: "members.read",
  },
  {
    id: "subscriptions",
    label: "訂閱與權益",
    icon: CreditCard,
    permission: "subscriptions.read",
  },
  {
    id: "orders",
    label: "金流訂單",
    icon: CircleDollarSign,
    permission: "billing.read",
  },
  {
    id: "catalog",
    label: "方案目錄",
    icon: PackageCheck,
    permission: "subscriptions.read",
  },
  {
    id: "support",
    label: "客服案件",
    icon: BookOpen,
    permission: "support.read",
  },
  {
    id: "roles",
    label: "管理角色",
    icon: ShieldCheck,
    permission: "members.roles",
  },
  {
    id: "audit",
    label: "操作稽核",
    icon: FileSearch,
    permission: "audit.read",
  },
  {
    id: "course-marketplace",
    label: "課程廣場審核",
    icon: PackageCheck,
    permission: "course_marketplace.read",
  },
];

const supportStatuses = [
  { value: "", label: "所有狀態" },
  { value: "open", label: "待處理" },
  { value: "in_progress", label: "處理中" },
  { value: "resolved", label: "已解決" },
  { value: "closed", label: "已關閉" },
] as const;

const orderKinds = [
  { value: "platform_invoice", label: "平台訂閱發票" },
  { value: "ai_purchase", label: "AI 點數購買" },
  { value: "member_order", label: "會員商店訂單" },
] as const;

const auditActions = [
  { value: "", label: "所有操作" },
  { value: "member.profile.update", label: "更新會員資料" },
  { value: "member.role.update", label: "變更管理角色" },
  { value: "member.disable", label: "停用會員" },
  { value: "member.enable", label: "啟用會員" },
  { value: "member.sessions.revoke", label: "撤銷工作階段" },
  { value: "member.password_reset.request", label: "寄送重設密碼" },
  { value: "member.notes.update", label: "更新備註與標籤" },
  { value: "entitlement_override.create", label: "授予到期覆寫" },
  { value: "entitlement_override.delete", label: "撤銷到期覆寫" },
  { value: "ai_credit.grant", label: "授予 AI 點數" },
  { value: "subscription.cancel-at-period-end", label: "期末取消訂閱" },
  { value: "subscription.resume", label: "恢復訂閱" },
  { value: "stripe.invoice_refund.request", label: "請求 Stripe 發票退款" },
  { value: "stripe.refund.request", label: "請求 Stripe 退款" },
  { value: "ecpay.refund.external_note", label: "記錄 ECPay 外部退款備註" },
  { value: "support.update", label: "更新客服案件" },
  { value: "audit.export", label: "匯出稽核紀錄" },
] as const;

const roleLabels: Record<string, string> = {
  member: "一般會員",
  support: "客服",
  billing: "帳務",
  read_only: "唯讀",
  super_admin: "超級管理員",
};
const statusLabels: Record<string, string> = {
  active: "啟用",
  trialing: "試用中",
  incomplete: "待完成",
  incomplete_expired: "已過期",
  unpaid: "未付款",
  paused: "已暫停",
  canceled: "已取消",
  past_due: "待付款",
  paid: "已付款",
  refunded: "已退款",
  pending: "處理中",
  failed: "失敗",
  refund_pending: "退款處理中",
  refund_requested: "退款已送出",
  refund_failed: "退款失敗",
  succeeded: "已完成",
  open: "待處理",
  in_progress: "處理中",
  resolved: "已解決",
  closed: "已關閉",
};
const providerModeLabels: Record<string, string> = {
  connected: "已連線",
  production: "正式環境",
  stage: "測試環境",
  unknown: "未知環境",
};
const kindLabels: Record<string, string> = {
  platform_invoice: "平台訂閱發票",
  ai_purchase: "AI 點數購買",
  member_order: "會員商店訂單",
};
const providerLabels: Record<string, string> = {
  stripe: "Stripe",
  ecpay: "ECPay",
  local: "本地資料",
};

const date = (value: string | null | undefined) =>
  value
    ? new Date(value).toLocaleString("zh-TW", {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "—";
const money = (amount: number | null, currency: string | null) =>
  amount === null
    ? "—"
    : new Intl.NumberFormat("zh-TW", {
        style: "currency",
        currency: currency || "USD",
      }).format(amount / 100);
const labelFor = (labels: Record<string, string>, value: string | null | undefined) =>
  value ? labels[value] || value : "—";

function parseRoute(location: string) {
  const query = new URLSearchParams(location.split("?")[1] || "");
  const requested = query.get("section");
  const validSection = sections.includes(requested as Section);
  const section = validSection ? (requested as Section) : "overview";
  return {
    section,
    memberId: section === "members" ? query.get("member") || "" : "",
    invalid: requested !== null && !validSection,
  };
}

const Badge = ({
  children,
  tone = "",
}: {
  children: ReactNode;
  tone?: string;
}) => <span className={`mc-badge ${tone}`}>{children}</span>;

function DataState({
  loading,
  error,
  empty,
  children,
}: {
  loading: boolean;
  error: unknown;
  empty: boolean;
  children: ReactNode;
}) {
  if (loading) return <div className="mc-empty">正在取得授權資料</div>;
  if (error)
    return (
      <div className="mc-error" role="alert">
        無法讀取資料。請重新整理後再試。
      </div>
    );
  if (empty) return <div className="mc-empty">目前沒有符合條件的紀錄。</div>;
  return <>{children}</>;
}

function Pager({
  page,
  total,
  size,
  hasMore,
  setPage,
}: {
  page: number;
  total: number | null | undefined;
  size: number;
  hasMore?: boolean;
  setPage: (n: number) => void;
}) {
  const nextEnabled = total === null ? !!hasMore : page * size < (total || 0);
  return (
    <div className="mc-pagination">
      <span>
        第 {page} 頁
        {total === null || total === undefined ? "" : `，共 ${total} 筆`}
      </span>
      <div className="mc-actions">
        <button
          type="button"
          aria-label="上一頁"
          disabled={page <= 1}
          onClick={() => setPage(page - 1)}
        >
          上一頁
        </button>
        <button
          type="button"
          aria-label="下一頁"
          disabled={!nextEnabled}
          onClick={() => setPage(page + 1)}
        >
          下一頁
        </button>
      </div>
    </div>
  );
}

function Availability({
  availability,
}: {
  availability?: CollectionAvailabilityDto[];
}) {
  const unavailable = (availability || []).filter((entry) => !entry.available);
  if (!unavailable.length) return null;
  return (
    <div className="mc-provider-alerts" role="status" aria-live="polite">
      {unavailable.map((entry) => (
        <div
          className="mc-error mc-provider-alert"
          data-testid={`management-provider-unavailable-${entry.provider}`}
          key={`${entry.provider}-${entry.message || "unavailable"}`}
        >
          <strong>{providerLabels[entry.provider] || entry.provider} 目前無法使用</strong>
          <span>{entry.message || "目前無法取得供應商資料，並未將其視為空集合。"}</span>
        </div>
      ))}
    </div>
  );
}

function ProviderState({
  lookup,
  environment,
  provider = "stripe",
}: {
  lookup?: string;
  environment?: string;
  provider?: string;
}) {
  if (lookup !== "error" && lookup !== "unavailable" && environment !== "error" && environment !== "unavailable")
    return null;
  return (
    <div className="mc-id mc-provider-inline" role="status">
      {providerLabels[provider] || provider} 資料不可用
    </div>
  );
}

type FilterState = {
  members: {
    page: number;
    search: string;
    active: string;
    role: string;
    plan: string;
  };
  subscriptions: { page: number; search: string; status: string };
  orders: {
    page: number;
    search: string;
    status: string;
    kind: string;
    provider: string;
    from: string;
    to: string;
  };
  support: { page: number; search: string; status: string };
  audit: { page: number; action: string; targetUserId: string };
};

const initialFilters: FilterState = {
  members: { page: 1, search: "", active: "", role: "", plan: "" },
  subscriptions: { page: 1, search: "", status: "" },
  orders: {
    page: 1,
    search: "",
    status: "",
    kind: "platform_invoice",
    provider: "",
    from: "",
    to: "",
  },
  support: { page: 1, search: "", status: "" },
  audit: { page: 1, action: "", targetUserId: "" },
};

type FilterSection = keyof FilterState;

function useSectionFilters() {
  const [filters, setFilters] = useState<FilterState>(initialFilters);
  const update = (
    section: FilterSection,
    field: string,
    value: string | number,
  ) => {
    setFilters((current) => ({
      ...current,
      [section]: {
        ...current[section],
        [field]: value,
        ...(section === "orders" && field === "kind" ? { provider: "" } : {}),
        ...(field === "page" ? {} : { page: 1 }),
      },
    }));
  };
  return { filters, update };
}

function FilterSelect({
  value,
  onChange,
  options,
  "data-testid": testId,
  "aria-label": ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  options: ReadonlyArray<{ value: string; label: string }>;
  "data-testid"?: string;
  "aria-label"?: string;
}) {
  return (
    <select
      className="mc-select"
      aria-label={ariaLabel}
      data-testid={testId}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      {options.map((option) => (
        <option value={option.value} key={option.value || "all"}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

function Members({
  data,
  filters,
  update,
  open,
}: {
  data: any;
  filters: FilterState["members"];
  update: (field: string, value: string | number) => void;
  open: (id: string) => void;
}) {
  const result = data.data;
  const roleOptions = [
    { value: "", label: "所有管理角色" },
    ...Object.entries(roleLabels).map(([value, label]) => ({ value, label })),
  ];
  return (
    <section>
      <div className="mc-section-head">
        <div>
          <h2>會員帳戶</h2>
          <p>搜尋後開啟完整的付款、權益與使用脈絡。</p>
        </div>
      </div>
      <div className="mc-card">
        <div className="mc-toolbar">
          <input
            className="mc-input"
            data-testid="management-members-search"
            value={filters.search}
            onChange={(event) => update("search", event.target.value)}
            placeholder="搜尋姓名、Email 或識別碼"
          />
          <FilterSelect
            aria-label="會員狀態"
            data-testid="management-members-active-filter"
            value={filters.active}
            onChange={(value) => update("active", value)}
            options={[
              { value: "", label: "所有狀態" },
              { value: "true", label: "啟用" },
              { value: "false", label: "停用" },
            ]}
          />
          <FilterSelect
            aria-label="管理角色"
            data-testid="management-members-role-filter"
            value={filters.role}
            onChange={(value) => update("role", value)}
            options={roleOptions}
          />
          <input
            className="mc-input"
            aria-label="會員方案"
            data-testid="management-members-plan-filter"
            value={filters.plan}
            onChange={(event) => update("plan", event.target.value)}
            placeholder="方案 key"
          />
        </div>
        <DataState loading={data.isLoading} error={data.error} empty={!result?.items.length}>
          {result && (
            <div className="mc-table-wrap">
              <table className="mc-table">
                <thead>
                  <tr>
                    <th>會員</th>
                    <th>訂閱</th>
                    <th>AI 點數</th>
                    <th>直播間</th>
                    <th>狀態</th>
                  </tr>
                </thead>
                <tbody>
                  {result.items.map((item: any) => (
                    <tr key={item.id}>
                      <td>
                        <button
                          type="button"
                          className="mc-link"
                          data-testid={`management-member-open-${item.id}`}
                          onClick={() => open(item.id)}
                        >
                          {item.username}
                        </button>
                        <div className="mc-id">{item.email}</div>
                        {item.companyName && <div className="mc-id">{item.companyName}</div>}
                      </td>
                      <td>
                        {item.subscriptionPlan || "—"}
                        <div className="mc-id">{date(item.planExpiresAt)}</div>
                      </td>
                      <td>{item.aiPoints ?? "—"}</td>
                      <td>{item.webinarCount}</td>
                      <td>
                        <Badge tone={item.isActive ? "" : "danger"}>
                          {item.isActive ? "啟用" : "停用"}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <Pager
                page={result.page}
                total={result.total}
                size={result.pageSize}
                hasMore={result.hasMore}
                setPage={(page) => update("page", page)}
              />
            </div>
          )}
        </DataState>
      </div>
    </section>
  );
}

function Subscriptions({
  data,
  filters,
  update,
}: {
  data: any;
  filters: FilterState["subscriptions"];
  update: (field: string, value: string | number) => void;
}) {
  const result = data.data;
  return (
    <section>
      <div className="mc-section-head">
        <div>
          <h2>平台訂閱</h2>
          <p>顯示 SellCase 收取的平台訂閱，不含會員自有商店營收。</p>
        </div>
      </div>
      <div className="mc-card">
        <div className="mc-toolbar">
          <input
            className="mc-input"
            data-testid="management-subscriptions-search"
            value={filters.search}
            onChange={(event) => update("search", event.target.value)}
            placeholder="搜尋會員姓名或 Email"
          />
          <FilterSelect
            aria-label="訂閱狀態"
            data-testid="management-subscriptions-status-filter"
            value={filters.status}
            onChange={(value) => update("status", value)}
            options={[
              { value: "", label: "所有狀態" },
              { value: "active", label: "啟用中" },
              { value: "trialing", label: "試用中" },
              { value: "canceled", label: "已取消" },
              { value: "past_due", label: "待付款" },
            ]}
          />
        </div>
        <Availability availability={result?.availability} />
        <DataState loading={data.isLoading} error={data.error} empty={!result?.items.length}>
          {result && (
            <div className="mc-table-wrap">
              <table className="mc-table">
                <thead>
                  <tr>
                    <th>會員</th>
                    <th>方案 / 週期</th>
                    <th>金額</th>
                    <th>續期</th>
                    <th>狀態</th>
                  </tr>
                </thead>
                <tbody>
                  {result.items.map((item: any) => (
                    <tr key={item.userId}>
                      <td>
                        {item.username}
                        <div className="mc-id">{item.email}</div>
                      </td>
                      <td>
                        {item.plan || "—"} / {item.interval || "—"}
                      </td>
                      <td>
                        {money(item.amountMinor, item.currency)}
                        <div className="mc-id">{item.currency || "—"}</div>
                        <ProviderState environment={item.providerEnvironment} />
                      </td>
                      <td>
                        {date(item.currentPeriodEnd)}{" "}
                        {item.cancelAtPeriodEnd && (
                          <Badge tone="warn">期末取消</Badge>
                        )}
                      </td>
                      <td>
                        <Badge>{labelFor(statusLabels, item.status)}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <Pager
                page={result.page}
                total={result.total}
                size={result.pageSize}
                hasMore={result.hasMore}
                setPage={(page) => update("page", page)}
              />
            </div>
          )}
        </DataState>
      </div>
    </section>
  );
}

function OrderRows({
  items,
  refundable,
  onRefund,
}: {
  items: OrderDto[];
  refundable: boolean;
  onRefund?: (order: OrderDto) => void;
}) {
  return (
    <tbody>
      {items.map((item) => (
        <tr key={item.id}>
          <td>
            <Badge>{labelFor(kindLabels, item.kind)}</Badge>
          </td>
          <td>{item.ownerUsername || "—"}</td>
          <td>
            <Badge>{providerLabels[item.provider] || item.provider}</Badge>
            <div className="mc-id">{item.providerReference || item.id}</div>
            <div className="mc-id">
              {labelFor(providerModeLabels, item.providerMode)} ·{" "}
              {item.providerAccountLabel || "—"}
            </div>
            <ProviderState
              lookup={item.providerLookup}
              environment={item.providerEnvironment}
              provider={item.provider}
            />
          </td>
          <td>
            {money(item.amountMinor, item.currency)}
            <div className="mc-id">{item.currency}</div>
          </td>
          <td>
            <Badge>{labelFor(statusLabels, item.status)}</Badge>
            <div className="mc-id">狀態碼：{item.status}</div>
            {item.refundedMinor > 0 && (
              <div className="mc-id">
                已退款：{money(item.refundedMinor, item.currency)}
              </div>
            )}
            {refundable &&
              item.provider === "stripe" &&
              item.kind !== "ai_purchase" &&
              ["paid", "succeeded"].includes(item.status) &&
              item.amountMinor > item.refundedMinor &&
              onRefund && (
              <button
                type="button"
                className="mc-link"
                data-testid={`management-refund-open-${item.id}`}
                onClick={() => onRefund(item)}
              >
                退款
              </button>
            )}
            {item.provider === "ecpay" && (
              <div className="mc-id">請至商家 ECPay 後台處理</div>
            )}
            {item.kind === "ai_purchase" && (
              <div className="mc-id">AI 點數退款需人工核對付款與已使用點數，暫不提供直接退款。</div>
            )}
          </td>
          <td>
            {date(item.paidAt || item.createdAt)}
            {item.receiptUrl && (
              <a
                className="mc-link mc-receipt-link"
                href={item.receiptUrl}
                target="_blank"
                rel="noreferrer"
              >
                查看收據
              </a>
            )}
          </td>
        </tr>
      ))}
    </tbody>
  );
}

function Orders({
  data,
  filters,
  update,
  action,
  refundable,
}: {
  data: any;
  filters: FilterState["orders"];
  update: (field: string, value: string | number) => void;
  action: any;
  refundable: boolean;
}) {
  const result = data.data;
  const [order, setOrder] = useState<OrderDto | null>(null);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const refundRequest = useRef<{ fingerprint: string; key: string } | null>(null);
  const [refundPending, setRefundPending] = useState(false);
  const maxRefund = order ? order.amountMinor - order.refundedMinor : 0;
  const openRefund = (next: OrderDto) => {
    setOrder(next);
    setAmount(String(next.amountMinor - next.refundedMinor));
    setReason("");
    refundRequest.current = null;
    setRefundPending(false);
  };
  const submitRefund = () => {
    if (!order || !reason.trim() || Number(amount) < 1 || Number(amount) > maxRefund)
      return;
    const fingerprint = `${order.id}:${amount}:${reason.trim()}`;
    if (refundRequest.current?.fingerprint !== fingerprint) {
      refundRequest.current = { fingerprint, key: crypto.randomUUID() };
    }
    action.mutate({
      method: "POST",
      url: `orders/${order.id}/refunds`,
      data: {
        amountMinor: Number(amount),
        reason: reason.trim(),
        idempotencyKey: refundRequest.current.key,
      },
    }, {
      onSuccess: (response: { requested?: boolean }) => {
        // A 202 means the provider accepted the request; webhook reconciliation
        // still owns the eventual refunded status, so retain the request key.
        if (response?.requested) setRefundPending(true);
        else refundRequest.current = null;
      },
    });
  };
  return (
    <section>
      <div className="mc-warning">
        平台付款與會員自行透過 ECPay 收取的訂單分開呈現。ECPay 為外部商家金流，不能在此假造退款。
      </div>
      <div className="mc-card">
        <div className="mc-toolbar">
          <input
            className="mc-input"
            data-testid="management-orders-search"
            value={filters.search}
            onChange={(event) => update("search", event.target.value)}
            placeholder="搜尋會員、訂單或付款參考"
          />
          <FilterSelect
            aria-label="訂單狀態"
            data-testid="management-orders-status-filter"
            value={filters.status}
            onChange={(value) => update("status", value)}
            options={[
              { value: "", label: "所有狀態" },
              { value: "paid", label: "已付款" },
              { value: "succeeded", label: "已完成" },
              { value: "refunded", label: "已退款" },
              { value: "refund_pending", label: "退款處理中" },
              { value: "refund_requested", label: "退款已送出" },
              { value: "refund_failed", label: "退款失敗" },
              { value: "pending", label: "處理中" },
              { value: "failed", label: "失敗" },
            ]}
          />
          <FilterSelect
            aria-label="訂單類別"
            data-testid="management-orders-kind-filter"
            value={filters.kind}
            onChange={(value) => update("kind", value)}
            options={orderKinds}
          />
          <FilterSelect
            aria-label="付款供應商"
            data-testid="management-orders-provider-filter"
            value={filters.provider}
            onChange={(value) => update("provider", value)}
            options={
              filters.kind === "platform_invoice" || filters.kind === "ai_purchase"
                ? [{ value: "", label: "Stripe（此類別限定）" }]
                : [
                    { value: "", label: "所有供應商" },
                    { value: "stripe", label: "Stripe" },
                    { value: "ecpay", label: "ECPay" },
                  ]
            }
          />
          <label className="mc-filter-date">
            起始日期
            <input
              className="mc-input"
              type="date"
              data-testid="management-orders-from"
              value={filters.from}
              onChange={(event) => update("from", event.target.value)}
            />
          </label>
          <label className="mc-filter-date">
            結束日期
            <input
              className="mc-input"
              type="date"
              data-testid="management-orders-to"
              value={filters.to}
              onChange={(event) => update("to", event.target.value)}
            />
          </label>
        </div>
        <Availability availability={result?.availability} />
        <DataState loading={data.isLoading} error={data.error} empty={!result?.items.length}>
          {result && (
            <div className="mc-table-wrap">
              <table className="mc-table">
                <thead>
                  <tr>
                    <th>類別</th>
                    <th>會員</th>
                    <th>付款方</th>
                    <th>金額</th>
                    <th>狀態</th>
                    <th>付款時間</th>
                  </tr>
                </thead>
                <OrderRows
                  items={result.items}
                  refundable={refundable}
                  onRefund={openRefund}
                />
              </table>
              <Pager
                page={result.page}
                total={result.total}
                size={result.pageSize}
                hasMore={result.hasMore}
                setPage={(page) => update("page", page)}
              />
            </div>
          )}
        </DataState>
      </div>
      {order && (
        <div className="mc-card mc-panel" style={{ marginTop: 16 }}>
          <h3>確認 Stripe 退款</h3>
          {refundPending && (
            <div className="mc-warning" role="status">
              退款請求已送出，等待供應商確認；目前尚未標記為已退款。
            </div>
          )}
          <input
            className="mc-input"
            type="number"
            min={1}
            max={maxRefund}
            data-testid="management-refund-amount"
            value={amount}
            onChange={(event) => {
              setAmount(event.target.value);
              setRefundPending(false);
            }}
            placeholder="退款金額（最小單位）"
          />
          <input
            className="mc-input"
            data-testid="management-refund-reason"
            value={reason}
            onChange={(event) => {
              setReason(event.target.value);
              setRefundPending(false);
            }}
            placeholder="退款原因（必填）"
          />
          <div className="mc-actions">
            <button
              type="button"
              className="mc-action danger"
              data-testid="management-refund-confirm"
              disabled={
                !reason.trim() ||
                Number(amount) < 1 ||
                Number(amount) > maxRefund ||
                action.isPending
              }
              onClick={submitRefund}
            >
              確認請求退款
            </button>
            <button
              type="button"
              className="mc-action"
              data-testid="management-refund-cancel"
              onClick={() => setOrder(null)}
            >
              取消
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function Catalog({ data }: { data: any }) {
  const result = data.data;
  return (
    <DataState loading={data.isLoading} error={data.error} empty={!result}>
      {result && (
        <section>
          <div className="mc-section-head">
            <div>
              <h2>方案與基礎權益</h2>
              <p>此處僅供檢視目錄；會員的人工覆寫會顯示在個別帳戶中。</p>
            </div>
          </div>
          <div className="mc-card mc-table-wrap">
            <table className="mc-table">
              <thead>
                <tr>
                  <th>方案</th>
                  <th>月繳</th>
                  <th>年繳</th>
                  <th>直播間</th>
                  <th>每月 AI 點數</th>
                </tr>
              </thead>
              <tbody>
                {result.plans.map((item: any) => (
                  <tr key={item.key}>
                    <td>
                      <b>{item.label}</b>
                      <div className="mc-id">{item.key}</div>
                    </td>
                    <td>{money(item.monthlyAmountMinor, item.currency)}</td>
                    <td>{money(item.annualAmountMinor, item.currency)}</td>
                    <td>{item.baseWebinars}</td>
                    <td>{item.monthlyAiPoints}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </DataState>
  );
}

function Roles({ data }: { data: any }) {
  const result = data.data;
  return (
    <DataState loading={data.isLoading} error={data.error} empty={!result}>
      {result && (
        <section>
          <div className="mc-section-head">
            <div>
              <h2>管理角色與權限</h2>
              <p>角色變更不影響會員訂閱方案；後端仍會獨立驗證每個操作。</p>
            </div>
          </div>
          <div className="mc-card mc-table-wrap">
            <table className="mc-table">
              <thead>
                <tr>
                  <th>角色</th>
                  <th>授予權限</th>
                </tr>
              </thead>
              <tbody>
                {result.roles.map((item: any) => (
                  <tr key={item.role}>
                    <td>
                      <Badge>{roleLabels[item.role] || item.role}</Badge>
                      <div className="mc-id">{item.role}</div>
                    </td>
                    <td>{item.permissions.join(" · ") || "無額外權限"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </DataState>
  );
}

function Support({
  data,
  filters,
  update,
  action,
  writable,
}: {
  data: any;
  filters: FilterState["support"];
  update: (field: string, value: string | number) => void;
  action: any;
  writable: boolean;
}) {
  const result = data.data;
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  const updateStatus = (item: SupportCaseDto, status: string) => {
    if (!reason.trim()) return;
    action.mutate({
      url: `support/${item.id}`,
      data: { status, reason: reason.trim() },
    });
  };
  const updateNote = (item: SupportCaseDto) => {
    if (!reason.trim()) return;
    action.mutate({
      url: `support/${item.id}`,
      data: {
        adminNote: notes[item.id] ?? item.adminNote ?? "",
        reason: reason.trim(),
      },
    });
  };
  return (
    <section>
      <div className="mc-section-head">
        <div>
          <h2>客服案件</h2>
          <p>處理結果會保存管理員備註及更新時間。</p>
        </div>
      </div>
      {writable && (
        <input
          className="mc-input mc-reason-wide"
          data-testid="management-support-reason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="更新原因（必填）"
          maxLength={1000}
        />
      )}
      <div className="mc-card">
        <div className="mc-toolbar">
          <input
            className="mc-input"
            data-testid="management-support-search"
            value={filters.search}
            onChange={(event) => update("search", event.target.value)}
            placeholder="搜尋案件主旨或內容"
          />
          <FilterSelect
            aria-label="客服案件狀態"
            data-testid="management-support-status-filter"
            value={filters.status}
            onChange={(value) => update("status", value)}
            options={supportStatuses}
          />
        </div>
        <DataState loading={data.isLoading} error={data.error} empty={!result?.items.length}>
          {result && (
            <div className="mc-table-wrap">
              <table className="mc-table">
                <thead>
                  <tr>
                    <th>案件</th>
                    <th>會員</th>
                    <th>狀態</th>
                    <th>管理操作</th>
                  </tr>
                </thead>
                <tbody>
                  {result.items.map((item: SupportCaseDto) => (
                    <tr key={item.id}>
                      <td>
                        <b>{item.subject}</b>
                        <div className="mc-id">
                          {item.category} · {date(item.createdAt)}
                        </div>
                        <div>{item.message}</div>
                      </td>
                      <td>{item.username}</td>
                      <td>
                        <Badge>{labelFor(statusLabels, item.status)}</Badge>
                      </td>
                      <td>
                        {writable ? (
                          <div className="mc-actions">
                            <FilterSelect
                              aria-label={`案件 ${item.subject} 狀態`}
                              data-testid={`management-support-status-${item.id}`}
                              value={item.status}
                              onChange={(value) => updateStatus(item, value)}
                              options={supportStatuses.filter((option) => option.value)}
                            />
                            <input
                              className="mc-input"
                              data-testid={`management-support-note-${item.id}`}
                              value={notes[item.id] ?? item.adminNote ?? ""}
                              onChange={(event) =>
                                setNotes((current) => ({
                                  ...current,
                                  [item.id]: event.target.value,
                                }))
                              }
                              placeholder="內部備註"
                            />
                            <button
                              type="button"
                              className="mc-action"
                              data-testid={`management-support-save-${item.id}`}
                              disabled={!reason.trim() || action.isPending}
                              onClick={() => updateNote(item)}
                            >
                              儲存
                            </button>
                          </div>
                        ) : (
                          <span className="mc-id">唯讀</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <Pager
                page={result.page}
                total={result.total}
                size={result.pageSize}
                hasMore={result.hasMore}
                setPage={(page) => update("page", page)}
              />
            </div>
          )}
        </DataState>
      </div>
    </section>
  );
}

function Audit({
  data,
  filters,
  update,
  exportable,
}: {
  data: any;
  filters: FilterState["audit"];
  update: (field: string, value: string | number) => void;
  exportable: boolean;
}) {
  const result = data.data;
  const exportUrl = useMemo(() => {
    const query = new URLSearchParams();
    if (filters.targetUserId) query.set("targetUserId", filters.targetUserId);
    if (filters.action) query.set("action", filters.action);
    return `/api/management/audit/export.csv${query.size ? `?${query}` : ""}`;
  }, [filters.action, filters.targetUserId]);
  return (
    <section>
      <div className="mc-section-head">
        <div>
          <h2>操作稽核</h2>
          <p>可搜尋的管理異動紀錄，包含請求識別碼。</p>
        </div>
        {exportable && (
          <button
            type="button"
            className="mc-action primary"
            data-testid="management-audit-export"
            onClick={() => window.open(exportUrl, "_blank", "noopener,noreferrer")}
          >
            匯出目前稽核篩選
          </button>
        )}
      </div>
      <div className="mc-card">
        <div className="mc-toolbar">
          <input
            className="mc-input"
            data-testid="management-audit-target-filter"
            value={filters.targetUserId}
            onChange={(event) => update("targetUserId", event.target.value)}
            placeholder="目標會員 UUID"
          />
          <FilterSelect
            aria-label="稽核操作"
            data-testid="management-audit-action-filter"
            value={filters.action}
            onChange={(value) => update("action", value)}
            options={auditActions}
          />
        </div>
        <DataState loading={data.isLoading} error={data.error} empty={!result?.items.length}>
          {result && (
            <div className="mc-table-wrap">
              <table className="mc-table">
                <thead>
                  <tr>
                    <th>時間</th>
                    <th>操作</th>
                    <th>執行者</th>
                    <th>目標</th>
                    <th>原因 / request</th>
                  </tr>
                </thead>
                <tbody>
                  {result.items.map((item: AuditEventDto) => (
                    <tr key={item.id}>
                      <td>{date(item.createdAt)}</td>
                      <td>
                        <Badge>
                          {auditActions.find((option) => option.value === item.action)?.label ||
                            item.action}
                        </Badge>
                      </td>
                      <td className="mc-id">{item.actorUserId || "system"}</td>
                      <td className="mc-id">{item.targetUserId || "—"}</td>
                      <td>
                        {item.reason}
                        <div className="mc-id">{item.requestId || "—"}</div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <Pager
                page={result.page}
                total={result.total}
                size={result.pageSize}
                hasMore={result.hasMore}
                setPage={(page) => update("page", page)}
              />
            </div>
          )}
        </DataState>
      </div>
    </section>
  );
}

function MemberDetail({
  detail,
  memberId,
  back,
  canWrite,
  canDisable,
  canCredit,
  canRoles,
  canSubscriptions,
  canReadSubscriptions,
  isRoot,
  canReadCredits,
  canReadBilling,
  canReadSupport,
  canReadAudit,
  action,
}: {
  detail: any;
  memberId: string;
  back: () => void;
  canWrite: boolean;
  canDisable: boolean;
  canCredit: boolean;
  canRoles: boolean;
  canSubscriptions: boolean;
  canReadSubscriptions: boolean;
  isRoot: boolean;
  canReadCredits: boolean;
  canReadBilling: boolean;
  canReadSupport: boolean;
  canReadAudit: boolean;
  action: any;
}) {
  const detailData = detail.data;
  const [ledgerPage, setLedgerPage] = useState(1);
  const [memberOrderPage, setMemberOrderPage] = useState(1);
  const [memberOrderKind, setMemberOrderKind] = useState("platform_invoice");
  const [memberSupportPage, setMemberSupportPage] = useState(1);
  const [memberAuditPage, setMemberAuditPage] = useState(1);

  useEffect(() => {
    if (!detailData) return;
    setLedgerPage(1);
    setMemberOrderPage(1);
    setMemberOrderKind("platform_invoice");
    setMemberSupportPage(1);
    setMemberAuditPage(1);
  }, [detailData?.profile.id]);

  const ledger = useAiLedger(
    detailData?.profile.id || "",
    { page: ledgerPage, pageSize: 10 },
    canReadCredits,
  );
  const memberOrders = useOrders(
    {
      page: memberOrderPage,
      pageSize: 10,
      userId: detailData?.profile.id,
      kind: memberOrderKind,
    },
    canReadBilling && !!detailData?.profile.id,
  );
  const memberSupport = useSupport(
    {
      page: memberSupportPage,
      pageSize: 10,
      userId: detailData?.profile.id,
    },
    canReadSupport && !!detailData?.profile.id,
  );
  const memberAudit = useAudit(
    {
      page: memberAuditPage,
      pageSize: 10,
      targetUserId: detailData?.profile.id,
    },
    canReadAudit && !!detailData?.profile.id,
  );

  return (
    <section>
      <button type="button" className="mc-action" onClick={back}>
        返回會員列表
      </button>
      <DataState loading={detail.isLoading} error={detail.error} empty={!detailData}>
        {detailData && (
          <>
            <div className="mc-section-head" style={{ marginTop: 18 }}>
              <div>
                <h2>{detailData.profile.username}</h2>
                <p>
                  {detailData.profile.email} ·{" "}
                  <span className="mc-id">{detailData.profile.id}</span>
                </p>
              </div>
              <Badge tone={detailData.profile.isActive ? "" : "danger"}>
                {detailData.profile.isActive ? "帳戶啟用" : "帳戶停用"}
              </Badge>
            </div>
            {detailData.profile.protectedRoot && (
              <div className="mc-warning">
                此帳戶為受保護根帳戶；只有根管理員可執行敏感操作。
              </div>
            )}
            <MemberOperations
              key={memberId}
              memberId={memberId}
              profile={detailData.profile}
              subscription={detailData.subscription}
              override={detailData.override}
              canWrite={canWrite}
              canDisable={canDisable}
              canCredit={canCredit}
              canRoles={canRoles}
              canSubscriptions={canSubscriptions}
              canReadSubscriptions={canReadSubscriptions}
              isRoot={isRoot}
              manualPlan={detailData.manualPlan}
              effectivePlan={detailData.effectivePlan}
              noCardTrial={(detailData as typeof detailData & { noCardTrial?: { state: "eligible" | "active" | "expired" | "ineligible" | "upgraded"; startsAt: string | null; expiresAt: string | null; retentionUntil: string | null; remainingAI: number; usedAI: number } | null; trial?: { state: "eligible" | "active" | "expired" | "ineligible" | "upgraded"; startsAt: string | null; expiresAt: string | null; retentionUntil: string | null; remainingAI: number; usedAI: number } | null }).noCardTrial || (detailData as typeof detailData & { trial?: { state: "eligible" | "active" | "expired" | "ineligible" | "upgraded"; startsAt: string | null; expiresAt: string | null; retentionUntil: string | null; remainingAI: number; usedAI: number } | null }).trial}
              action={action}
              onConflict={() => detail.refetch()}
            />
            {canReadCredits && (
              <div className="mc-card mc-panel mc-member-section">
                <div className="mc-section-head">
                  <div>
                    <h3>AI 點數批次 / 帳本</h3>
                    <p>僅顯示後端已記錄的點數異動。</p>
                  </div>
                </div>
                {detailData.usage && (
                  <ul className="mc-list">
                    {detailData.usage.aiLots.map((item: any) => (
                      <li key={item.id}>
                        {item.remainingPoints}/{item.originalPoints} · {item.source} ·{" "}
                        {date(item.expiresAt)}
                      </li>
                    ))}
                  </ul>
                )}
                <DataState
                  loading={ledger.isLoading}
                  error={ledger.error}
                  empty={!ledger.data?.items.length}
                >
                  {ledger.data && (
                    <>
                      <ul className="mc-list">
                        {ledger.data.items.map((item: any) => (
                          <li key={item.id}>
                            {item.type} {item.points > 0 ? "+" : ""}
                            {item.points} · {item.source || "—"} ·{" "}
                            {date(item.createdAt)}
                          </li>
                        ))}
                      </ul>
                      <Pager
                        page={ledger.data.page}
                        total={ledger.data.total}
                        size={ledger.data.pageSize}
                        hasMore={ledger.data.hasMore}
                        setPage={setLedgerPage}
                      />
                    </>
                  )}
                </DataState>
              </div>
            )}

            {canReadBilling && (
              <div className="mc-card mc-panel mc-member-section">
                <div className="mc-section-head">
                  <div>
                    <h3>會員付款訂單</h3>
                    <p>僅顯示此會員的付款紀錄，供應商資料維持原幣別。</p>
                  </div>
                  <FilterSelect
                    aria-label="會員訂單類別"
                    data-testid="management-member-orders-kind-filter"
                    value={memberOrderKind}
                    onChange={(value) => {
                      setMemberOrderKind(value);
                      setMemberOrderPage(1);
                    }}
                    options={orderKinds}
                  />
                </div>
                <Availability availability={memberOrders.data?.availability} />
                <DataState
                  loading={memberOrders.isLoading}
                  error={memberOrders.error}
                  empty={!memberOrders.data?.items.length}
                >
                  {memberOrders.data && (
                    <div className="mc-table-wrap">
                      <table className="mc-table">
                        <thead>
                          <tr>
                            <th>類別</th>
                            <th>會員</th>
                            <th>付款方</th>
                            <th>金額</th>
                            <th>狀態</th>
                            <th>付款時間</th>
                          </tr>
                        </thead>
                        <OrderRows
                          items={memberOrders.data.items}
                          refundable={false}
                        />
                      </table>
                      <Pager
                        page={memberOrders.data.page}
                        total={memberOrders.data.total}
                        size={memberOrders.data.pageSize}
                        hasMore={memberOrders.data.hasMore}
                        setPage={setMemberOrderPage}
                      />
                    </div>
                  )}
                </DataState>
              </div>
            )}

            {canReadSupport && (
              <div className="mc-card mc-panel mc-member-section">
                <div className="mc-section-head">
                  <div>
                    <h3>會員客服案件</h3>
                    <p>客服更新請回到客服案件區，避免繞過案件權限。</p>
                  </div>
                </div>
                <DataState
                  loading={memberSupport.isLoading}
                  error={memberSupport.error}
                  empty={!memberSupport.data?.items.length}
                >
                  {memberSupport.data && (
                    <>
                      <ul className="mc-list">
                        {memberSupport.data.items.map((item: SupportCaseDto) => (
                          <li key={item.id}>
                            <b>{item.subject}</b> ·{" "}
                            {labelFor(statusLabels, item.status)} · {date(item.updatedAt)}
                            {item.adminNote && (
                              <div className="mc-id">管理員備註：{item.adminNote}</div>
                            )}
                          </li>
                        ))}
                      </ul>
                      <Pager
                        page={memberSupport.data.page}
                        total={memberSupport.data.total}
                        size={memberSupport.data.pageSize}
                        hasMore={memberSupport.data.hasMore}
                        setPage={setMemberSupportPage}
                      />
                    </>
                  )}
                </DataState>
              </div>
            )}

            {canReadAudit && (
              <div className="mc-card mc-panel mc-member-section">
                <div className="mc-section-head">
                  <div>
                    <h3>會員相關稽核</h3>
                    <p>此清單依目標會員 UUID 查詢。</p>
                  </div>
                </div>
                <DataState
                  loading={memberAudit.isLoading}
                  error={memberAudit.error}
                  empty={!memberAudit.data?.items.length}
                >
                  {memberAudit.data && (
                    <>
                      <ul className="mc-list">
                        {memberAudit.data.items.map((item: AuditEventDto) => (
                          <li key={item.id}>
                            {auditActions.find((option) => option.value === item.action)?.label ||
                              item.action}{" "}
                            · {date(item.createdAt)} · {item.reason}
                            <div className="mc-id">
                              {item.requestId || "無 request id"}
                            </div>
                          </li>
                        ))}
                      </ul>
                      <Pager
                        page={memberAudit.data.page}
                        total={memberAudit.data.total}
                        size={memberAudit.data.pageSize}
                        hasMore={memberAudit.data.hasMore}
                        setPage={setMemberAuditPage}
                      />
                    </>
                  )}
                </DataState>
              </div>
            )}
          </>
        )}
      </DataState>
    </section>
  );
}

function Overview({ data, select }: { data: any; select: (section: Section) => void }) {
  const result = data.data;
  return (
    <DataState loading={data.isLoading} error={data.error} empty={!result}>
      {result && (
        <>
          <div className="mc-metrics mc-card">
            {[
              [result.totals.users, "會員總數"],
              [result.totals.activeUsers, "啟用中"],
              [result.totals.disabledUsers, "已停用"],
              [result.totals.paidSubscriptions, "付費訂閱"],
              [result.totals.openSupportCases, "待處理客服"],
            ].map(([value, label]) => (
              <div className="mc-metric" key={String(label)}>
                <b>{value}</b>
                <span>{label}</span>
              </div>
            ))}
          </div>
          <section className="mc-content">
            <div className="mc-section-head">
              <div>
                <h2>需要留意</h2>
                <p>即時作業風險，不含任何推估營收。</p>
              </div>
            </div>
            <div className="mc-card">
              {result.warnings.length ? (
                result.warnings.map((warning: any) => (
                  <div className="mc-warning" key={warning.code}>
                    <b>{warning.count} · </b>
                    {warning.message}
                  </div>
                ))
              ) : (
                <div className="mc-empty">目前沒有待處理的系統警示。</div>
              )}
            </div>
            <div className="mc-actions" style={{ marginTop: 16 }}>
              <button
                type="button"
                className="mc-action primary"
                onClick={() => select("members")}
              >
                查看會員
              </button>
              <button
                type="button"
                className="mc-action"
                onClick={() => select("support")}
              >
                處理客服案件
              </button>
            </div>
          </section>
        </>
      )}
    </DataState>
  );
}

function CourseMarketplaceReview({
  data,
  canReview,
  action,
}: {
  data: any;
  canReview: boolean;
  action: any;
}) {
  const { toast } = useToast();
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const items = (data.data?.items || []) as CourseMarketplaceManagementItemDto[];
  const review = (item: CourseMarketplaceManagementItemDto, reviewAction: "approve" | "reject") => {
    const trimmed = reason.trim();
    if (reviewAction === "reject" && !trimmed) return;
    action.mutate(
      {
        method: "POST",
        url: `course-marketplace/${item.id}/review`,
        data: { action: reviewAction, ...(trimmed ? { reason: trimmed } : {}), version: item.version },
      },
      {
        onSuccess: () => {
          setRejecting(null);
          setReason("");
          toast({ title: reviewAction === "approve" ? "課程已核准" : "課程已拒絕" });
        },
        onError: (error: Error) => toast({ title: "審核失敗", description: error.message, variant: "destructive" }),
      },
    );
  };
  return (
    <section>
      <div className="mc-section-head">
        <div>
          <h2>課程廣場審核</h2>
          <p>檢視並處理課程廣場申請，核准時會擷取目前已發布的課程內容。</p>
        </div>
      </div>
      <div className="mc-card">
        <DataState loading={data.isLoading} error={data.error} empty={!items.length}>
          <div className="mc-table-wrap">
            <table className="mc-table">
              <thead><tr><th>課程</th><th>擁有者 / 公司</th><th>申請日期</th><th>操作</th></tr></thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id} data-testid={`course-marketplace-row-${item.id}`}>
                    <td>{item.webinarTitle}<div className="mc-id">{item.webinarId}</div></td>
                    <td>{item.ownerName}<div className="mc-id">{item.ownerCompany || "—"}</div></td>
                    <td>{date(item.requestedAt)}</td>
                    <td>
                      {rejecting === item.id ? (
                        <div className="mc-actions">
                          <input
                            className="mc-input"
                            aria-label={`拒絕 ${item.webinarTitle} 的原因`}
                            data-testid={`course-marketplace-reject-reason-${item.id}`}
                            value={reason}
                            onChange={(event) => setReason(event.target.value)}
                            placeholder="請填寫拒絕原因"
                          />
                          <button type="button" className="mc-action" disabled={!reason.trim() || action.isPending} onClick={() => review(item, "reject")} data-testid={`course-marketplace-reject-confirm-${item.id}`}>確認拒絕</button>
                          <button type="button" className="mc-action" onClick={() => { setRejecting(null); setReason(""); }}>取消</button>
                        </div>
                      ) : (
                        <div className="mc-actions">
                          <button type="button" className="mc-action primary" disabled={!canReview || action.isPending} onClick={() => review(item, "approve")} data-testid={`course-marketplace-approve-${item.id}`}>核准</button>
                          <button type="button" className="mc-action" disabled={!canReview || action.isPending} onClick={() => { setRejecting(item.id); setReason(""); }} data-testid={`course-marketplace-reject-${item.id}`}>拒絕</button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </DataState>
      </div>
    </section>
  );
}

export default function SuperAdmin() {
  const [location, setLocation] = useLocation();
  const search = useSearch();
  const route = parseRoute(`${location}?${search}`);
  const section = route.section;
  const memberId = route.memberId;
  const [mobileOpen, setMobileOpen] = useState(false);
  const { filters, update } = useSectionFilters();
  const { data: me, isLoading: meLoading, error: meError } = useManagementMe();
  const allowed = (permission: ManagementPermission) =>
    !!me?.isRoot || !!me?.permissions.includes(permission);

  useEffect(() => {
    if (route.invalid) setLocation("/super-admin?section=overview");
  }, [route.invalid, setLocation]);

  useEffect(() => {
    const closeForDesktop = () => {
      if (window.innerWidth >= 1024) setMobileOpen(false);
    };
    window.addEventListener("resize", closeForDesktop);
    return () => window.removeEventListener("resize", closeForDesktop);
  }, []);

  const select = (next: Section) => {
    setMobileOpen(false);
    setLocation(`/super-admin?section=${next}`);
  };
  const openMember = (id: string) => {
    setLocation(`/super-admin?section=members&member=${encodeURIComponent(id)}`);
  };
  const overview = useManagementOverview(
    !!me?.canManage && allowed("members.read"),
  );
  const membersQuery = useMemo<ListFilters>(
    () => ({
      page: filters.members.page,
      pageSize: 25,
      search: filters.members.search,
      active: filters.members.active,
      role: filters.members.role,
      plan: filters.members.plan,
    }),
    [filters.members],
  );
  const subscriptionsQuery = useMemo<ListFilters>(
    () => ({
      page: filters.subscriptions.page,
      pageSize: 25,
      search: filters.subscriptions.search,
      status: filters.subscriptions.status,
    }),
    [filters.subscriptions],
  );
  const ordersQuery = useMemo<ListFilters>(
    () => ({
      page: filters.orders.page,
      pageSize: 25,
      search: filters.orders.search,
      status: filters.orders.status,
      kind: filters.orders.kind,
      provider: filters.orders.provider,
      from: filters.orders.from,
      to: filters.orders.to,
    }),
    [filters.orders],
  );
  const supportQuery = useMemo<ListFilters>(
    () => ({
      page: filters.support.page,
      pageSize: 25,
      search: filters.support.search,
      status: filters.support.status,
    }),
    [filters.support],
  );
  const auditQuery = useMemo<ListFilters>(
    () => ({
      page: filters.audit.page,
      pageSize: 25,
      action: filters.audit.action,
      targetUserId: filters.audit.targetUserId,
    }),
    [filters.audit],
  );
  const members = useMembers(
    membersQuery,
    !!me?.canManage &&
      section === "members" &&
      !memberId &&
      allowed("members.read"),
  );
  const member = useMember(
    memberId,
    !!me?.canManage && section === "members" && allowed("members.read"),
  );
  const subscriptions = useSubscriptions(
    subscriptionsQuery,
    !!me?.canManage && section === "subscriptions" && allowed("subscriptions.read"),
  );
  const orders = useOrders(
    ordersQuery,
    !!me?.canManage && section === "orders" && allowed("billing.read"),
  );
  const support = useSupport(
    supportQuery,
    !!me?.canManage && section === "support" && allowed("support.read"),
  );
  const audit = useAudit(
    auditQuery,
    !!me?.canManage && section === "audit" && allowed("audit.read"),
  );
  const courseMarketplace = useCourseMarketplaceQueue(
    !!me?.canManage && section === "course-marketplace" && allowed("course_marketplace.read"),
  );
  const catalog = useManagementCatalog(
    !!me?.canManage && (section === "catalog" || section === "roles"),
  );
  const action = useManagementAction();
  const current = nav.find((item) => item.id === section);
  const links = (
    <nav className="mc-nav" aria-label="管理中心選單">
      {nav
        .filter((item) => allowed(item.permission))
        .map((item) => (
          <button
            type="button"
            key={item.id}
            data-active={section === item.id}
            onClick={() => select(item.id)}
          >
            <item.icon />
            {item.label}
          </button>
        ))}
    </nav>
  );
  const firstAllowedSection =
    nav.find((item) => allowed(item.permission))?.id || "overview";

  useEffect(() => {
    if (!me?.canManage) return;
    if (!current || !allowed(current.permission)) {
      setLocation(`/super-admin?section=${firstAllowedSection}`);
    }
  }, [
    me?.canManage,
    me?.isRoot,
    me?.permissions,
    current?.id,
    firstAllowedSection,
    section,
    setLocation,
  ]);

  if (meLoading)
    return (
      <div className="management-center">
        <div className="mc-empty">正在確認管理權限</div>
      </div>
    );
  if (meError || !me?.canManage)
    return (
      <div className="management-center">
        <div className="mc-empty">
          <ShieldCheck size={34} />
          <p>您沒有管理中心的存取權限。</p>
        </div>
      </div>
    );

  return (
    <div className="management-center">
      <div className="mc-mobile">
        <strong>SellCase 管理中心</strong>
        <button
          type="button"
          aria-label="開啟左側選單"
          onClick={() => setMobileOpen(true)}
          data-testid="button-management-mobile-menu"
        >
          <Menu />
        </button>
      </div>
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent
          side="left"
          className="management-center mc-mobile-sheet w-[min(280px,85vw)] bg-[#123e59] text-[#e8fffa]"
          data-testid="management-mobile-sheet"
          aria-describedby="management-mobile-sheet-description"
        >
          <SheetTitle className="sr-only">管理中心選單</SheetTitle>
          <SheetDescription
            id="management-mobile-sheet-description"
            className="sr-only"
          >
            管理中心導覽選單
          </SheetDescription>
          <div className="mc-brand">
            SellCase
            <small>management center</small>
          </div>
          {links}
        </SheetContent>
      </Sheet>
      <div className="mc-layout">
        <aside className="mc-sidebar">
          <div className="mc-brand">
            SellCase
            <small>management center</small>
          </div>
          {links}
          <div className="mc-side-foot">
            以最小必要權限操作
            <br />
            所有異動均保留稽核紀錄
          </div>
        </aside>
        <main className="mc-main">
          <header className="mc-top">
            <div>
              <div className="mc-kicker">
                {me.managementRole} · protected operations
              </div>
              <h1 className="mc-title">{current?.label || "管理中心"}</h1>
              <p className="mc-subtitle">
                會員權益、平台帳務與作業紀錄分流管理。
              </p>
            </div>
            <button
              type="button"
              className="mc-back"
              onClick={() => setLocation("/admin/dashboard")}
            >
              返回營運後台
            </button>
          </header>
          {section === "overview" && <Overview data={overview} select={select} />}
          {section === "members" &&
            (memberId ? (
              <MemberDetail
                key={memberId}
                detail={member}
                memberId={memberId}
                back={() => select("members")}
                canWrite={allowed("members.write")}
                canDisable={allowed("members.disable")}
                canCredit={allowed("credits.grant")}
                canRoles={allowed("members.roles")}
                canSubscriptions={allowed("subscriptions.write")}
                canReadSubscriptions={allowed("subscriptions.read")}
                isRoot={!!me.isRoot}
                canReadCredits={allowed("credits.read")}
                canReadBilling={allowed("billing.read")}
                canReadSupport={allowed("support.read")}
                canReadAudit={allowed("audit.read")}
                action={action}
              />
            ) : (
              <Members
                data={members}
                filters={filters.members}
                update={(field, value) => update("members", field, value)}
                open={openMember}
              />
            ))}
          {section === "subscriptions" && (
            <Subscriptions
              data={subscriptions}
              filters={filters.subscriptions}
              update={(field, value) => update("subscriptions", field, value)}
            />
          )}
          {section === "orders" && (
            <Orders
              data={orders}
              filters={filters.orders}
              update={(field, value) => update("orders", field, value)}
              action={action}
              refundable={allowed("billing.refund")}
            />
          )}
          {section === "catalog" && <Catalog data={catalog} />}
          {section === "roles" && <Roles data={catalog} />}
          {section === "support" && (
            <Support
              data={support}
              filters={filters.support}
              update={(field, value) => update("support", field, value)}
              action={action}
              writable={allowed("support.write")}
            />
          )}
          {section === "audit" && (
            <Audit
              data={audit}
              filters={filters.audit}
              update={(field, value) => update("audit", field, value)}
              exportable={allowed("audit.export")}
            />
          )}
          {section === "course-marketplace" && (
            <CourseMarketplaceReview
              data={courseMarketplace}
              canReview={allowed("course_marketplace.review")}
              action={action}
            />
          )}
        </main>
      </div>
    </div>
  );
}