import { useMemo, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Download, Loader2, RefreshCw, Search, ShieldAlert } from "lucide-react";
import type { ExternalOrderDto } from "@shared/externalJourneys";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type ExternalOrder = ExternalOrderDto & { sessionId: string | null; selectedSession: string | null; purchaseObserved?: boolean };
type ExternalList = { items: ExternalOrder[]; page: number; pageSize: number; total: number; labelled: string };
type ExternalSummary = { labelled: string; currencies: Array<{ currency: string; sourceTrust: ExternalOrderDto["sourceTrust"]; grossPaidMinor: number; refundedMinor: number; netMinor: number; count: number; pendingCount?: number }> };
type ExternalDetail = ExternalOrder & { events: Array<{ id: string; eventId: string; eventType: "purchase" | "refund"; sourceTrust: ExternalOrderDto["sourceTrust"]; amountMinor: number; currency: string; occurredAt: string }>; labelled: string };
const pageSize = 25;

function requestJson<T>(url: string): Promise<T> {
  return fetch(url, { credentials: "same-origin" }).then(async response => {
    if (!response.ok) throw new Error((await response.json().catch(() => null))?.message || `請求失敗（${response.status}）`);
    return response.json() as Promise<T>;
  });
}
function minor(amount: number | null, currency: string) {
  if (amount === null) return "待成交通知";
  const formatter = new Intl.NumberFormat(undefined, { style: "currency", currency });
  return formatter.format(amount / (10 ** (formatter.resolvedOptions().maximumFractionDigits || 0)));
}
function taipeiBoundary(date: string, end = false) {
  return date ? `${date}T${end ? "23:59:59.999" : "00:00:00"}+08:00` : undefined;
}
function trustLabel(value: ExternalOrderDto["sourceTrust"]) {
  return value === "merchant_reported" ? "商家簽名回報（未驗證）" : "瀏覽器回報（未驗證）";
}

export function ExternalOrders() {
  const [, navigate] = useLocation();
  const search = useSearch();
  const params = useMemo(() => new URLSearchParams(search), [search]);
  const [searchText, setSearchText] = useState(params.get("externalQ") || "");
  const [exporting, setExporting] = useState(false);
  const page = Math.max(1, Number(params.get("externalPage") || 1) || 1);
  const selectedId = params.get("externalOrder");
  const filters = {
    q: params.get("externalQ") || undefined,
    sourceTrust: params.get("externalTrust") || undefined,
    sessionId: params.get("externalSession") || undefined,
    currency: params.get("externalCurrency") || undefined,
    from: params.get("externalFrom") || undefined,
    to: params.get("externalTo") || undefined,
  };
  const queryString = useMemo(() => {
    const result = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => { if (value) result.set(key, value); });
    result.set("page", String(page)); result.set("pageSize", String(pageSize));
    return result.toString();
  }, [search, page]);
  const summaryString = useMemo(() => {
    const result = new URLSearchParams(queryString); result.delete("page"); result.delete("pageSize"); return result.toString();
  }, [queryString]);
  const list = useQuery<ExternalList>({ queryKey: ["external-orders", queryString], queryFn: () => requestJson(`/api/member/external-orders?${queryString}`) });
  const summary = useQuery<ExternalSummary>({ queryKey: ["external-orders-summary", summaryString], queryFn: () => requestJson(`/api/member/external-orders/summary${summaryString ? `?${summaryString}` : ""}`) });
  const detail = useQuery<ExternalDetail>({ queryKey: ["external-order", selectedId], queryFn: () => requestJson(`/api/member/external-orders/${encodeURIComponent(selectedId!)}`), enabled: !!selectedId });

  const setParams = (values: Record<string, string | null>) => {
    const next = new URLSearchParams(search);
    Object.entries(values).forEach(([key, value]) => value ? next.set(key, value) : next.delete(key));
    next.set("tab", "external");
    navigate(`/admin/orders?${next.toString()}`);
  };
  const exportCsv = async () => {
    setExporting(true);
    try {
      const response = await fetch(`/api/member/external-orders/export.csv${summaryString ? `?${summaryString}` : ""}`, { credentials: "same-origin" });
      if (!response.ok) throw new Error((await response.json().catch(() => null))?.message || `匯出失敗（${response.status}）`);
      const href = URL.createObjectURL(await response.blob());
      const link = document.createElement("a"); link.href = href; link.download = "external-orders.csv"; link.click(); URL.revokeObjectURL(href);
    } finally { setExporting(false); }
  };
  const totalPages = Math.max(1, Math.ceil((list.data?.total || 0) / pageSize));
  return <div className="space-y-6" data-testid="external-orders-page">
    <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950"><ShieldAlert className="mr-2 inline h-4 w-4" /><b>外部歸因報表，不是平台確認營收。</b>瀏覽器回報與商家簽名回報都不是付款供應商驗證，不會與內部訂單總額混合。</div>
    <section aria-label="外部訂單篩選條件" className="rounded-lg border bg-card p-4"><div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
      <div className="lg:col-span-2"><Label>訂單編號搜尋</Label><div className="relative mt-2"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" /><Input className="pl-9" value={searchText} onChange={event => setSearchText(event.target.value)} onKeyDown={event => { if (event.key === "Enter") setParams({ externalQ: searchText.trim() || null, externalPage: null }); }} placeholder="外部 order id" data-testid="external-orders-search" /></div></div>
      <div><Label>資料來源</Label><Select value={filters.sourceTrust || "all"} onValueChange={value => setParams({ externalTrust: value === "all" ? null : value, externalPage: null })}><SelectTrigger className="mt-2" data-testid="external-orders-trust"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">全部未驗證來源</SelectItem><SelectItem value="browser_reported">瀏覽器回報</SelectItem><SelectItem value="merchant_reported">商家簽名回報</SelectItem></SelectContent></Select></div>
      <div><Label>幣別</Label><Input className="mt-2 uppercase" maxLength={3} value={filters.currency || ""} onChange={event => setParams({ externalCurrency: event.target.value.trim().toUpperCase() || null, externalPage: null })} placeholder="例如 TWD" data-testid="external-orders-currency" /></div>
      <div><Label>場次 ID</Label><Input className="mt-2" value={filters.sessionId || ""} onChange={event => setParams({ externalSession: event.target.value.trim() || null, externalPage: null })} placeholder="指定已關聯場次" data-testid="external-orders-session" /></div>
      <div><Label>建立日期（起）</Label><Input type="date" className="mt-2" value={filters.from?.slice(0, 10) || ""} onChange={event => setParams({ externalFrom: taipeiBoundary(event.target.value) || null, externalPage: null })} data-testid="external-orders-from" /></div>
      <div><Label>建立日期（迄）</Label><Input type="date" className="mt-2" value={filters.to?.slice(0, 10) || ""} onChange={event => setParams({ externalTo: taipeiBoundary(event.target.value, true) || null, externalPage: null })} data-testid="external-orders-to" /></div>
    </div><div className="mt-4 flex gap-2"><Button size="sm" onClick={() => setParams({ externalQ: searchText.trim() || null, externalPage: null })}>搜尋</Button><Button size="sm" variant="ghost" onClick={() => { setSearchText(""); navigate("/admin/orders?tab=external"); }}>清除篩選</Button><Button className="ml-auto" size="sm" variant="outline" disabled={exporting} onClick={() => void exportCsv()} data-testid="external-orders-export">{exporting ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Download className="mr-1 h-4 w-4" />}匯出 CSV</Button></div></section>
    <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{summary.isLoading ? <Card><CardContent className="p-5"><Loader2 className="animate-spin" /></CardContent></Card> : summary.isError ? <Card><CardContent className="p-4 text-sm">無法載入外部統計。</CardContent></Card> : summary.data?.currencies.map(item => <Card key={`${item.currency}-${item.sourceTrust}`} data-testid={`external-orders-summary-${item.currency}-${item.sourceTrust}`}><CardContent className="p-4"><div className="flex flex-wrap justify-between gap-2"><b>{item.currency}</b><Badge variant="outline">{trustLabel(item.sourceTrust)}</Badge></div><div className="mt-3 grid grid-cols-2 gap-3 text-sm"><div><p className="text-muted-foreground">回報毛額</p><b>{minor(item.grossPaidMinor, item.currency)}</b></div><div><p className="text-muted-foreground">累計退款</p><b>{minor(item.refundedMinor, item.currency)}</b></div><div><p className="text-muted-foreground">未驗證淨額</p><b>{minor(item.netMinor, item.currency)}</b></div><div><p className="text-muted-foreground">筆數</p><b>{item.count}</b>{item.pendingCount ? <p className="text-xs text-amber-800">待成交通知 {item.pendingCount} 筆（不列入總額）</p> : null}</div></div></CardContent></Card>)}</section>
    <section className="overflow-hidden rounded-lg border bg-card"><div className="flex items-center justify-between border-b p-4"><div><h2 className="font-semibold">外部訂單</h2><p className="text-sm text-muted-foreground">{list.data?.labelled || "獨立於平台確認營收"}</p></div><Button variant="ghost" size="icon" onClick={() => { void list.refetch(); void summary.refetch(); }} aria-label="重新整理外部訂單"><RefreshCw className="h-4 w-4" /></Button></div>
      {list.isLoading ? <div className="grid min-h-48 place-items-center"><Loader2 className="animate-spin" /></div> : list.isError ? <div className="p-6 text-center text-sm">無法載入外部訂單：{list.error.message}</div> : !list.data?.items.length ? <div className="p-8 text-center text-sm text-muted-foreground">沒有符合條件的外部回報訂單。</div> : <div className="divide-y">{list.data.items.map(order => <button key={order.id} type="button" onClick={() => setParams({ externalOrder: order.id })} className="grid w-full gap-2 p-4 text-left hover:bg-muted/40 md:grid-cols-[1.4fr_auto_auto]" data-testid={`external-order-${order.id}`}><div><b className="font-mono">{order.orderId}</b><p className="mt-1 text-xs text-muted-foreground">說明會：{order.webinarId} · 場次：{order.selectedSession ? new Date(order.selectedSession).toLocaleString() : order.sessionId || "未關聯場次"} · {new Date(order.createdAt).toLocaleString()}</p></div><div className="flex flex-wrap gap-1"><Badge variant="outline" className="h-fit w-fit">{trustLabel(order.sourceTrust)}</Badge>{order.purchaseObserved === false && <Badge className="h-fit bg-amber-700 hover:bg-amber-700">待成交通知</Badge>}</div><div className="md:text-right"><b>{minor(order.netMinor, order.currency)}</b><p className="text-xs text-muted-foreground">毛額 {minor(order.grossPaidMinor, order.currency)} · 退款 {minor(order.refundedMinor, order.currency)}</p></div></button>)}</div>}
      {!!list.data?.items.length && <div className="flex items-center justify-between border-t p-4 text-sm"><span>第 {page} / {totalPages} 頁</span><div className="flex gap-2"><Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setParams({ externalPage: String(page - 1) })}>上一頁</Button><Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setParams({ externalPage: String(page + 1) })}>下一頁</Button></div></div>}
    </section>
    {selectedId && <section className="rounded-lg border bg-card p-4" data-testid="external-order-detail"><div className="mb-3 flex items-center justify-between"><h2 className="font-semibold">外部訂單明細</h2><Button size="sm" variant="ghost" onClick={() => setParams({ externalOrder: null })}>關閉</Button></div>{detail.isLoading ? <Loader2 className="animate-spin" /> : detail.isError ? <p className="text-sm text-destructive">{detail.error.message}</p> : detail.data && <><p className="text-sm text-muted-foreground">{detail.data.labelled}</p><div className="mt-3 grid gap-2 text-sm sm:grid-cols-2"><p>訂單：<b className="font-mono">{detail.data.orderId}</b></p><p>{trustLabel(detail.data.sourceTrust)}</p><p>關聯場次：{detail.data.selectedSession ? new Date(detail.data.selectedSession).toLocaleString() : detail.data.sessionId || "未關聯場次"}</p><p>毛額：{minor(detail.data.grossPaidMinor, detail.data.currency)}</p><p>累計退款：{minor(detail.data.refundedMinor, detail.data.currency)}</p></div><h3 className="mt-5 font-medium">事件紀錄</h3><div className="mt-2 space-y-2">{detail.data.events.map(event => <div key={event.id} className="rounded border p-2 text-sm"><b>{event.eventType === "refund" ? "退款" : "購買"}</b> · {minor(event.amountMinor, event.currency)} · {trustLabel(event.sourceTrust)}<span className="ml-2 text-xs text-muted-foreground">{new Date(event.occurredAt).toLocaleString()}</span></div>)}</div></>}</section>}
  </div>;
}