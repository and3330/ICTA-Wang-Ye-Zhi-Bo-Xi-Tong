import { useEffect, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import type { MemberOrderDetail, MemberOrderFulfillmentStatus, UpdateMemberOrderRequest } from "@shared/memberOrders";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const paymentLabels: Record<MemberOrderDetail["paymentStatus"], string> = { pending: "待付款確認", paid: "已付款", failed: "付款失敗", partially_refunded: "部分退款", refunded: "已退款" };
const fulfillmentLabels: Record<MemberOrderFulfillmentStatus, string> = { pending: "待處理", in_progress: "處理中", completed: "已完成", cancelled: "已取消處理" };
const eventLabels: Record<string, string> = { checkout_started: "開始結帳", payment_pending: "等待付款確認", payment_paid: "付款已確認", payment_failed: "付款失敗", payment_refunded: "退款狀態更新", fulfillment_changed: "履約狀態已變更", internal_note_changed: "內部備註已更新" };

export const formatMoney = (minor: number, currency: string) => new Intl.NumberFormat("zh-TW", { style: "currency", currency, maximumFractionDigits: currency === "TWD" ? 0 : 2 }).format(minor / 100);
export const formatDate = (value: string | null) => value ? new Date(value).toLocaleString("zh-TW", { dateStyle: "medium", timeStyle: "short" }) : "未保存";
export const snapshotLabel = (source: "recorded" | "legacy_live" | "legacy_missing") => source === "recorded" ? null : source === "legacy_live" ? "舊資料目前商品名稱（非訂單快照）" : "未保存";

function PaymentBadge({ status }: { status: MemberOrderDetail["paymentStatus"] }) {
  return <Badge className={status === "paid" ? "bg-emerald-700 hover:bg-emerald-700" : status === "failed" || status === "refunded" ? "bg-rose-700 hover:bg-rose-700" : "bg-amber-700 hover:bg-amber-700"}>{paymentLabels[status]}</Badge>;
}

function FulfillmentBadge({ status }: { status: MemberOrderFulfillmentStatus }) {
  return <Badge variant="outline" className={status === "completed" ? "border-emerald-700 text-emerald-800" : status === "cancelled" ? "border-slate-500 text-slate-700" : "border-sky-700 text-sky-800"}>{fulfillmentLabels[status]}</Badge>;
}

type Props = {
  order: MemberOrderDetail | undefined;
  loading: boolean;
  error: Error | null;
  onClose: () => void;
  onRetry: () => void;
  saving: boolean;
  conflict: boolean;
  onSave: (input: UpdateMemberOrderRequest) => void;
};

export function MemberOrderDetailDialog({ order, loading, error, onClose, onRetry, saving, conflict, onSave }: Props) {
  const [note, setNote] = useState("");
  const [status, setStatus] = useState<MemberOrderFulfillmentStatus>("pending");
  const [reason, setReason] = useState("");
  useEffect(() => {
    if (order) { setNote(order.internalNote || ""); setStatus(order.fulfillmentStatus); setReason(""); }
  }, [order?.id, order?.version]);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!order) return;
    if (!reason.trim()) return;
    const changedNote = note !== (order.internalNote || "");
    const changedStatus = status !== order.fulfillmentStatus;
    if (!changedNote && !changedStatus) return;
    if (status === "completed" && (order.paymentStatus !== "paid" && order.paymentStatus !== "partially_refunded" || order.money.netMinor <= 0)) return;
    if ((status === "completed" || status === "cancelled") && !window.confirm(status === "completed" ? "確認標記為已完成履約？這不會變更付款狀態。" : "確認取消處理此訂單？這不會退款或取消付款。")) return;
    onSave({
      expectedVersion: order.version,
      reason: reason.trim(),
      ...(changedNote ? { internalNote: note || null } : {}),
      ...(changedStatus ? { fulfillmentStatus: status } : {}),
    });
  };

  return <Dialog open onOpenChange={open => !open && onClose()}>
    <DialogContent className="h-[100dvh] w-screen max-w-none rounded-none p-5 sm:h-auto sm:max-h-[calc(100dvh-3rem)] sm:w-[min(56rem,calc(100%-3rem))] sm:max-w-none sm:rounded-lg" data-testid="member-order-detail">
      {loading ? <div className="grid h-full place-items-center"><Loader2 className="h-7 w-7 animate-spin" /></div> :
        error ? <div className="grid h-full place-items-center text-center"><div><b>無法載入訂單</b><p className="my-2 text-sm text-muted-foreground">{error.message}</p><Button onClick={onRetry}><RefreshCw className="mr-2" />重試</Button></div></div> :
          !order ? null : <div className="space-y-5 pb-3">
            <DialogHeader className="pr-8">
              <DialogTitle>訂單明細</DialogTitle>
              <DialogDescription>訂單與付款資料為不可修改的記錄；可獨立更新內部備註和處理狀態。</DialogDescription>
            </DialogHeader>
            <section className="rounded-lg border bg-muted/30 p-4">
              <div className="flex flex-wrap items-center gap-2"><PaymentBadge status={order.paymentStatus} /><FulfillmentBadge status={order.fulfillmentStatus} /></div>
              <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                <div><dt className="text-muted-foreground">完整訂單編號</dt><dd className="mt-1 break-all font-mono text-xs">{order.id}</dd></div>
                <div><dt className="text-muted-foreground">付款服務參考編號</dt><dd className="mt-1 break-all font-mono text-xs">{order.receipt.providerReference || "未保存"}</dd></div>
                <div><dt className="text-muted-foreground">建立時間</dt><dd>{formatDate(order.createdAt)}</dd></div>
                <div><dt className="text-muted-foreground">付款確認時間</dt><dd>{formatDate(order.purchasedAt)}</dd></div>
              </dl>
            </section>
            <div className="grid gap-4 md:grid-cols-2">
              <section className="rounded-lg border p-4"><h3 className="font-semibold">商品快照</h3><p className="mt-2">{order.product.name || "未保存"}</p><p className="mt-1 break-all text-xs text-muted-foreground">商品 ID：{order.product.id}</p>{snapshotLabel(order.product.nameSource) && <p className="mt-2 text-xs text-amber-800">{snapshotLabel(order.product.nameSource)}</p>}</section>
              <section className="rounded-lg border p-4"><h3 className="font-semibold">顧客快照</h3><p className="mt-2">{order.buyer.name || "未保存"}</p><p className="break-all text-sm text-muted-foreground">{order.buyer.email || "未保存"}</p>{snapshotLabel(order.buyer.source) && <p className="mt-2 text-xs text-amber-800">{snapshotLabel(order.buyer.source)}</p>}</section>
            </div>
            <section className="rounded-lg border p-4"><h3 className="font-semibold">金額與付款證據</h3><dl className="mt-3 grid grid-cols-3 gap-2 text-sm"><div><dt className="text-muted-foreground">總額</dt><dd>{formatMoney(order.money.amountMinor, order.money.currency)}</dd></div><div><dt className="text-muted-foreground">已退款</dt><dd>{formatMoney(order.money.refundedMinor, order.money.currency)}</dd></div><div><dt className="text-muted-foreground">淨額</dt><dd className="font-semibold">{formatMoney(order.money.netMinor, order.money.currency)}</dd></div></dl><p className="mt-4 text-sm">付款回呼來源：{order.receipt.provider === "ecpay" ? "ECPay 經驗證回呼" : "Stripe 經驗證回呼"}</p><p className="text-sm text-muted-foreground">提供者狀態：{order.receipt.providerStatus || "未保存"}{order.receipt.providerStatusMessage ? ` · ${order.receipt.providerStatusMessage}` : ""}</p>{order.receipt.provider === "ecpay" && <p className="mt-3 text-xs leading-5 text-muted-foreground">ECPay 退款須在商家綠界後台處理；外部退款不一定會立即反映在此訂單。</p>}</section>
            <section className="rounded-lg border p-4"><h3 className="font-semibold">成交來源</h3><p className="mt-2 text-sm">{order.attribution.source === "webinar" ? "說明會／直播" : "獨立商品頁"}</p>{order.attribution.source === "webinar" && <p className="mt-1 break-all text-xs text-muted-foreground">說明會 ID：{order.attribution.webinarId || "未保存"}<br />CTA ID：{order.attribution.ctaId || "未保存"}</p>}</section>
            <form className="rounded-lg border p-4" onSubmit={submit}>
              <h3 className="font-semibold">內部處理</h3><p className="mt-1 text-xs text-muted-foreground">已完成僅適用於已付款且淨額大於 0 的訂單。取消處理不會退款。</p>
              {conflict && <p className="mt-3 rounded-md bg-amber-50 p-3 text-sm text-amber-900" role="alert">此訂單剛被其他操作更新。已重新載入最新資料，請確認後再儲存。</p>}
              <div className="mt-4 grid gap-4 sm:grid-cols-2"><div><Label htmlFor="member-order-fulfillment">處理狀態</Label><Select value={status} onValueChange={value => setStatus(value as MemberOrderFulfillmentStatus)}><SelectTrigger id="member-order-fulfillment" className="mt-2" data-testid="member-order-fulfillment"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(fulfillmentLabels).map(([value, label]) => <SelectItem key={value} value={value} disabled={value === "completed" && (order.paymentStatus !== "paid" && order.paymentStatus !== "partially_refunded" || order.money.netMinor <= 0)}>{label}</SelectItem>)}</SelectContent></Select></div><div><Label htmlFor="member-order-reason">更新原因</Label><Input id="member-order-reason" className="mt-2" value={reason} onChange={event => setReason(event.target.value)} maxLength={500} required placeholder="例如：已完成內容開通" data-testid="member-order-reason" /></div></div>
              <div className="mt-4"><Label htmlFor="member-order-note">內部備註</Label><Textarea id="member-order-note" className="mt-2" value={note} onChange={event => setNote(event.target.value)} maxLength={5000} data-testid="member-order-note" /></div>
              <Button className="mt-4" type="submit" disabled={saving || !reason.trim()} data-testid="member-order-save">{saving && <Loader2 className="animate-spin" />}儲存處理更新</Button>
            </form>
            <section><h3 className="font-semibold">訂單時間軸</h3><ol className="mt-3 space-y-3 border-l pl-4">{order.events.map(event => <li key={event.id} className="relative text-sm before:absolute before:-left-[1.31rem] before:top-1.5 before:h-2 before:w-2 before:rounded-full before:bg-primary"><div className="flex flex-wrap justify-between gap-1"><b>{eventLabels[event.type] || event.type}</b><time className="text-xs text-muted-foreground">{formatDate(event.occurredAt)}</time></div>{event.reason && <p className="text-muted-foreground">{event.reason}</p>}{Object.keys(event.details).length > 0 && <p className="mt-1 break-words text-xs text-muted-foreground">{Object.entries(event.details).map(([key, value]) => `${key}: ${String(value)}`).join(" · ")}</p>}</li>)}</ol></section>
          </div>}
    </DialogContent>
  </Dialog>;
}