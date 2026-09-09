import { useEffect, useState } from "react";
import { useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { openSalesPageOfferCheckout, trackWebinarEvent } from "@/lib/webinar-tracking";

type Block =
  | { id: string; enabled: boolean; type: "hero"; headline: string; subheadline: string; imageUrl?: string; ctaLabel: string }
  | { id: string; enabled: boolean; type: "richText"; content: string }
  | { id: string; enabled: boolean; type: "image"; url: string; alt: string; caption?: string }
  | { id: string; enabled: boolean; type: "benefits"; headline: string; items: string[] }
  | { id: string; enabled: boolean; type: "offer"; headline: string; priceLabel?: string; buttonLabel: string }
  | { id: string; enabled: boolean; type: "faq"; items: { question: string; answer: string }[] };
type PublicPage = { id: string; title: string; webinarId: string; offerId: string; blocks: Block[]; offer: { name: string; amountMinor: number | null; currency: string } };

function price(offer: PublicPage["offer"]) {
  if (offer.amountMinor === null) return "價格請洽詢";
  const digits = offer.currency === "TWD" ? 0 : 2;
  return new Intl.NumberFormat("zh-TW", { style: "currency", currency: offer.currency, maximumFractionDigits: digits }).format(offer.amountMinor / (10 ** digits));
}

export default function SalesPage() {
  const { slug } = useParams<{ slug: string }>();
  const [checkoutError, setCheckoutError] = useState("");
  const { data, isLoading } = useQuery<PublicPage>({ queryKey: ["/api/sales-pages", slug], enabled: !!slug });
  useEffect(() => { if (data) trackWebinarEvent(data.webinarId, "landing_view"); }, [data]);
  if (isLoading) return <div className="sales-loading"><div className="sales-skeleton" /></div>;
  if (!data) return <div className="sales-loading"><div className="studio-modal-card"><b>此銷售頁目前無法開啟</b><p>請確認網址，或稍後再試。</p></div></div>;
  const checkout = async () => { setCheckoutError(""); try { await openSalesPageOfferCheckout(data.webinarId, data.id, data.offerId); } catch (e) { setCheckoutError(e instanceof Error ? e.message : "無法開啟付款頁面，請稍後再試。"); } };
  const blocks = data.blocks.filter((block) => block.enabled);
  return <main className="sales-page">
     <header><span>開賣啦 SELLCASE</span><span>安心付款・立即取得內容</span></header>
    <div className="studio-frame">
      {blocks.map((block) => {
        if (block.type === "hero") return <section className="studio-preview-hero" key={block.id}><span className="studio-kicker" style={{ color: "#99ead7" }}>為正在前進的你準備</span><h1>{block.headline}</h1><p>{block.subheadline}</p>{block.imageUrl && <img src={block.imageUrl} alt="" />}<button className="sales-cta" onClick={checkout}>{block.ctaLabel}</button></section>;
        if (block.type === "richText") return <section className="studio-preview-section" key={block.id}><p>{block.content}</p></section>;
        if (block.type === "image") return <figure className="studio-preview-section" key={block.id}><img src={block.url} alt={block.alt} style={{ width: "100%" }} />{block.caption && <figcaption style={{ color: "#66808a", fontSize: 12, marginTop: 9 }}>{block.caption}</figcaption>}</figure>;
        if (block.type === "benefits") return <section className="studio-preview-section" key={block.id}><h2>{block.headline}</h2>{block.items.map((item) => <div className="studio-benefit" key={item}>{item}</div>)}</section>;
        if (block.type === "offer") return <section className="studio-offer" key={block.id}><span className="studio-kicker">現在加入</span><h2>{block.headline}</h2><div className="studio-price">{block.priceLabel || price(data.offer)}</div><p style={{ color: "#4b6970" }}>{data.offer.name}</p><button className="sales-cta" onClick={checkout}>{block.buttonLabel}</button></section>;
        return <section className="studio-faq" key={block.id}><h2>常見問題</h2>{block.items.map((item) => <details key={item.question}><summary>{item.question}</summary><p>{item.answer}</p></details>)}</section>;
      })}
    </div>
    {checkoutError && <div className="studio-modal"><div className="studio-modal-card"><b>付款頁面尚未開啟</b><p>{checkoutError}</p><button className="sales-cta" onClick={checkout}>再試一次</button></div></div>}
     <footer className="sales-footer">由 開賣啦 SellCase 安全處理訂單</footer>
  </main>;
}