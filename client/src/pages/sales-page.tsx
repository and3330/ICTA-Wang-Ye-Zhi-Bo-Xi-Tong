import { useEffect, useState } from "react";
import { useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { SellCaseLogo } from "@/components/sellcase-logo";
import { useMarketingConsent } from "@/components/marketing-consent";

type Block =
  | { id: string; enabled: boolean; type: "hero"; headline: string; subheadline: string; imageUrl?: string; ctaLabel: string }
  | { id: string; enabled: boolean; type: "richText"; content: string }
  | { id: string; enabled: boolean; type: "image"; url: string; alt: string; caption?: string }
  | { id: string; enabled: boolean; type: "benefits"; headline: string; items: string[] }
  | { id: string; enabled: boolean; type: "offer"; headline: string; priceLabel?: string; buttonLabel: string }
  | { id: string; enabled: boolean; type: "faq"; items: { question: string; answer: string }[] };
type CheckoutSettings = { transitionTitle: string; transitionMessage: string; successTitle: string; successMessage: string; successButtonLabel: string; successButtonUrl?: string; cancelTitle: string; cancelMessage: string };
type PublicPage = { id: string; title: string; webinarId: string | null; offerId: string; blocks: Block[]; checkoutSettings?: CheckoutSettings; offer: { name: string; amountMinor: number | null; currency: string; paymentProvider: "stripe" | "ecpay" } };

const getProductVisitorToken = () => {
  const key = "sellcase.product-visitor.v1";
  let token = localStorage.getItem(key);
  if (!token) { token = crypto.randomUUID(); localStorage.setItem(key, token); }
  return token;
};

async function openDirectCheckout(page: PublicPage) {
  const params = new URLSearchParams(location.search);
  const sourceCtaId = params.get("sourceCtaId");
  const sourceWebinarId = params.get("sourceWebinarId");
  const body = {
    salesPageId: page.id,
    visitorToken: getProductVisitorToken(),
    ...(params.get("sessionId") ? { sessionId: params.get("sessionId") } : {}),
    ...(sourceCtaId && sourceWebinarId ? { sourceCtaId, sourceWebinarId } : {}),
  };
  const popup = window.open("", "_blank");
  try {
    const response = await fetch(`/api/products/${encodeURIComponent(page.offerId)}/checkout`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: JSON.stringify(body) });
    const result = await response.json().catch(() => null);
    if (!response.ok) throw new Error(result?.message || "無法建立付款，請稍後再試。");
    if (result.provider === "ecpay") {
      if (!result.action || !result.fields) throw new Error("綠界付款資料不完整。");
      const target = popup || window; const form = target.document.createElement("form"); form.method = "POST"; form.action = result.action;
      Object.entries(result.fields as Record<string, string | number>).forEach(([name, value]) => { const input = target.document.createElement("input"); input.type = "hidden"; input.name = name; input.value = String(value); form.appendChild(input); });
      target.document.body.appendChild(form); form.submit(); return;
    }
    if (!result.url) throw new Error("付款網址無法使用。");
    if (popup) popup.location.href = result.url; else window.location.href = result.url;
  } catch (error) { popup?.close(); throw error; }
}

function trackProductPageView(page: PublicPage) {
  const params = new URLSearchParams(location.search);
  const sourceCtaId = params.get("sourceCtaId");
  const sourceWebinarId = params.get("sourceWebinarId");
  const visitorToken = getProductVisitorToken();
  void fetch(`/api/products/${encodeURIComponent(page.offerId)}/events`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      eventType: "landing_view",
      pageId: page.id,
      visitorToken,
      dedupeKey: `landing:${page.id}:${visitorToken}`,
      ...(sourceCtaId && sourceWebinarId ? { sourceCtaId, sourceWebinarId } : {}),
    }),
  }).catch(() => {});
}

function price(offer: PublicPage["offer"]) {
  if (offer.amountMinor === null) return "價格請洽詢";
  const wholeAmount = offer.amountMinor / 100;
  const digits = offer.currency === "TWD" ? 0 : 2;
  return new Intl.NumberFormat("zh-TW", { style: "currency", currency: offer.currency, maximumFractionDigits: digits }).format(wholeAmount);
}

export default function SalesPage() {
  const { slug } = useParams<{ slug: string }>();
  const [checkoutError, setCheckoutError] = useState("");
  const [checkoutBusy, setCheckoutBusy] = useState(false);
  const marketingConsent = useMarketingConsent();
  const { data, isLoading } = useQuery<PublicPage>({ queryKey: ["/api/sales-pages", slug], enabled: !!slug });
  useEffect(() => { if (data && marketingConsent === "granted") trackProductPageView(data); }, [data, marketingConsent]);
  if (isLoading) return <div className="sales-loading"><div className="sales-skeleton" /></div>;
  if (!data) return <div className="sales-loading"><div className="studio-modal-card"><b>此銷售頁目前無法開啟</b><p>請確認網址，或稍後再試。</p></div></div>;
  const checkout = async () => { if (checkoutBusy) return; setCheckoutError(""); setCheckoutBusy(true); try { await openDirectCheckout(data); } catch (e) { setCheckoutBusy(false); setCheckoutError(e instanceof Error ? e.message : "無法開啟付款頁面，請稍後再試。若手機阻擋新視窗，請允許彈出式視窗後重試。"); } };
  const settings = data.checkoutSettings;
  const blocks = data.blocks.filter((block) => block.enabled);
  return <main className="sales-page">
     <header><SellCaseLogo style={{ width: 142, height: "auto" }} /><span>前往付款・查看商品內容</span></header>
    <div className="studio-frame">
      {blocks.map((block) => {
        if (block.type === "hero") return <section className="studio-preview-hero" key={block.id}><span className="studio-kicker" style={{ color: "#99ead7" }}>為正在前進的你準備</span><h1>{block.headline}</h1><p>{block.subheadline}</p>{block.imageUrl && <img src={block.imageUrl} alt="" />}<button className="sales-cta" onClick={checkout}>{block.ctaLabel}</button></section>;
        if (block.type === "richText") return <section className="studio-preview-section" key={block.id}><p>{block.content}</p></section>;
        if (block.type === "image") return <figure className="studio-preview-section" key={block.id}><img src={block.url} alt={block.alt} style={{ width: "100%" }} />{block.caption && <figcaption style={{ color: "#66808a", fontSize: 12, marginTop: 9 }}>{block.caption}</figcaption>}</figure>;
        if (block.type === "benefits") return <section className="studio-preview-section" key={block.id}><h2>{block.headline}</h2>{block.items.map((item) => <div className="studio-benefit" key={item}>{item}</div>)}</section>;
         if (block.type === "offer") return <section className="studio-offer" key={block.id}><span className="studio-kicker">現在加入</span><h2>{block.headline}</h2><div className="studio-price">{price(data.offer)}</div><p style={{ color: "#4b6970" }}>{data.offer.name}</p><button className="sales-cta" onClick={checkout}>{block.buttonLabel}</button><p style={{ fontSize: 12, color: "#66808a" }}>點擊後將離開 SellCase，前往安全的 {data.offer.paymentProvider === "ecpay" ? "綠界 ECPay" : "Stripe"} 付款頁面。本頁不含購物車或物流配送。</p></section>;
        return <section className="studio-faq" key={block.id}><h2>常見問題</h2>{block.items.map((item) => <details key={item.question}><summary>{item.question}</summary><p>{item.answer}</p></details>)}</section>;
      })}
    </div>
     {checkoutBusy && <div className="studio-modal" role="dialog" aria-live="polite"><div className="studio-modal-card"><div className="sales-spinner" aria-hidden="true" /><b>{settings?.transitionTitle || "正在前往安全付款頁面"}</b><p>{settings?.transitionMessage || "請稍候，我們正在準備您的付款。"}</p></div></div>}
     {checkoutError && <div className="studio-modal" role="alert"><div className="studio-modal-card"><b>付款頁面尚未開啟</b><p>{checkoutError}</p><button className="sales-cta" onClick={checkout}>再試一次</button><button className="studio-icon-btn" onClick={() => setCheckoutError("")}>返回優惠頁</button></div></div>}
      <footer className="sales-footer">
        {data.offer.paymentProvider === "ecpay"
          ? "本商品由主辦會員販售，並由其自有綠界 ECPay 商店收款；商品履約、發票及退款由主辦會員依其政策與適用法律負責。SellCase 提供頁面與技術串接。"
          : "付款將由 Stripe 處理。商品內容、履約及退款條件請以本頁賣方揭露與適用法律為準。"}
        {" "}<a href="/legal/refunds">退款與取消說明</a>
      </footer>
  </main>;
}