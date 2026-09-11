import { useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { salesPageVideoEmbedUrl } from "@shared/salesPageTemplates";

export type EcommerceImage = { url: string; alt: string };
export type EcommerceOffer = { id?: string; name: string; amountMinor: number | null; currency: string; paymentProvider?: string };
export type EcommerceBlock =
  | { id: string; enabled: boolean; type: "hero"; headline: string; subheadline: string; imageUrl?: string; ctaLabel: string }
  | { id: string; enabled: boolean; type: "richText"; content: string }
  | { id: string; enabled: boolean; type: "image"; url: string; alt: string; caption?: string }
  | { id: string; enabled: boolean; type: "benefits"; headline: string; items: string[] }
  | { id: string; enabled: boolean; type: "faq"; items: { question: string; answer: string }[] }
  | { id: string; enabled: boolean; type: "video"; url: string; title: string }
  | { id: string; enabled: boolean; type: "testimonials"; headline: string; items: { name: string; quote: string; role?: string }[] };

const money = (offer?: EcommerceOffer) => !offer ? "價格載入中" : offer.amountMinor === null ? "價格請洽詢" : new Intl.NumberFormat("zh-TW", { style: "currency", currency: offer.currency, maximumFractionDigits: offer.currency === "TWD" ? 0 : 2 }).format(offer.amountMinor / 100);
export function EcommerceProductSection({ offer, images = [], summary, features = [], buttonLabel = "立即取得", onCheckout, preview = false, leadCapture = false }: { offer?: EcommerceOffer; images?: EcommerceImage[]; summary?: string; features?: string[]; buttonLabel?: string; onCheckout?: () => void; preview?: boolean; leadCapture?: boolean }) {
  const [active, setActive] = useState(0);
  const selectedIndex = Math.max(0, Math.min(active, images.length - 1));
  const selected = images[selectedIndex];
  return <section className="ecommerce-offer" data-testid="ecommerce-product-section"><div className="ecommerce-gallery">
    <div className="ecommerce-main-image">{selected ? <img src={selected.url} alt={selected.alt || ""} data-testid="product-main-image" /> : <div className="ecommerce-image-empty" data-testid="product-image-placeholder">尚未加入商品圖片</div>}</div>
    {images.length > 1 && <div className="ecommerce-thumbs" data-testid="gallery-thumbs">{images.map((image, index) => <button type="button" key={`${image.url}-${index}`} className={index === selectedIndex ? "active" : ""} onClick={() => setActive(index)} aria-label={`查看圖片 ${index + 1}`} aria-pressed={index === selectedIndex} data-testid={`product-thumbnail-${index}`}><img src={image.url} alt={image.alt || ""} /></button>)}</div>}
  </div><div className="ecommerce-summary"><span className="ecommerce-eyebrow">DIGITAL EDITION</span><h1>{offer?.name || "商品資訊載入中"}</h1><div className="ecommerce-price">{money(offer)}</div>
    {summary && <p className="ecommerce-description">{summary}</p>}
    {features.length > 0 && <ul className="ecommerce-features">{features.map((feature, index) => <li key={`${feature}-${index}`}><Check size={16} />{feature}</li>)}</ul>}
    <button type="button" className="ecommerce-buy" onClick={onCheckout}>{preview ? buttonLabel : buttonLabel}</button>
    <p className="ecommerce-fineprint">{preview ? "預覽模式不會開啟付款。" : leadCapture ? "留下資料後，主辦人會依你同意的目的聯絡你。" : `點擊後前往安全的 ${offer?.paymentProvider === "ecpay" ? "綠界 ECPay" : "Stripe"} 付款頁面。`}</p>
  </div></section>;
}
export function EcommerceContent({ blocks }: { blocks: EcommerceBlock[] }) {
 return <div className="ecommerce-content">{blocks.filter(block => block.enabled).map(block => {
   if (block.type === "hero") return <section className="ecommerce-copy" key={block.id}><h2>{block.headline}</h2><p>{block.subheadline}</p>{block.imageUrl && <img src={block.imageUrl} alt="" />}</section>;
   if (block.type === "richText") return <section className="ecommerce-copy" key={block.id}>{block.content.split("\n").map((line, i) => <p key={i}>{line}</p>)}</section>;
   if (block.type === "image") return <figure className="ecommerce-figure" key={block.id}><img src={block.url} alt={block.alt} />{block.caption && <figcaption>{block.caption}</figcaption>}</figure>;
   if (block.type === "benefits") return <section className="ecommerce-copy specs" key={block.id}><h2>{block.headline}</h2>{block.items.map((item, i) => <p key={i}>{item}</p>)}</section>;
   if (block.type === "video") { const src = salesPageVideoEmbedUrl(block.url); return src ? <section className="ecommerce-video" key={block.id}><h2>{block.title}</h2><iframe src={src} title={block.title} allowFullScreen /></section> : null; }
   if (block.type === "testimonials") return <section className="ecommerce-testimonials" key={block.id}><h2>{block.headline}</h2>{block.items.map((item, i) => <blockquote key={i}>“{item.quote}”<footer>{item.name}{item.role ? ` · ${item.role}` : ""}</footer></blockquote>)}</section>;
   if (block.type === "faq") return <section className="ecommerce-faq" key={block.id}><h2>常見問題</h2>{block.items.map((item, i) => <details key={i}><summary>{item.question}<ChevronDown size={16} /></summary><p>{item.answer}</p></details>)}</section>;
   return null;
 })}</div>;
}