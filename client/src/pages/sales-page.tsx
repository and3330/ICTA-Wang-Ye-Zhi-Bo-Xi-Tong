import { useEffect, useState } from "react";
import { useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { SellCaseLogo } from "@/components/sellcase-logo";
import { useMarketingConsent } from "@/components/marketing-consent";
import { EcommerceContent, EcommerceProductSection, type EcommerceBlock } from "@/components/sales-ecommerce";
import { CheckoutBuyerDialog, type CheckoutBuyer } from "@/components/checkout-buyer-dialog";

type Block =
  | { id: string; enabled: boolean; type: "hero"; headline: string; subheadline: string; imageUrl?: string; ctaLabel: string }
  | { id: string; enabled: boolean; type: "richText"; content: string }
  | { id: string; enabled: boolean; type: "image"; url: string; alt: string; caption?: string }
  | { id: string; enabled: boolean; type: "benefits"; headline: string; items: string[] }
  | { id: string; enabled: boolean; type: "offer"; headline: string; priceLabel?: string; buttonLabel: string; layout?: "standard" | "ecommerce"; images?: { url: string; alt: string }[]; summary?: string; features?: string[] }
  | { id: string; enabled: boolean; type: "faq"; items: { question: string; answer: string }[] }
  | { id: string; enabled: boolean; type: "video"; url: string; title: string }
  | { id: string; enabled: boolean; type: "testimonials"; headline: string; items: { name: string; quote: string; role?: string }[] };
type CheckoutSettings = { transitionTitle: string; transitionMessage: string; successTitle: string; successMessage: string; successButtonLabel: string; successButtonUrl?: string; cancelTitle: string; cancelMessage: string };
type TrialLeadCapture = { enabled: true; requiredFields: readonly ["name", "email", "consent"] | string[]; consentRequired: true; endpoint: string };
type PublicPage = {
  id: string; title: string; webinarId: string | null; offerId: string; slug?: string; platformUrl?: string; blocks: Block[]; checkoutSettings?: CheckoutSettings;
  offer: { name: string; amountMinor: number | null; currency: string; paymentProvider: "stripe" | "ecpay" | "lead_capture"; checkoutMode?: "lead_capture" };
  brand?: { name: string; localizedName: string; poweredBy: string };
  leadCapture?: TrialLeadCapture;
};

const getProductVisitorToken = () => {
  const key = "sellcase.product-visitor.v1";
  let token = localStorage.getItem(key);
  if (!token) { token = crypto.randomUUID(); localStorage.setItem(key, token); }
  return token;
};

async function openDirectCheckout(page: PublicPage, buyer: CheckoutBuyer) {
  const params = new URLSearchParams(location.search);
  const sourceCtaId = params.get("sourceCtaId");
  const sourceWebinarId = params.get("sourceWebinarId");
  const body = {
    salesPageId: page.id,
    visitorToken: getProductVisitorToken(),
    buyer,
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

function trackTrialPageView(page: PublicPage) {
  if (!page.leadCapture?.endpoint) return;
  const visitorToken = getProductVisitorToken();
  void fetch(`/api/trial-commerce/sales-pages/${encodeURIComponent(page.slug || "")}/events`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ visitorToken, dedupeKey: `view:${page.id}:${visitorToken}` }),
  }).catch(() => {});
}

function TrialLeadForm({ page }: { page: PublicPage }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [consent, setConsent] = useState(false);
  const [state, setState] = useState<"idle" | "sending" | "success" | "error">("idle");
  const [error, setError] = useState("");
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!page.leadCapture?.endpoint || state === "sending") return;
    setState("sending"); setError("");
    try {
      const response = await fetch(page.leadCapture.endpoint, {
        method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), email: email.trim(), consent }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.message || "目前無法送出，請稍後再試。");
      setState("success");
    } catch (reason) {
      setState("error");
      setError(reason instanceof Error ? reason.message : "目前無法送出，請稍後再試。");
    }
  };
  return <section id="trial-lead-form" className="studio-offer" data-testid="trial-lead-capture">
    <span className="studio-kicker">KEEP IN TOUCH</span>
    <h2>留下資料，取得下一步資訊</h2>
    <p style={{ color: "#4b6970" }}>我們會將你的資料交給此頁主辦人，僅用於回覆本頁相關資訊。</p>
    {state === "success" ? <div role="status" className="rounded-md border border-emerald-200 bg-emerald-50 p-4 text-emerald-950" data-testid="trial-lead-success">已收到你的資料，謝謝！</div> : <form className="space-y-3 text-left" onSubmit={submit} noValidate>
      <label className="block text-sm font-medium" htmlFor="trial-lead-name">姓名<input id="trial-lead-name" className="mt-1 w-full rounded-md border p-2" value={name} onChange={event => setName(event.target.value)} required maxLength={200} autoComplete="name" /></label>
      <label className="block text-sm font-medium" htmlFor="trial-lead-email">Email<input id="trial-lead-email" type="email" className="mt-1 w-full rounded-md border p-2" value={email} onChange={event => setEmail(event.target.value)} required maxLength={320} autoComplete="email" /></label>
      <label className="flex items-start gap-2 text-sm" htmlFor="trial-lead-consent"><input id="trial-lead-consent" type="checkbox" className="mt-1" checked={consent} onChange={event => setConsent(event.target.checked)} required />我同意主辦人依本頁目的聯絡我。</label>
      {state === "error" && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <button className="sales-cta" type="submit" disabled={state === "sending"}>{state === "sending" ? "送出中…" : "送出資料"}</button>
    </form>}
  </section>;
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
  const [buyerDialogOpen, setBuyerDialogOpen] = useState(false);
  const marketingConsent = useMarketingConsent();
  const { data, isLoading } = useQuery<PublicPage>({ queryKey: ["/api/sales-pages", slug], enabled: !!slug });
  useEffect(() => {
    if (!data) return;
    if (data.leadCapture?.enabled) trackTrialPageView(data);
    else if (marketingConsent === "granted") trackProductPageView(data);
  }, [data, marketingConsent]);
  if (isLoading) return <div className="sales-loading"><div className="sales-skeleton" /></div>;
  if (!data) return <div className="sales-loading"><div className="studio-modal-card"><b>此商品頁目前暫停</b><p>主辦人暫時沒有開放這個頁面。請稍後再試，或向主辦人詢問最新資訊。</p><p className="mt-3 text-xs text-muted-foreground">此頁不會顯示或揭露任何聯絡資料。</p><footer className="mt-5 text-xs">Powered by SellCase 開賣啦</footer></div></div>;
  const checkout = async (buyer: CheckoutBuyer) => {
    if (checkoutBusy) return;
    setCheckoutError("");
    setCheckoutBusy(true);
    try {
      await openDirectCheckout(data, buyer);
    } catch (error) {
      setCheckoutBusy(false);
      throw new Error(error instanceof Error ? error.message : "無法開啟付款頁面，請稍後再試。若手機阻擋新視窗，請允許彈出式視窗後重試。");
    }
  };
  const requestCheckout = () => setBuyerDialogOpen(true);
  const requestPrimaryAction = () => {
    if (data.leadCapture?.enabled) {
      document.getElementById("trial-lead-form")?.scrollIntoView({ behavior: "smooth", block: "center" });
      window.setTimeout(() => document.getElementById("trial-lead-name")?.focus(), 350);
      return;
    }
    requestCheckout();
  };
  const settings = data.checkoutSettings;
  const blocks = data.blocks.filter((block) => block.enabled);
  const productBlock = blocks.find((block): block is Extract<Block, { type: "offer" }> => block.type === "offer");
  if (productBlock?.layout === "ecommerce") return <main className="sales-page ecommerce-page">
    <header><SellCaseLogo style={{ width: 142, height: "auto" }} /><span>{data.leadCapture ? "留下資料・取得資訊" : "安全付款・數位內容"}</span></header>
    <div className="studio-frame"><EcommerceProductSection offer={data.offer} images={productBlock.images} summary={productBlock.summary} features={productBlock.features} buttonLabel={productBlock.buttonLabel || (data.leadCapture ? "留下資料" : "立即取得")} onCheckout={requestPrimaryAction} leadCapture={!!data.leadCapture} /><EcommerceContent blocks={blocks.filter((block): block is EcommerceBlock => ["hero", "richText", "image", "benefits", "faq", "video", "testimonials"].includes(block.type))} />{data.leadCapture?.enabled && <TrialLeadForm page={data} />}</div>
    {!data.leadCapture && <CheckoutBuyerDialog open={buyerDialogOpen} onOpenChange={setBuyerDialogOpen} onContinue={checkout} />}
    {checkoutBusy && <div className="studio-modal" role="dialog" aria-live="polite"><div className="studio-modal-card"><div className="sales-spinner" aria-hidden="true" /><b>{settings?.transitionTitle || "正在前往安全付款頁面"}</b><p>{settings?.transitionMessage || "請稍候，我們正在準備您的付款。"}</p></div></div>}
    {checkoutError && <div className="studio-modal" role="alert"><div className="studio-modal-card"><b>付款頁面尚未開啟</b><p>{checkoutError}</p><button className="studio-icon-btn" onClick={() => setCheckoutError("")}>返回優惠頁</button></div></div>}
    <footer className="sales-footer">{data.leadCapture ? data.brand?.poweredBy || "Powered by SellCase 開賣啦" : data.offer.paymentProvider === "ecpay" ? "本商品由主辦會員販售，並由其自有綠界 ECPay 商店收款；商品履約、發票及退款由主辦會員依其政策與適用法律負責。SellCase 提供頁面與技術串接。" : "付款將由 Stripe 處理。商品內容、履約及退款條件請以本頁賣方揭露與適用法律為準。"} {!data.leadCapture && <a href="/legal/refunds">退款與取消說明</a>}</footer>
  </main>;
  return <main className="sales-page">
     <header><SellCaseLogo style={{ width: 142, height: "auto" }} /><span>{data.leadCapture ? "留下資料・查看商品內容" : "前往付款・查看商品內容"}</span></header>
    <div className="studio-frame">
      {blocks.map((block) => {
         if (block.type === "hero") return <section className="studio-preview-hero" key={block.id}><span className="studio-kicker" style={{ color: "#99ead7" }}>為正在前進的你準備</span><h1>{block.headline}</h1><p>{block.subheadline}</p>{block.imageUrl && <img src={block.imageUrl} alt="" />}<button className="sales-cta" onClick={requestPrimaryAction}>{block.ctaLabel}</button></section>;
        if (block.type === "richText") return <section className="studio-preview-section" key={block.id}><p>{block.content}</p></section>;
        if (block.type === "image") return <figure className="studio-preview-section" key={block.id}><img src={block.url} alt={block.alt} style={{ width: "100%" }} />{block.caption && <figcaption style={{ color: "#66808a", fontSize: 12, marginTop: 9 }}>{block.caption}</figcaption>}</figure>;
        if (block.type === "benefits") return <section className="studio-preview-section" key={block.id}><h2>{block.headline}</h2>{block.items.map((item) => <div className="studio-benefit" key={item}>{item}</div>)}</section>;
          if (block.type === "offer") return <section className="studio-offer" key={block.id}><span className="studio-kicker">現在加入</span><h2>{block.headline}</h2><div className="studio-price">{price(data.offer)}</div><p style={{ color: "#4b6970" }}>{data.offer.name}</p><button className="sales-cta" onClick={requestPrimaryAction}>{data.leadCapture ? "留下資料" : block.buttonLabel}</button>{data.leadCapture ? <p style={{ fontSize: 12, color: "#66808a" }}>送出前請閱讀並勾選聯絡同意。</p> : <p style={{ fontSize: 12, color: "#66808a" }}>點擊後將離開 SellCase，前往安全的 {data.offer.paymentProvider === "ecpay" ? "綠界 ECPay" : "Stripe"} 付款頁面。本頁不含購物車或物流配送。</p>}</section>;
         if (block.type === "faq") return <section className="studio-faq" key={block.id}><h2>常見問題</h2>{block.items.map((item) => <details key={item.question}><summary>{item.question}</summary><p>{item.answer}</p></details>)}</section>;
         return null;
      })}
    </div>
     {checkoutBusy && <div className="studio-modal" role="dialog" aria-live="polite"><div className="studio-modal-card"><div className="sales-spinner" aria-hidden="true" /><b>{settings?.transitionTitle || "正在前往安全付款頁面"}</b><p>{settings?.transitionMessage || "請稍候，我們正在準備您的付款。"}</p></div></div>}
      {data.leadCapture?.enabled && <TrialLeadForm page={data} />}
      {!data.leadCapture && <CheckoutBuyerDialog open={buyerDialogOpen} onOpenChange={setBuyerDialogOpen} onContinue={checkout} />}
     {checkoutError && <div className="studio-modal" role="alert"><div className="studio-modal-card"><b>付款頁面尚未開啟</b><p>{checkoutError}</p><button className="studio-icon-btn" onClick={() => setCheckoutError("")}>返回優惠頁</button></div></div>}
      <footer className="sales-footer">
         {data.leadCapture ? data.brand?.poweredBy || "Powered by SellCase 開賣啦" : data.offer.paymentProvider === "ecpay"
          ? "本商品由主辦會員販售，並由其自有綠界 ECPay 商店收款；商品履約、發票及退款由主辦會員依其政策與適用法律負責。SellCase 提供頁面與技術串接。"
          : "付款將由 Stripe 處理。商品內容、履約及退款條件請以本頁賣方揭露與適用法律為準。"}
         {!data.leadCapture && <><span>{" "}</span><a href="/legal/refunds">退款與取消說明</a></>}
      </footer>
  </main>;
}