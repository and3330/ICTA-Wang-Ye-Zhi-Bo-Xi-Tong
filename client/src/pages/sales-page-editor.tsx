import { useEffect, useMemo, useState } from "react";
import { useLocation, useParams } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowLeft, ChevronDown, ChevronUp, Copy, Eye, EyeOff, ExternalLink, ImagePlus, Loader2, Monitor, Plus, Save, Smartphone, Trash2 } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";

type Block =
  | { id: string; enabled: boolean; type: "hero"; headline: string; subheadline: string; imageUrl?: string; ctaLabel: string }
  | { id: string; enabled: boolean; type: "richText"; content: string }
  | { id: string; enabled: boolean; type: "image"; url: string; alt: string; caption?: string }
  | { id: string; enabled: boolean; type: "benefits"; headline: string; items: string[] }
  | { id: string; enabled: boolean; type: "offer"; headline: string; priceLabel?: string; buttonLabel: string }
  | { id: string; enabled: boolean; type: "faq"; items: { question: string; answer: string }[] };
type CheckoutSettings = { transitionTitle: string; transitionMessage: string; successTitle: string; successMessage: string; successButtonLabel: string; successButtonUrl?: string; cancelTitle: string; cancelMessage: string };
type Page = { id: string; webinarId: string | null; offerId: string; slug: string; title: string; status: "draft" | "published"; version: number; orderedBlocks: Block[]; checkoutSettings?: CheckoutSettings; publishedOrderedBlocks?: Block[] | null; publishedCheckoutSettings?: CheckoutSettings | null };
const defaultCheckoutSettings: CheckoutSettings = { transitionTitle: "正在前往安全付款頁面", transitionMessage: "請稍候，我們正在準備您的付款。", successTitle: "付款成功，謝謝您的支持！", successMessage: "您的購買已確認。", successButtonLabel: "前往內容", successButtonUrl: "", cancelTitle: "付款尚未完成", cancelMessage: "您可以返回優惠頁，再試一次。" };
const name: Record<Block["type"], string> = { hero: "開場主視覺", richText: "文字段落", image: "圖片", benefits: "方案亮點", offer: "購買方案", faq: "常見問題" };
const makeId = () => `block_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
const blank = (type: Block["type"]): Block => {
  const id = makeId(), enabled = true;
  if (type === "hero") return { id, enabled, type, headline: "把你的專業，變成下一步的成績。", subheadline: "這堂課將帶你建立更清楚、可執行的工作方法。", ctaLabel: "立即加入課程" };
  if (type === "richText") return { id, enabled, type, content: "不是再累積更多資訊，而是把真正重要的事做得更好。\n\n這是一段用來說明你的方法、經驗與這堂課為何存在的文字。" };
  if (type === "image") return { id, enabled, type, url: "https://", alt: "課程說明圖片", caption: "" };
  if (type === "benefits") return { id, enabled, type, headline: "你會帶走的改變", items: ["一套可立即套用的工作框架", "清楚辨識下一步的優先順序", "把方法落地到你的真實情境"] };
  if (type === "offer") return { id, enabled, type, headline: "準備好，就從這裡開始", priceLabel: "", buttonLabel: "取得完整課程" };
  return { id, enabled, type, items: [{ question: "這堂課適合我嗎？", answer: "如果你正希望把專業轉成具體行動，這堂課就是為你設計的。" }] };
};
function Preview({ blocks, mobile }: { blocks: Block[]; mobile: boolean }) {
  return <div className={`studio-frame ${mobile ? "mobile" : ""}`}>{blocks.filter(b => b.enabled).map((b) => {
    if (b.type === "hero") return <section className="studio-preview-hero" key={b.id}><span className="studio-kicker" style={{ color: "#99ead7" }}>線上課程</span><h1>{b.headline}</h1><p>{b.subheadline}</p>{b.imageUrl && b.imageUrl !== "https://" && <img src={b.imageUrl} alt="" />}<button className="studio-preview-button">{b.ctaLabel}</button></section>;
    if (b.type === "richText") return <section className="studio-preview-section" key={b.id}><p>{b.content}</p></section>;
    if (b.type === "image") return <figure className="studio-preview-section" key={b.id}>{b.url !== "https://" && <img src={b.url} alt={b.alt} style={{ width: "100%" }} />}<figcaption>{b.caption}</figcaption></figure>;
    if (b.type === "benefits") return <section className="studio-preview-section" key={b.id}><h2>{b.headline}</h2>{b.items.map((x) => <div className="studio-benefit" key={x}>{x}</div>)}</section>;
    if (b.type === "offer") return <section className="studio-offer" key={b.id}><span className="studio-kicker">限時加入</span><h2>{b.headline}</h2><div className="studio-price">售價以商品設定為準</div><button className="studio-preview-button">{b.buttonLabel}</button></section>;
    return <section className="studio-faq" key={b.id}><h2>常見問題</h2>{b.items.map(x => <details key={x.question}><summary>{x.question}</summary><p>{x.answer}</p></details>)}</section>;
  })}</div>;
}
function Inspector({ block, update, disabled, uploading, upload, checkoutSettings, updateCheckoutSettings }: { block?: Block; update: (block: Block) => void; disabled?: boolean; uploading?: boolean; upload: (file?: File) => void; checkoutSettings: CheckoutSettings; updateCheckoutSettings: (next: CheckoutSettings) => void }) {
  if (!block) return <aside className="studio-inspector"><div><span className="studio-kicker">內容設定</span><h2>選擇一個區塊</h2><p className="studio-note">從左側點選區塊後，就能在這裡修改內容。</p></div></aside>;
  const field = (label: string, key: string, long = false) => { const inputId = `sales-block-${block.id}-${key}`; return <div className="studio-field"><label htmlFor={inputId}>{label}</label>{long ? <textarea id={inputId} disabled={disabled} value={String((block as any)[key] || "")} onChange={e => update({ ...block, [key]: e.target.value } as Block)} /> : <input id={inputId} disabled={disabled} value={String((block as any)[key] || "")} onChange={e => update({ ...block, [key]: e.target.value } as Block)} />}</div>; };
  const checkoutField = (label: string, key: keyof CheckoutSettings, long = false) => { const inputId = `sales-checkout-${key}`; return <div className="studio-field"><label htmlFor={inputId}>{label}</label>{long ? <textarea id={inputId} disabled={disabled} value={checkoutSettings[key] || ""} onChange={e => updateCheckoutSettings({ ...checkoutSettings, [key]: e.target.value })} /> : <input id={inputId} disabled={disabled} value={checkoutSettings[key] || ""} onChange={e => updateCheckoutSettings({ ...checkoutSettings, [key]: e.target.value })} />}</div>; };
  return <aside className="studio-inspector"><div><span className="studio-kicker">{name[block.type]}</span><h2>內容設定</h2>
    {block.type === "hero" && <>{field("主標題", "headline", true)}{field("輔助說明", "subheadline", true)}{field("按鈕文字", "ctaLabel")}{field("主視覺圖片網址", "imageUrl")}<label className="studio-add" style={{ display: "block", textAlign: "center" }}><input type="file" accept="image/*" hidden disabled={disabled || uploading} onChange={e => upload(e.target.files?.[0])} />{uploading ? <Loader2 size={14} className="animate-spin" /> : <ImagePlus size={14} />} 上傳圖片</label><p className="studio-note">圖片只支援 HTTPS 網址或 /uploads/ 開頭的已上傳檔案。</p></>}
    {block.type === "richText" && field("段落內容", "content", true)}
    {block.type === "image" && <>{field("圖片網址", "url")}{field("替代文字", "alt")}{field("圖片說明", "caption")}<label className="studio-add" style={{ display: "block", textAlign: "center" }}><input type="file" accept="image/*" hidden disabled={disabled || uploading} onChange={e => upload(e.target.files?.[0])} />{uploading ? <Loader2 size={14} className="animate-spin" /> : <ImagePlus size={14} />} 上傳圖片</label><p className="studio-note">圖片只支援 HTTPS 網址或 /uploads/ 開頭的已上傳檔案。</p></>}
    {block.type === "benefits" && <>{field("標題", "headline")}<div className="studio-field"><label htmlFor={`sales-block-${block.id}-items`}>亮點項目（每行一項）</label><textarea id={`sales-block-${block.id}-items`} disabled={disabled} value={block.items.join("\n")} onChange={e => update({ ...block, items: e.target.value.split("\n").filter(Boolean) })} /></div></>}
    {block.type === "offer" && <>{field("標題", "headline")}<p className="studio-note">售價固定取自商品設定，避免頁面文字與實際收款不一致。</p>{field("按鈕文字", "buttonLabel")}</>}
    {block.type === "faq" && <div className="studio-field"><label htmlFor={`sales-block-${block.id}-items`}>問答（問題與回答以空白行分隔）</label><textarea id={`sales-block-${block.id}-items`} disabled={disabled} value={block.items.map(i => `${i.question}\n${i.answer}`).join("\n\n")} onChange={e => update({ ...block, items: e.target.value.split("\n\n").map(x => { const [question, ...rest] = x.split("\n"); return { question: question || "常見問題", answer: rest.join("\n") || "請填寫回答" }; }) })} /></div>}
  </div><div style={{ borderTop: "1px solid var(--studio-line)", marginTop: 24, paddingTop: 20 }}><span className="studio-kicker">Checkout Flow</span><h2>付款流程設定</h2><p className="studio-note">付款轉場、成功與取消頁面的文字會同步顯示在公開購買結果頁。</p>{checkoutField("轉場標題", "transitionTitle")}{checkoutField("轉場說明", "transitionMessage", true)}{checkoutField("付款成功標題", "successTitle")}{checkoutField("付款成功說明", "successMessage", true)}{checkoutField("成功按鈕文字", "successButtonLabel")}{checkoutField("成功按鈕網址（選填）", "successButtonUrl")} {checkoutSettings.successButtonUrl && !(/^\//.test(checkoutSettings.successButtonUrl) && !checkoutSettings.successButtonUrl.startsWith("//")) && !/^https:\/\//i.test(checkoutSettings.successButtonUrl) && <p className="studio-note" style={{ color: "#b84d3b" }}>請使用 HTTPS 網址，或同源相對路徑（例如 /members）。</p>}{checkoutField("取消付款標題", "cancelTitle")}{checkoutField("取消付款說明", "cancelMessage", true)}</div></aside>;
}
export default function SalesPageEditor() {
  const { id, pageId } = useParams<{ id?: string; pageId: string }>(); const [, setLocation] = useLocation();
  const standalone = !id;
  const base = standalone ? "/api/product-sales-pages" : `/api/webinars/${id}/sales-pages`;
  const { data, isLoading, error } = useQuery<Page>({ queryKey: [base, pageId], enabled: !!pageId });
  const [blocks, setBlocks] = useState<Block[]>([]); const [title, setTitle] = useState(""); const [slug, setSlug] = useState(""); const [checkoutSettings, setCheckoutSettings] = useState<CheckoutSettings>(defaultCheckoutSettings); const [version, setVersion] = useState(0); const [status, setStatus] = useState<"draft" | "published">("draft"); const [selected, setSelected] = useState<string>(); const [mobile, setMobile] = useState(false); const [state, setState] = useState<"saved" | "unsaved" | "saving" | "error">("saved"); const [errorMessage, setErrorMessage] = useState(""); const [picker, setPicker] = useState(false); const [uploading, setUploading] = useState(false);
  useEffect(() => { if (data) { setBlocks(data.orderedBlocks); setTitle(data.title); setSlug(data.slug); setCheckoutSettings({ ...defaultCheckoutSettings, ...data.checkoutSettings }); setVersion(data.version); setStatus(data.status); setSelected(data.orderedBlocks[0]?.id); setState("saved"); } }, [data]);
  const active = useMemo(() => blocks.find(b => b.id === selected), [blocks, selected]);
  const publishedMatches = useMemo(() => status === "published"
    && Array.isArray(data?.publishedOrderedBlocks)
    && JSON.stringify(blocks) === JSON.stringify(data.publishedOrderedBlocks)
    && JSON.stringify(checkoutSettings) === JSON.stringify({ ...defaultCheckoutSettings, ...data.publishedCheckoutSettings }), [status, data?.publishedOrderedBlocks, data?.publishedCheckoutSettings, blocks, checkoutSettings]);
  const dirty = (next: Block[]) => { setBlocks(next); setState("unsaved"); setErrorMessage(""); };
  const detailKey = [base, pageId];
  const listKey = [base];
  const cachePage = (p: Page) => {
    setVersion(p.version); setBlocks(p.orderedBlocks); setTitle(p.title); setSlug(p.slug); setCheckoutSettings({ ...defaultCheckoutSettings, ...p.checkoutSettings }); setStatus(p.status);
    queryClient.setQueryData(detailKey, p);
    queryClient.setQueryData<Page[]>(listKey, (old) => old?.map(item => item.id === p.id ? { ...item, ...p } : item));
    void queryClient.invalidateQueries({ queryKey: listKey });
  };
  const save = useMutation({
    mutationFn: async () => {
      setState("saving"); setErrorMessage("");
       const r = await apiRequest("PATCH", `${base}/${pageId}`, { version, title, slug, blocks, checkoutSettings });
      return r.json() as Promise<Page>;
    },
    onSuccess: p => { cachePage(p); setState("saved"); },
    onError: (error: any) => { setState("error"); setErrorMessage(error?.message || "儲存失敗，請重新載入後再試。"); },
  });
  const publish = useMutation({
    mutationFn: async (action: "publish" | "unpublish") => {
      setState("saving"); setErrorMessage("");
      let currentVersion = version;
      let currentPage: Page | undefined;
      if (action === "publish") {
        // Publish is a two-step commit: persist the exact local draft, then publish that response version.
         const savedResponse = await apiRequest("PATCH", `${base}/${pageId}`, { version: currentVersion, title, slug, blocks, checkoutSettings });
        currentPage = await savedResponse.json() as Page;
        currentVersion = currentPage.version;
        cachePage(currentPage);
      }
       const publishedResponse = await apiRequest("POST", `${base}/${pageId}/${action}`, { version: currentVersion });
      return await publishedResponse.json() as Page;
    },
    onSuccess: p => { cachePage(p); setState("saved"); },
    onError: (error: any) => { setState("error"); setErrorMessage(error?.message || "操作失敗，請保留目前內容並重試。"); },
  });
  const busy = save.isPending || publish.isPending;
  const upload = async (file?: File) => { if (!file || !active) return; setUploading(true); try { const body = new FormData(); body.append("file", file); const response = await fetch("/api/upload", { method: "POST", body, credentials: "same-origin" }); const result = await response.json(); if (!response.ok) throw new Error(result.message || "圖片上傳失敗"); const key = active.type === "hero" ? "imageUrl" : active.type === "image" ? "url" : null; if (key) dirty(blocks.map(block => block.id === active.id ? { ...block, [key]: result.url } as Block : block)); } catch (e) { setState("error"); setErrorMessage(e instanceof Error ? e.message : "圖片上傳失敗"); } finally { setUploading(false); } };
  const publicUrl = `${window.location.origin}/sales/${slug}`;
  if (isLoading) return <div className="sales-loading"><div className="sales-skeleton" /></div>;
  if (!data || error) return <div className="sales-loading"><div className="studio-modal-card"><b>找不到這個銷售頁</b><p>它可能已被刪除，或你沒有存取權。</p><button className="sales-cta" onClick={() => setLocation(standalone ? "/admin/products" : `/admin/webinar/${id}`)}>返回管理頁</button></div></div>;
  return <main className="sales-studio"><header className="studio-topbar"><button className="studio-icon-btn" disabled={busy} onClick={() => setLocation(standalone ? "/admin/products" : `/admin/webinar/${id}`)}><ArrowLeft size={18} /></button><span className="studio-mark">SALES STUDIO</span><span className={`studio-status ${state}`}>{state === "saving" ? "儲存中" : state === "unsaved" ? "尚有未儲存變更" : state === "error" ? errorMessage || "儲存失敗，請重試" : "所有變更已儲存"}</span><button className="studio-icon-btn hidden-mobile" disabled={busy} onClick={() => setMobile(!mobile)} title="切換預覽">{mobile ? <Monitor size={17} /> : <Smartphone size={17} />}</button><button className="studio-icon-btn" disabled={busy} onClick={() => navigator.clipboard.writeText(publicUrl)} title="複製網址"><Copy size={17} /></button><button className="studio-icon-btn" disabled={busy || state !== "saved"} onClick={() => window.open(`/sales/${slug}`, "_blank", "noopener,noreferrer")} title="開啟公開頁"><ExternalLink size={17} /></button><button className="sales-cta" style={{ margin: 0, padding: "9px 12px" }} onClick={() => save.mutate()} disabled={busy || state === "saved"}><Save size={15} /> 儲存草稿</button>{status === "published" ? <><button className="sales-cta" style={{ margin: 0, padding: "9px 12px" }} onClick={() => publish.mutate("publish")} disabled={busy}>更新發布</button><button className="sales-cta" style={{ margin: 0, padding: "9px 12px", background: "#f5c2b5" }} onClick={() => publish.mutate("unpublish")} disabled={busy}>取消發布</button></> : <button className="sales-cta" style={{ margin: 0, padding: "9px 12px" }} onClick={() => publish.mutate("publish")} disabled={busy}>發布頁面</button>}</header>
    <div className="studio-layout"><aside className="studio-blocks"><span className="studio-kicker">頁面結構</span><div className="studio-block-list">{blocks.map((b, index) => <div className={`studio-block ${selected === b.id ? "active" : ""} ${!b.enabled ? "off" : ""}`} key={b.id} onClick={() => !busy && setSelected(b.id)}><span className="studio-block-index">{String(index + 1).padStart(2, "0")}</span><button className="studio-block-name" disabled={busy} onClick={() => setSelected(b.id)}>{name[b.type]}</button><div className="studio-block-actions"><button disabled={busy} className="studio-icon-btn" onClick={() => dirty(blocks.map(x => x.id === b.id ? { ...x, enabled: !x.enabled } : x))}>{b.enabled ? <Eye size={14} /> : <EyeOff size={14} />}</button><button disabled={busy || index === 0} className="studio-icon-btn" onClick={() => { const n = [...blocks]; [n[index - 1], n[index]] = [n[index], n[index - 1]]; dirty(n); }}><ChevronUp size={14} /></button><button disabled={busy || index === blocks.length - 1} className="studio-icon-btn" onClick={() => { const n = [...blocks]; [n[index], n[index + 1]] = [n[index + 1], n[index]]; dirty(n); }}><ChevronDown size={14} /></button><button disabled={busy} className="studio-icon-btn" onClick={() => { const n = blocks.filter(x => x.id !== b.id); dirty(n); setSelected(n[0]?.id); }}><Trash2 size={14} /></button></div></div>)}</div><button className="studio-add" disabled={busy} onClick={() => setPicker(true)}><Plus size={14} style={{ verticalAlign: "middle" }} /> 新增內容區塊</button></aside>
      <section className="studio-canvas"><div style={{ maxWidth: 850, margin: "0 auto 15px", display: "flex", gap: 8, alignItems: "center" }}><input disabled={busy || status === "published"} value={title} onChange={e => { setTitle(e.target.value); setState("unsaved"); setErrorMessage(""); }} aria-label="頁面名稱" title={status === "published" ? "已發布頁面須先取消發布，才能修改名稱與網址。" : undefined} style={{ border: 0, background: "transparent", font: '700 19px "Space Grotesk"', color: "#123446", width: "60%" }} /><span className="studio-kicker">/{slug}</span><span className="studio-kicker" style={{ marginLeft: "auto", color: publishedMatches ? "#0b8b86" : "#c1784e" }}>{publishedMatches ? "公開版本" : "草稿預覽"}</span></div>{status === "published" && <p className="studio-note" style={{ maxWidth: 850, margin: "0 auto 12px" }}>頁面已發布；名稱與網址識別須先取消發布才能修改。內容變更請先儲存草稿，再按「更新發布」。</p>}<Preview blocks={blocks} mobile={mobile} /></section>
       <Inspector disabled={busy} uploading={uploading} upload={upload} block={active} checkoutSettings={checkoutSettings} updateCheckoutSettings={next => { if (!busy) { setCheckoutSettings(next); setState("unsaved"); setErrorMessage(""); } }} update={b => { if (!busy) dirty(blocks.map(x => x.id === b.id ? b : x)); }} /></div>
    {picker && <div className="studio-modal" onClick={() => setPicker(false)}><div className="studio-modal-card" onClick={e => e.stopPropagation()}><span className="studio-kicker">新增區塊</span><h2 style={{ fontFamily: '"Space Grotesk"', margin: "8px 0 18px" }}>選擇想傳達的內容</h2><div style={{ display: "grid", gap: 7 }}>{(Object.keys(name) as Block["type"][]).map(t => <button className="studio-add" disabled={busy} key={t} onClick={() => { const b = blank(t); dirty([...blocks, b]); setSelected(b.id); setPicker(false); }}>{name[t]}</button>)}</div></div></div>}
  </main>;
}