import { useMemo } from "react";
import { useSearch } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { SellCaseLogo } from "@/components/sellcase-logo";

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
  return <main className="sales-page"><header><SellCaseLogo style={{ width: 142, height: "auto" }} /><span>訂單狀態</span></header><div className="studio-modal-card" style={{ maxWidth: 620, margin: "12vh auto", textAlign: "center" }}>
    {state === "paid" ? <><h1>{settings?.successTitle || "付款成功，謝謝您的支持！"}</h1><p>{settings?.successMessage || "您的購買已確認。"}</p>{settings?.successButtonUrl && <a className="sales-cta" href={settings.successButtonUrl}>{settings.successButtonLabel || "前往內容"}</a>}</> :
      state === "pending" ? <><h1>正在確認付款</h1><p>我們正在等待付款服務通知，請不要關閉此頁面。</p><div className="sales-spinner" /></> :
      state === "canceled" ? <><h1>{settings?.cancelTitle || "付款尚未完成"}</h1><p>{settings?.cancelMessage || "您可以返回優惠頁，再試一次。"}</p><a className="sales-cta" href={returnUrl}>返回優惠頁</a></> :
      <><h1>付款狀態無法確認</h1><p>目前沒有足夠資訊確認訂單，請稍後再試；我們不會未確認就顯示付款成功。</p><a className="sales-cta" href={returnUrl}>返回優惠頁</a></>}
  </div><footer className="sales-footer">
    {provider === "ecpay"
      ? "款項由主辦會員的綠界 ECPay 商店收取；商品履約、發票及退款請洽主辦會員。SellCase 提供訂單狀態與技術串接。"
      : "付款由 Stripe 處理；商品履約及退款條件請以賣方揭露與適用法律為準。"}
    {" "}<a href="/legal/refunds">退款與取消說明</a>
  </footer></main>;
}