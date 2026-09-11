import { useEffect, useMemo, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowLeft, Download, Loader2, ReceiptText, RefreshCw, Search } from "lucide-react";
import type { MemberOrderDetail, MemberOrderFilters, MemberOrderListResponse, MemberOrderPaymentStatus, MemberOrderProductFilterOption, MemberOrderSummaryResponse, MemberOrderFulfillmentStatus, UpdateMemberOrderRequest } from "@shared/memberOrders";
import { SellCaseLogo } from "@/components/sellcase-logo";
import { MemberOrderDetailDialog, formatDate, formatMoney, snapshotLabel } from "@/components/member-order-detail";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

type ProductFiltersResponse = { items: MemberOrderProductFilterOption[]; truncated?: boolean; hasMore?: boolean };
const paymentLabels: Record<MemberOrderPaymentStatus, string> = { pending: "待付款確認", paid: "已付款", failed: "付款失敗", partially_refunded: "部分退款", refunded: "已退款" };
const fulfillmentLabels: Record<MemberOrderFulfillmentStatus, string> = { pending: "待處理", in_progress: "處理中", completed: "已完成", cancelled: "已取消處理" };
const pageSize = 25;

function requestJson<T>(url: string): Promise<T> {
  return fetch(url, { credentials: "same-origin" }).then(async response => {
    if (!response.ok) throw new Error((await response.json().catch(() => null))?.message || `請求失敗（${response.status}）`);
    return response.json() as Promise<T>;
  });
}

/** Date input is interpreted as Taipei calendar time, then sent as explicit contract instants. */
function taipeiBoundary(date: string, end = false) {
  return date ? `${date}T${end ? "23:59:59.999" : "00:00:00"}+08:00` : undefined;
}

function statusClass(paymentStatus: MemberOrderPaymentStatus) {
  return paymentStatus === "paid" ? "bg-emerald-700 hover:bg-emerald-700" : paymentStatus === "failed" || paymentStatus === "refunded" ? "bg-rose-700 hover:bg-rose-700" : "bg-amber-700 hover:bg-amber-700";
}

export default function AdminOrders() {
  const [, navigate] = useLocation();
  const search = useSearch();
  const { toast } = useToast();
  const params = useMemo(() => new URLSearchParams(search), [search]);
  const selectedId = params.get("order");
  const [searchText, setSearchText] = useState(params.get("q") || "");
  const [exporting, setExporting] = useState(false);
  const [conflict, setConflict] = useState(false);

  useEffect(() => setSearchText(params.get("q") || ""), [search]);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (searchText.trim() !== (params.get("q") || "")) setParams({ q: searchText.trim() || null, page: null });
    }, 350);
    return () => window.clearTimeout(timer);
  // The URL is deliberately the source of truth; only debounce text entry.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchText]);

  const filter: MemberOrderFilters = {
    ...(params.get("q") ? { q: params.get("q")! } : {}),
    ...(params.get("productId") ? { productId: params.get("productId")! } : {}),
    ...(params.get("paymentStatus") ? { paymentStatus: params.get("paymentStatus") as MemberOrderPaymentStatus } : {}),
    ...(params.get("fulfillmentStatus") ? { fulfillmentStatus: params.get("fulfillmentStatus") as MemberOrderFulfillmentStatus } : {}),
    ...(params.get("currency") ? { currency: params.get("currency")! } : {}),
    ...(params.get("from") ? { from: params.get("from")! } : {}),
    ...(params.get("to") ? { to: params.get("to")! } : {}),
  };
  const page = Math.max(1, Number(params.get("page") || "1") || 1);
  const baseQuery = useMemo(() => {
    const output = new URLSearchParams();
    Object.entries(filter).forEach(([key, value]) => output.set(key, value));
    return output;
  }, [search, filter.q, filter.productId, filter.paymentStatus, filter.fulfillmentStatus, filter.currency, filter.from, filter.to]);
  const listQueryString = useMemo(() => {
    const output = new URLSearchParams(baseQuery);
    output.set("page", String(page)); output.set("pageSize", String(pageSize));
    return output.toString();
  }, [baseQuery, page]);
  const summaryQueryString = baseQuery.toString();
  const listQuery = useQuery<MemberOrderListResponse>({ queryKey: ["member-orders", "list", listQueryString], queryFn: () => requestJson(`/api/member/orders?${listQueryString}`) });
  const summaryQuery = useQuery<MemberOrderSummaryResponse>({ queryKey: ["member-orders", "summary", summaryQueryString], queryFn: () => requestJson(`/api/member/orders/summary?${summaryQueryString}`) });
  const productsQuery = useQuery<ProductFiltersResponse>({ queryKey: ["member-orders", "product-filters"], queryFn: () => requestJson("/api/member/orders/product-filters") });
  const detailQuery = useQuery<MemberOrderDetail>({ queryKey: ["member-orders", "detail", selectedId], queryFn: () => requestJson(`/api/member/orders/${encodeURIComponent(selectedId!)}`), enabled: !!selectedId });

  function setParams(values: Record<string, string | null>) {
    const next = new URLSearchParams(search);
    Object.entries(values).forEach(([key, value]) => value ? next.set(key, value) : next.delete(key));
    navigate(`/admin/orders${next.size ? `?${next.toString()}` : ""}`);
  }
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["member-orders"] });
  };
  const update = useMutation({
    mutationFn: async (input: UpdateMemberOrderRequest) => {
      if (!selectedId) throw new Error("未選取訂單。");
      const response = await apiRequest("PATCH", `/api/member/orders/${encodeURIComponent(selectedId)}`, input);
      return response.json() as Promise<MemberOrderDetail>;
    },
    onSuccess: async () => {
      // PATCH intentionally returns only safe editable data; re-read the detail
      // so its append-only timeline is never replaced with a partial response.
      await detailQuery.refetch();
      invalidate(); setConflict(false); toast({ title: "訂單處理資訊已更新" });
    },
    onError: async (error: Error) => {
      if (error.message.startsWith("409:")) {
        setConflict(true);
        await detailQuery.refetch();
        invalidate();
        toast({ title: "訂單版本已變更", description: "已載入最新資料，請確認後再儲存。", variant: "destructive" });
      } else toast({ title: "無法更新訂單", description: error.message, variant: "destructive" });
    },
  });

  const exportCsv = async () => {
    setExporting(true);
    try {
      const response = await fetch(`/api/member/orders/export.csv${summaryQueryString ? `?${summaryQueryString}` : ""}`, { credentials: "same-origin" });
      if (!response.ok) throw new Error((await response.json().catch(() => null))?.message || `匯出失敗（${response.status}）`);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url; link.download = "member-orders.csv"; link.click();
      URL.revokeObjectURL(url);
      if (response.headers.get("X-Export-Truncated") === "true") toast({ title: "已下載前 10,000 筆訂單", description: "符合條件的資料超過匯出上限，CSV 並非完整結果。", variant: "destructive" });
      else toast({ title: `訂單已匯出${response.headers.get("X-Export-Row-Count") ? `（${response.headers.get("X-Export-Row-Count")} 筆）` : ""}` });
    } catch (error) {
      toast({ title: "無法匯出訂單", description: error instanceof Error ? error.message : "請稍後再試。", variant: "destructive" });
    } finally { setExporting(false); }
  };

  const items = listQuery.data?.items || [];
  const totalPages = Math.max(1, Math.ceil((listQuery.data?.total || 0) / pageSize));
  return <div className="admin-shell min-h-screen bg-muted/30">
    <header className="sticky top-0 z-20 border-b bg-card"><div className="container mx-auto flex items-center gap-3 px-4 py-4"><Button variant="ghost" size="icon" onClick={() => navigate("/admin/dashboard")} aria-label="返回控制台"><ArrowLeft /></Button><SellCaseLogo className="h-auto w-[145px]" /><div className="ml-auto"><Button variant="outline" onClick={exportCsv} disabled={exporting} data-testid="member-orders-export">{exporting ? <Loader2 className="animate-spin" /> : <Download />}匯出 CSV</Button></div></div></header>
    <main className="container mx-auto space-y-6 px-4 py-6 sm:py-8" data-testid="member-orders-page">
      <div><h1 className="text-2xl font-bold">訂單管理</h1><p className="mt-1 text-sm text-muted-foreground">僅顯示你的商品與說明會成交訂單；付款與履約狀態分開管理。</p></div>
      <section aria-label="訂單篩選條件" className="rounded-lg border bg-card p-4"><div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
        <div className="lg:col-span-2"><Label htmlFor="member-orders-search">搜尋</Label><div className="relative mt-2"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" /><Input id="member-orders-search" data-testid="member-orders-search" className="pl-9" value={searchText} onChange={event => setSearchText(event.target.value)} placeholder="訂單、付款參考、顧客或商品" /></div></div>
        <div><Label>商品</Label><Select value={filter.productId || "all"} onValueChange={value => setParams({ productId: value === "all" ? null : value, page: null })}><SelectTrigger className="mt-2" data-testid="member-orders-product"><SelectValue placeholder="全部商品" /></SelectTrigger><SelectContent><SelectItem value="all">全部商品</SelectItem>{productsQuery.data?.items.map(product => <SelectItem key={product.id} value={product.id}>{product.name || "未保存"}{product.nameSource !== "recorded" ? "（舊資料）" : ""}</SelectItem>)}</SelectContent></Select></div>
        <div><Label>幣別</Label><Input className="mt-2 uppercase" value={filter.currency || ""} maxLength={3} placeholder="例如 TWD" onChange={event => setParams({ currency: event.target.value.trim().toUpperCase() || null, page: null })} data-testid="member-orders-currency" /></div>
        <div><Label>付款狀態</Label><Select value={filter.paymentStatus || "all"} onValueChange={value => setParams({ paymentStatus: value === "all" ? null : value, page: null })}><SelectTrigger className="mt-2" data-testid="member-orders-payment-filter"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">全部付款狀態</SelectItem>{Object.entries(paymentLabels).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></div>
        <div><Label>處理狀態</Label><Select value={filter.fulfillmentStatus || "all"} onValueChange={value => setParams({ fulfillmentStatus: value === "all" ? null : value, page: null })}><SelectTrigger className="mt-2" data-testid="member-orders-fulfillment-filter"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">全部處理狀態</SelectItem>{Object.entries(fulfillmentLabels).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></div>
        <div><Label htmlFor="member-orders-from">建立日期（起）</Label><Input id="member-orders-from" className="mt-2" type="date" value={filter.from?.slice(0, 10) || ""} onChange={event => setParams({ from: taipeiBoundary(event.target.value) || null, page: null })} data-testid="member-orders-from" /></div>
        <div><Label htmlFor="member-orders-to">建立日期（迄）</Label><Input id="member-orders-to" className="mt-2" type="date" value={filter.to?.slice(0, 10) || ""} onChange={event => setParams({ to: taipeiBoundary(event.target.value, true) || null, page: null })} data-testid="member-orders-to" /></div>
      </div>{(productsQuery.data?.truncated || productsQuery.data?.hasMore) && <p className="mt-3 text-xs text-muted-foreground">商品選項僅顯示前 500 項；可使用關鍵字搜尋完整歷史訂單。</p>}<Button className="mt-4" variant="ghost" size="sm" onClick={() => { setSearchText(""); navigate("/admin/orders"); }} data-testid="member-orders-clear-filters">清除篩選</Button></section>
      <section aria-label="訂單統計" className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{summaryQuery.isLoading ? <Card><CardContent className="flex min-h-32 items-center justify-center"><Loader2 className="animate-spin" /></CardContent></Card> : summaryQuery.isError ? <Card><CardContent className="p-4 text-sm">無法載入統計。<Button variant="ghost" size="sm" className="px-1" onClick={() => summaryQuery.refetch()}>重試</Button></CardContent></Card> : (summaryQuery.data?.currencies || []).map(summary => <Card key={summary.currency} data-testid={`member-orders-summary-${summary.currency}`}><CardContent className="p-4"><div className="flex justify-between"><b>{summary.currency}</b><span className="text-xs text-muted-foreground">全篩選結果</span></div><div className="mt-3 grid grid-cols-2 gap-3 text-sm"><div><p className="text-muted-foreground">付款毛額（含全額退款）</p><b>{formatMoney(summary.paidGrossMinor, summary.currency)}</b></div><div><p className="text-muted-foreground">退款</p><b>{formatMoney(summary.refundedMinor, summary.currency)}</b></div><div><p className="text-muted-foreground">淨營收</p><b className="text-emerald-800">{formatMoney(summary.netMinor, summary.currency)}</b></div><div><p className="text-muted-foreground">訂單狀態</p><b>{Object.values(summary.counts).reduce((total, count) => total + count, 0)} 筆</b></div></div></CardContent></Card>)}
      {!summaryQuery.isLoading && !summaryQuery.isError && !summaryQuery.data?.currencies.length && <Card><CardContent className="p-4 text-sm text-muted-foreground">目前篩選條件沒有可統計的訂單。</CardContent></Card>}</section>
      <section className="overflow-hidden rounded-lg border bg-card"><div className="flex items-center justify-between border-b p-4"><div><h2 className="font-semibold">訂單列表</h2><p className="text-sm text-muted-foreground">{listQuery.data ? `共 ${listQuery.data.total} 筆` : "載入中"}</p></div><Button size="sm" variant="ghost" onClick={() => { invalidate(); }} aria-label="重新整理訂單"><RefreshCw /></Button></div>
        {listQuery.isLoading ? <div className="grid min-h-64 place-items-center"><Loader2 className="animate-spin" /></div> : listQuery.isError ? <div className="grid min-h-64 place-items-center text-center"><div><b>無法載入訂單</b><p className="my-2 text-sm text-muted-foreground">{listQuery.error.message}</p><Button onClick={() => listQuery.refetch()}>重試</Button></div></div> : items.length === 0 ? <div className="grid min-h-64 place-items-center text-center"><div><ReceiptText className="mx-auto mb-3 text-muted-foreground" /><b>沒有符合條件的訂單</b><p className="mt-1 text-sm text-muted-foreground">調整篩選條件，或等待付款建立後再回來查看。</p></div></div> :
          <div className="divide-y">{items.map(order => <button type="button" key={order.id} className="grid w-full gap-3 p-4 text-left transition-colors hover:bg-muted/40 md:grid-cols-[minmax(0,1.5fr)_auto_auto_auto]" onClick={() => setParams({ order: order.id })} data-testid={`member-order-${order.id}`}><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><b className="truncate">{order.product.name || "未保存商品"}</b>{snapshotLabel(order.product.nameSource) && <span className="text-xs text-amber-800">未保存</span>}</div><p className="mt-1 truncate text-sm text-muted-foreground">{order.buyer.name || "未保存"} · {order.buyer.email || "未保存"}</p><p className="mt-1 text-xs text-muted-foreground">{formatDate(order.createdAt)} · <span className="font-mono">{order.id}</span></p></div><div className="md:text-right"><b>{formatMoney(order.money.netMinor, order.money.currency)}</b><p className="text-xs text-muted-foreground">總額 {formatMoney(order.money.amountMinor, order.money.currency)}</p></div><div className="flex items-start gap-2 md:flex-col"><Badge className={statusClass(order.paymentStatus)}>{paymentLabels[order.paymentStatus]}</Badge><Badge variant="outline">{fulfillmentLabels[order.fulfillmentStatus]}</Badge></div><span className="text-xs text-muted-foreground md:pt-1">查看明細</span></button>)}</div>}
        {items.length > 0 && <div className="flex items-center justify-between border-t p-4 text-sm"><span>第 {page} / {totalPages} 頁</span><div className="flex gap-2"><Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setParams({ page: String(page - 1) })}>上一頁</Button><Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setParams({ page: String(page + 1) })}>下一頁</Button></div></div>}
      </section>
    </main>
    {selectedId && <MemberOrderDetailDialog order={detailQuery.data} loading={detailQuery.isLoading} error={detailQuery.error || null} onClose={() => setParams({ order: null })} onRetry={() => detailQuery.refetch()} saving={update.isPending} conflict={conflict} onSave={input => update.mutate(input)} />}
  </div>;
}