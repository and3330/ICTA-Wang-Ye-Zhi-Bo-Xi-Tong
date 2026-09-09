import { useEffect, useRef, useState } from "react";
import { useLocation, useParams } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowLeft, ChevronDown, ChevronUp, Copy, Eye, EyeOff, ExternalLink, Loader2, Monitor, Save, Smartphone, Upload } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

type Kind = "hero" | "intro" | "audience" | "agenda" | "instructor" | "faq" | "countdown" | "cta";
type Block = { id: string; type: Kind; enabled: boolean; [key: string]: any };
type Page = { version: number; status?: "draft" | "published"; blocks: Block[]; brandSettings?: any; publishedBlocks?: Block[] | null; publishedBrandSettings?: any };
type Response = { landingPage: Page };
const labels: Record<Kind, string> = { hero: "首屏 Banner", intro: "講座介紹", audience: "適合對象／亮點", agenda: "活動大綱", instructor: "講師介紹", faq: "常見問題", countdown: "倒數計時", cta: "行動呼籲" };
const imageOk = (s: string) => !s || s.startsWith("https://") || s.startsWith("/uploads/");
const make = (type: Kind, id = `${type}_${Date.now()}`): Block => {
  const base: Block = { id, type, enabled: true };
  if (type === "hero") return { ...base, headline: "把握這場，讓下一步更清楚", subheadline: "一場為你整理方法與可執行步驟的線上說明會。", ctaLabel: "立即預約席位", imageUrl: "" };
  if (type === "intro") return { ...base, headline: "你會在這場說明會學到什麼？", content: "用一個晚上，掌握最重要的觀念與方法。" };
  if (type === "audience" || type === "agenda") return { ...base, headline: type === "agenda" ? "活動流程" : "這場活動適合你，如果你想要", items: ["建立清楚、可重複的工作流程", "找到適合自己的下一步"] };
  if (type === "instructor") return { ...base, headline: "關於講師", name: "你的講師", bio: "多年實務經驗，將複雜內容整理成人人都能採用的方法。", imageUrl: "" };
  if (type === "faq") return { ...base, headline: "常見問題", items: [{ question: "活動適合初學者嗎？", answer: "適合，不需要先備知識。" }] };
  if (type === "countdown") return { ...base, headline: "席位有限，現在就預約" };
  return { ...base, headline: "準備好開始了嗎？", ctaLabel: "免費報名" };
};
const defaults = () => (["hero", "intro", "audience", "agenda", "instructor", "countdown", "faq", "cta"] as Kind[]).map((x) => make(x, x));

function Preview({ blocks, brand, mobile }: { blocks: Block[]; brand: any; mobile: boolean }) {
  const go = () => document.getElementById("landing-editor-form")?.scrollIntoView({ behavior: "smooth" });
  return <div className={`landing-preview ${mobile ? "mobile" : ""}`}>
    {blocks.filter((b) => b.enabled).map((b) => {
      if (b.type === "hero") return <section className="landing-preview-hero" style={{ background: `linear-gradient(135deg,${brand.primaryColor || "#123d5a"},${brand.secondaryColor || "#0b8b86"})` }} key={b.id}><span>ONLINE WEBINAR</span><h1>{b.headline}</h1><p>{b.subheadline}</p>{imageOk(b.imageUrl) && b.imageUrl && <img src={b.imageUrl} alt="" />}<button onClick={go}>{b.ctaLabel}</button></section>;
      if (b.type === "intro") return <section className="landing-preview-section" key={b.id}><h2>{b.headline}</h2><p>{b.content}</p></section>;
      if (b.type === "audience" || b.type === "agenda") return <section className="landing-preview-section" key={b.id}><h2>{b.headline}</h2>{b.items?.map((x: string) => <div className="landing-list-item" key={x}>{x}</div>)}</section>;
      if (b.type === "instructor") return <section className="landing-preview-section landing-instructor" key={b.id}>{imageOk(b.imageUrl) && b.imageUrl && <img src={b.imageUrl} alt="" />}<div><h2>{b.headline}</h2><h3>{b.name}</h3><p>{b.bio}</p></div></section>;
      if (b.type === "faq") return <section className="landing-preview-section" key={b.id}><h2>{b.headline}</h2>{b.items?.map((x: any) => <details key={x.question}><summary>{x.question}</summary><p>{x.answer}</p></details>)}</section>;
      return <section className="landing-preview-cta" key={b.id}><h2>{b.headline}</h2><button onClick={go}>{b.ctaLabel || "立即報名"}</button></section>;
    })}
  </div>;
}

function Inspector({ block, brand, update, updateBrand, upload, uploading }: { block?: Block; brand: Record<string, string>; update: (p: any) => void; updateBrand: (key: string, value: string) => void; upload: () => void; uploading: boolean }) {
  if (!block) return <aside className="landing-inspector"><p>請從左側選擇區塊。</p></aside>;
  const text = (key: string, label: string, area = false) => <label>{label}{area ? <textarea value={block[key] || ""} onChange={(e) => update({ [key]: e.target.value })} /> : <input value={block[key] || ""} onChange={(e) => update({ [key]: e.target.value })} />}</label>;
  return <aside className="landing-inspector"><small>品牌設定</small>
    {(["primaryColor", "secondaryColor", "backgroundColor"] as const).map((key) => <label key={key}>{key === "primaryColor" ? "主色" : key === "secondaryColor" ? "強調色" : "頁面背景色"}<input type="color" value={brand[key]} onChange={(e) => updateBrand(key, e.target.value)} /></label>)}
    <small>{labels[block.type]}內容設定</small>
    {block.type === "hero" && <>{text("headline", "主標題", true)}{text("subheadline", "輔助說明", true)}{text("ctaLabel", "按鈕文字")}{text("imageUrl", "圖片網址")}<button className="landing-upload" type="button" onClick={upload} disabled={uploading}>{uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}使用已上傳資產</button><p>可上傳圖片，或使用 HTTPS、/uploads/ 開頭網址。</p></>}
    {block.type === "intro" && <>{text("headline", "標題")}{text("content", "段落內容", true)}</>}
    {(block.type === "audience" || block.type === "agenda") && <>{text("headline", "標題")}<label>項目（每行一項）<textarea value={(block.items || []).join("\n")} onChange={(e) => update({ items: e.target.value.split("\n") })} /></label></>}
    {block.type === "instructor" && <>{text("headline", "區塊標題")}{text("name", "講師姓名")}{text("bio", "講師介紹", true)}{text("imageUrl", "照片網址")}<button className="landing-upload" type="button" onClick={upload} disabled={uploading}>{uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}使用已上傳資產</button><p>可上傳圖片，或使用 HTTPS、/uploads/ 開頭網址。</p></>}
    {block.type === "countdown" && text("headline", "標題")}
    {block.type === "cta" && <>{text("headline", "標題")}{text("ctaLabel", "按鈕文字")}</>}
    {block.type === "faq" && <label>問答（每組問題與回答各一行，組與組之間空一行）<textarea value={(block.items || []).map((x: any) => `${x.question}\n${x.answer}`).join("\n\n")} onChange={(e) => update({ items: e.target.value.split("\n\n").map((x) => { const [question, ...answer] = x.split("\n"); return { question: question || "常見問題", answer: answer.join("\n") || "請填寫回答" }; }) })} /></label>}
  </aside>;
}

export default function LandingPageEditor() {
  const { id } = useParams<{ id: string }>(); const [, setLocation] = useLocation();
  const { data, isLoading, error } = useQuery<Response>({ queryKey: ["/api/webinars", id, "landing-page", "preview"], enabled: !!id });
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [draftMatchesPublic, setDraftMatchesPublic] = useState(false);
  const [blocks, setBlocks] = useState<Block[]>(defaults()); const [selected, setSelected] = useState("hero"); const [brand, setBrand] = useState({ primaryColor: "#123d5a", secondaryColor: "#0b8b86", backgroundColor: "#f8fcfb" }); const [version, setVersion] = useState(0); const [published, setPublished] = useState(false); const [mobile, setMobile] = useState(false); const [state, setState] = useState<"saved" | "unsaved" | "saving" | "error">("saved"); const [message, setMessage] = useState("");
  useEffect(() => { const page = data?.landingPage; if (page) { setBlocks(page.blocks?.length ? page.blocks : defaults()); setSelected(page.blocks?.[0]?.id || "hero"); setBrand(page.brandSettings || brand); setVersion(page.version); setPublished(page.status === "published"); setDraftMatchesPublic(page.status === "published" && JSON.stringify(page.blocks) === JSON.stringify(page.publishedBlocks) && JSON.stringify(page.brandSettings) === JSON.stringify(page.publishedBrandSettings)); } }, [data]);
  const active = blocks.find((b) => b.id === selected);
  const change = (next: Block[]) => { setBlocks(next); setDraftMatchesPublic(false); setState("unsaved"); setMessage(""); };
  const update = (patch: any) => { if (active) change(blocks.map((b) => b.id === active.id ? { ...b, ...patch } : b)); };
  const updateBrand = (key: string, value: string) => { setBrand((current) => ({ ...current, [key]: value })); setDraftMatchesPublic(false); setState("unsaved"); setMessage(""); };
  const uploadImage = async (file?: File) => {
    if (!file || !active || !["hero", "instructor"].includes(active.type)) return;
    setUploading(true); setMessage("");
    try {
      const body = new FormData(); body.append("file", file);
      const response = await fetch("/api/upload", { method: "POST", body });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "圖片上傳失敗");
      update({ imageUrl: result.url });
    } catch (error) {
      setState("error"); setMessage(error instanceof Error ? error.message : "圖片上傳失敗");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };
  const save = useMutation({ mutationFn: async (action: "save" | "publish" | "unpublish") => {
    if (blocks.some((b) => ["hero", "instructor"].includes(b.type) && !imageOk(b.imageUrl || ""))) throw new Error("圖片網址必須使用 HTTPS 或 /uploads/ 開頭。");
    setState("saving"); const response = await apiRequest("PATCH", `/api/webinars/${id}/landing-page`, { version, blocks, brandSettings: brand }); const page = await response.json(); const next = page.version ?? version + 1; setVersion(next);
    if (action !== "save") { const result = await apiRequest("POST", `/api/webinars/${id}/landing-page/${action}`, { version: next }); const publishedPage = await result.json(); setVersion(publishedPage.version ?? next); setPublished(action === "publish"); setDraftMatchesPublic(action === "publish"); }
    else setDraftMatchesPublic(false);
  }, onSuccess: () => { setState("saved"); setMessage(""); }, onError: (e: any) => { setState("error"); setMessage(e?.message || "操作失敗，請重新載入後再試。"); } });
  const publicUrl = `${window.location.origin}/register/${id}`; const previewUrl = `${publicUrl}?preview=1`;
  if (isLoading) return <div className="landing-editor-loading">落地頁載入中…</div>;
  if (error || !data?.landingPage) return <div className="landing-editor-loading"><p>無法載入落地頁，請確認說明會 ID 與擁有權。</p></div>;
  return <main className="landing-editor"><input ref={fileRef} className="hidden" type="file" accept="image/*" onChange={(event) => void uploadImage(event.target.files?.[0])} /><header className="landing-editor-bar"><button onClick={() => setLocation(`/admin/webinar/${id}`)}><ArrowLeft size={17} /></button><b>WEBINAR LANDING STUDIO</b><span className={state}>{state === "saving" ? "儲存中…" : state === "unsaved" ? "草稿有未儲存變更" : state === "error" ? message : published && draftMatchesPublic ? "公開版本已同步" : published ? "草稿已儲存，尚未發布" : "草稿已儲存"}</span><button onClick={() => setMobile(!mobile)} title="切換預覽">{mobile ? <Monitor size={16} /> : <Smartphone size={16} />}</button><button onClick={() => window.open(previewUrl, "_blank", "noopener,noreferrer")}><ExternalLink size={15} />草稿預覽</button><button disabled={!published} onClick={() => window.open(publicUrl, "_blank", "noopener,noreferrer")}>開啟公開頁</button><button disabled={!published} onClick={() => navigator.clipboard.writeText(publicUrl)}><Copy size={15} />複製公開網址</button><button disabled={state === "saving" || state === "saved"} onClick={() => save.mutate("save")}><Save size={15} />儲存草稿</button>{published && <button disabled={state === "saving"} onClick={() => save.mutate("unpublish")}>取消發布</button>}<button disabled={state === "saving"} onClick={() => save.mutate("publish")}>{published ? "發布更新" : "發布頁面"}</button></header>
    <div className="landing-editor-grid"><aside className="landing-blocks"><small>頁面結構</small>{blocks.map((b, i) => <div className={`landing-block ${selected === b.id ? "active" : ""}`} key={b.id}><button onClick={() => setSelected(b.id)}>{labels[b.type]}</button><button onClick={() => change(blocks.map((x) => x.id === b.id ? { ...x, enabled: !x.enabled } : x))}>{b.enabled ? <Eye size={14} /> : <EyeOff size={14} />}</button><button disabled={i === 0} onClick={() => { const n = [...blocks]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; change(n); }}><ChevronUp size={14} /></button><button disabled={i === blocks.length - 1} onClick={() => { const n = [...blocks]; [n[i], n[i + 1]] = [n[i + 1], n[i]]; change(n); }}><ChevronDown size={14} /></button></div>)}</aside><section className="landing-editor-canvas"><Preview blocks={blocks} brand={brand} mobile={mobile} /><div id="landing-editor-form" /></section><Inspector block={active} brand={brand} update={update} updateBrand={updateBrand} upload={() => fileRef.current?.click()} uploading={uploading} /></div>
  </main>;
}