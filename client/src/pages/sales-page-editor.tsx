import { useEffect, useMemo, useState } from "react";
import { useLocation, useParams } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowLeft, ChevronDown, ChevronUp, Copy, Eye, EyeOff, ExternalLink, Monitor, Plus, Save, Smartphone, Trash2 } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";

type Block =
  | { id: string; enabled: boolean; type: "hero"; headline: string; subheadline: string; imageUrl?: string; ctaLabel: string }
  | { id: string; enabled: boolean; type: "richText"; content: string }
  | { id: string; enabled: boolean; type: "image"; url: string; alt: string; caption?: string }
  | { id: string; enabled: boolean; type: "benefits"; headline: string; items: string[] }
  | { id: string; enabled: boolean; type: "offer"; headline: string; priceLabel?: string; buttonLabel: string }
  | { id: string; enabled: boolean; type: "faq"; items: { question: string; answer: string }[] };
type Page = { id: string; webinarId: string; offerId: string; slug: string; title: string; status: "draft" | "published"; version: number; orderedBlocks: Block[] };
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
    if (b.type === "offer") return <section className="studio-offer" key={b.id}><span className="studio-kicker">限時加入</span><h2>{b.headline}</h2>{b.priceLabel && <div className="studio-price">{b.priceLabel}</div>}<button className="studio-preview-button">{b.buttonLabel}</button></section>;
    return <section className="studio-faq" key={b.id}><h2>常見問題</h2>{b.items.map(x => <details key={x.question}><summary>{x.question}</summary><p>{x.answer}</p></details>)}</section>;
  })}</div>;
}
function Inspector({ block, update, disabled }: { block?: Block; update: (block: Block) => void; disabled?: boolean }) {
  if (!block) return <aside className="studio-inspector"><div><span className="studio-kicker">內容設定</span><h2>選擇一個區塊</h2><p className="studio-note">從左側點選區塊後，就能在這裡修改內容。</p></div></aside>;
  const field = (label: string, key: string, long = false) => <div className="studio-field"><label>{label}</label>{long ? <textarea disabled={disabled} value={String((block as any)[key] || "")} onChange={e => update({ ...block, [key]: e.target.value } as Block)} /> : <input disabled={disabled} value={String((block as any)[key] || "")} onChange={e => update({ ...block, [key]: e.target.value } as Block)} />}</div>;
  return <aside className="studio-inspector"><div><span className="studio-kicker">{name[block.type]}</span><h2>內容設定</h2>
    {block.type === "hero" && <>{field("主標題", "headline", true)}{field("輔助說明", "subheadline", true)}{field("按鈕文字", "ctaLabel")}{field("主視覺圖片網址", "imageUrl")}<p className="studio-note">圖片只支援 HTTPS 網址或 /uploads/ 開頭的已上傳檔案。</p></>}
    {block.type === "richText" && field("段落內容", "content", true)}
    {block.type === "image" && <>{field("圖片網址", "url")}{field("替代文字", "alt")}{field("圖片說明", "caption")}<p className="studio-note">圖片只支援 HTTPS 網址或 /uploads/ 開頭的已上傳檔案。</p></>}
    {block.type === "benefits" && <>{field("標題", "headline")}<div className="studio-field"><label>亮點項目（每行一項）</label><textarea disabled={disabled} value={block.items.join("\n")} onChange={e => update({ ...block, items: e.target.value.split("\n").filter(Boolean) })} /></div></>}
    {block.type === "offer" && <>{field("標題", "headline")}{field("價格補充（選填）", "priceLabel")}{field("按鈕文字", "buttonLabel")}</>}
    {block.type === "faq" && <div className="studio-field"><label>問答（問題與回答以空白行分隔）</label><textarea disabled={disabled} value={block.items.map(i => `${i.question}\n${i.answer}`).join("\n\n")} onChange={e => update({ ...block, items: e.target.value.split("\n\n").map(x => { const [question, ...rest] = x.split("\n"); return { question: question || "常見問題", answer: rest.join("\n") || "請填寫回答" }; }) })} /></div>}
  </div></aside>;
}
export default function SalesPageEditor() {
  const { id, pageId } = useParams<{ id: string; pageId: string }>(); const [, setLocation] = useLocation();
  const { data, isLoading, error } = useQuery<Page>({ queryKey: ["/api/webinars", id, "sales-pages", pageId], enabled: !!id && !!pageId });
  const [blocks, setBlocks] = useState<Block[]>([]); const [title, setTitle] = useState(""); const [slug, setSlug] = useState(""); const [version, setVersion] = useState(0); const [status, setStatus] = useState<"draft" | "published">("draft"); const [selected, setSelected] = useState<string>(); const [mobile, setMobile] = useState(false); const [state, setState] = useState<"saved" | "unsaved" | "saving" | "error">("saved"); const [errorMessage, setErrorMessage] = useState(""); const [picker, setPicker] = useState(false);
  useEffect(() => { if (data) { setBlocks(data.orderedBlocks); setTitle(data.title); setSlug(data.slug); setVersion(data.version); setStatus(data.status); setSelected(data.orderedBlocks[0]?.id); setState("saved"); } }, [data]);
  const active = useMemo(() => blocks.find(b => b.id === selected), [blocks, selected]);
  const dirty = (next: Block[]) => { setBlocks(next); setState("unsaved"); setErrorMessage(""); };
  const detailKey = ["/api/webinars", id, "sales-pages", pageId];
  const listKey = ["/api/webinars", id, "sales-pages"];
  const cachePage = (p: Page) => {
    setVersion(p.version); setBlocks(p.orderedBlocks); setTitle(p.title); setSlug(p.slug); setStatus(p.status);
    queryClient.setQueryData(detailKey, p);
    queryClient.setQueryData<Page[]>(listKey, (old) => old?.map(item => item.id === p.id ? { ...item, ...p } : item));
    void queryClient.invalidateQueries({ queryKey: listKey });
  };
  const save = useMutation({
    mutationFn: async () => {
      setState("saving"); setErrorMessage("");
      const r = await apiRequest("PATCH", `/api/webinars/${id}/sales-pages/${pageId}`, { version, title, slug, blocks });
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
        const savedResponse = await apiRequest("PATCH", `/api/webinars/${id}/sales-pages/${pageId}`, { version: currentVersion, title, slug, blocks });
        currentPage = await savedResponse.json() as Page;
        currentVersion = currentPage.version;
        cachePage(currentPage);
      }
      const publishedResponse = await apiRequest("POST", `/api/webinars/${id}/sales-pages/${pageId}/${action}`, { version: currentVersion });
      return await publishedResponse.json() as Page;
    },
    onSuccess: p => { cachePage(p); setState("saved"); },
    onError: (error: any) => { setState("error"); setErrorMessage(error?.message || "操作失敗，請保留目前內容並重試。"); },
  });
  const busy = save.isPending || publish.isPending;
  const publicUrl = `${window.location.origin}/sales/${slug}`;
  if (isLoading) return <div className="sales-loading"><div className="sales-skeleton" /></div>;
  if (!data || error) return <div className="sales-loading"><div className="studio-modal-card"><b>找不到這個銷售頁</b><p>它可能已被刪除，或你沒有存取權。</p><button className="sales-cta" onClick={() => setLocation(`/admin/webinar/${id}`)}>返回直播設定</button></div></div>;
  return <main className="sales-studio"><header className="studio-topbar"><button className="studio-icon-btn" disabled={busy} onClick={() => setLocation(`/admin/webinar/${id}`)}><ArrowLeft size={18} /></button><span className="studio-mark">SALES STUDIO</span><span className={`studio-status ${state}`}>{state === "saving" ? "儲存中" : state === "unsaved" ? "尚有未儲存變更" : state === "error" ? errorMessage || "儲存失敗，請重試" : "所有變更已儲存"}</span><button className="studio-icon-btn hidden-mobile" disabled={busy} onClick={() => setMobile(!mobile)} title="切換預覽">{mobile ? <Monitor size={17} /> : <Smartphone size={17} />}</button><button className="studio-icon-btn" disabled={busy} onClick={() => navigator.clipboard.writeText(publicUrl)} title="複製網址"><Copy size={17} /></button><button className="studio-icon-btn" disabled={busy || state !== "saved"} onClick={() => window.open(`/sales/${slug}`, "_blank", "noopener,noreferrer")} title="開啟公開頁"><ExternalLink size={17} /></button><button className="sales-cta" style={{ margin: 0, padding: "9px 12px" }} onClick={() => save.mutate()} disabled={busy || state === "saved"}><Save size={15} /> 儲存</button><button className="sales-cta" style={{ margin: 0, padding: "9px 12px", background: status === "published" ? "#f5c2b5" : undefined }} onClick={() => publish.mutate(status === "published" ? "unpublish" : "publish")} disabled={busy}>{status === "published" ? "取消發布" : "發布頁面"}</button></header>
    <div className="studio-layout"><aside className="studio-blocks"><span className="studio-kicker">頁面結構</span><div className="studio-block-list">{blocks.map((b, index) => <div className={`studio-block ${selected === b.id ? "active" : ""} ${!b.enabled ? "off" : ""}`} key={b.id} onClick={() => !busy && setSelected(b.id)}><span className="studio-block-index">{String(index + 1).padStart(2, "0")}</span><button className="studio-block-name" disabled={busy} onClick={() => setSelected(b.id)}>{name[b.type]}</button><div className="studio-block-actions"><button disabled={busy} className="studio-icon-btn" onClick={() => dirty(blocks.map(x => x.id === b.id ? { ...x, enabled: !x.enabled } : x))}>{b.enabled ? <Eye size={14} /> : <EyeOff size={14} />}</button><button disabled={busy || index === 0} className="studio-icon-btn" onClick={() => { const n = [...blocks]; [n[index - 1], n[index]] = [n[index], n[index - 1]]; dirty(n); }}><ChevronUp size={14} /></button><button disabled={busy || index === blocks.length - 1} className="studio-icon-btn" onClick={() => { const n = [...blocks]; [n[index], n[index + 1]] = [n[index + 1], n[index]]; dirty(n); }}><ChevronDown size={14} /></button><button disabled={busy} className="studio-icon-btn" onClick={() => { const n = blocks.filter(x => x.id !== b.id); dirty(n); setSelected(n[0]?.id); }}><Trash2 size={14} /></button></div></div>)}</div><button className="studio-add" disabled={busy} onClick={() => setPicker(true)}><Plus size={14} style={{ verticalAlign: "middle" }} /> 新增內容區塊</button></aside>
      <section className="studio-canvas"><div style={{ maxWidth: 850, margin: "0 auto 15px", display: "flex", gap: 8, alignItems: "center" }}><input disabled={busy} value={title} onChange={e => { setTitle(e.target.value); setState("unsaved"); setErrorMessage(""); }} aria-label="頁面名稱" style={{ border: 0, background: "transparent", font: '700 19px "Space Grotesk"', color: "#123446", width: "60%" }} /><span className="studio-kicker">/{slug}</span><span className="studio-kicker" style={{ marginLeft: "auto", color: state === "saved" && status === "published" ? "#0b8b86" : "#c1784e" }}>{status === "published" && state === "saved" ? "公開版本" : "草稿預覽"}</span></div><Preview blocks={blocks} mobile={mobile} /></section>
      <Inspector disabled={busy} block={active} update={b => { if (!busy) dirty(blocks.map(x => x.id === b.id ? b : x)); }} /></div>
    {picker && <div className="studio-modal" onClick={() => setPicker(false)}><div className="studio-modal-card" onClick={e => e.stopPropagation()}><span className="studio-kicker">新增區塊</span><h2 style={{ fontFamily: '"Space Grotesk"', margin: "8px 0 18px" }}>選擇想傳達的內容</h2><div style={{ display: "grid", gap: 7 }}>{(Object.keys(name) as Block["type"][]).map(t => <button className="studio-add" disabled={busy} key={t} onClick={() => { const b = blank(t); dirty([...blocks, b]); setSelected(b.id); setPicker(false); }}>{name[t]}</button>)}</div></div></div>}
  </main>;
}