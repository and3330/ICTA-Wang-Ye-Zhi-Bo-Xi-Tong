import { useMemo } from "react";
import { useSearch } from "wouter";
import { useQuery } from "@tanstack/react-query";

type Settings = { successTitle: string; successMessage: string; successButtonLabel: string; successButtonUrl?: string; cancelTitle: string; cancelMessage: string };
type Result = { status: "pending" | "paid" | "canceled" | "failed" | "unknown"; checkoutSettings?: Settings; offerSlug?: string };

export default function PurchaseResult() {
  const search = useSearch();
  const params = useMemo(() => new URLSearchParams(search), [search]);
  const provider = params.get("provider") || (params.get("p") === "e" ? "ecpay" : params.get("p") === "s" ? "stripe" : null);
  const statusToken = params.get("status_token") || params.get("t");
  const identifier = provider === "ecpay" ? (params.get("order_id") || statusToken) : params.get("session_id");
  const key = provider === "ecpay" ? "order_id" : "session_id";
  const query = useQuery<Result>({
    queryKey: ["/api/public/checkout-status", provider, identifier, statusToken],
    queryFn: async () => {
      const query = provider === "ecpay"
        ? `provider=ecpay&status_token=${encodeURIComponent(statusToken || "")}`
        : `${key}=${encodeURIComponent(identifier || "")}&status_token=${encodeURIComponent(statusToken || "")}`;
      const r = await fetch(`/api/public/checkout-status?${query}`);
      if (!r.ok) throw new Error("status unavailable");
      return r.json();
    },
    enabled: !!identifier && !!statusToken && (provider === "stripe" || provider === "ecpay"),
    refetchInterval: query => query.state.data?.status === "pending" ? 2500 : false,
    retry: 2,
  });
  const state = !identifier || !provider ? "unknown" : query.data?.status === "paid" ? "paid" : params.get("checkout") === "canceled" ? "canceled" : query.data?.status || (query.isError ? "failed" : "pending");
  const settings = query.data?.checkoutSettings;
  const returnUrl = query.data?.offerSlug ? `/sales/${encodeURIComponent(query.data.offerSlug)}` : "/";
  return <main className="sales-page"><header><span>開賣啦 SELLCASE</span><span>訂單狀態</span></header><div className="studio-modal-card" style={{ maxWidth: 620, margin: "12vh auto", textAlign: "center" }}>
    {state === "paid" ? <><h1>{settings?.successTitle || "付款成功，謝謝您的支持！"}</h1><p>{settings?.successMessage || "您的購買已確認。"}</p>{settings?.successButtonUrl && <a className="sales-cta" href={settings.successButtonUrl}>{settings.successButtonLabel || "前往內容"}</a>}</> :
      state === "pending" ? <><h1>正在確認付款</h1><p>我們正在等待付款服務通知，請不要關閉此頁面。</p><div className="sales-spinner" /></> :
      state === "canceled" ? <><h1>{settings?.cancelTitle || "付款尚未完成"}</h1><p>{settings?.cancelMessage || "您可以返回優惠頁，再試一次。"}</p><a className="sales-cta" href={returnUrl}>返回優惠頁</a></> :
      <><h1>付款狀態無法確認</h1><p>目前沒有足夠資訊確認訂單，請稍後再試；我們不會未確認就顯示付款成功。</p><a className="sales-cta" href={returnUrl}>返回優惠頁</a></>}
  </div><footer className="sales-footer">由 開賣啦 SellCase 安全處理訂單</footer></main>;
}