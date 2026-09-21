import { useEffect, useRef, useState } from "react";
import { ArrowRight, Search, ShieldCheck } from "lucide-react";
import { MarketingShell } from "@/components/marketing";
import "@/course-marketplace.css";
import type { CourseMarketplacePublicDto } from "@shared/courseMarketplace";

type Result = { items: CourseMarketplacePublicDto[]; total: number };

function useCourseSearch(term: string) {
  const [result, setResult] = useState<Result>({ items: [], total: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const request = async (search: string) => {
    setLoading(true); setError("");
    try {
      const params = new URLSearchParams({ page: "1", pageSize: "24" });
      if (search.trim()) params.set("search", search.trim());
      const response = await fetch(`/api/course-marketplace?${params.toString()}`, { credentials: "include" });
      if (!response.ok) throw new Error("課程資料暫時無法載入");
      const data = await response.json() as Result;
      setResult({ items: Array.isArray(data.items) ? data.items : [], total: Number(data.total || 0) });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "課程資料暫時無法載入");
    } finally { setLoading(false); }
  };
  const requestRef = useRef(request);
  requestRef.current = request;
  useEffect(() => { const timer = window.setTimeout(() => requestRef.current(term), 350); return () => window.clearTimeout(timer); }, [term]);
  return { ...result, loading, error, retry: () => request(term) };
}

export default function CourseMarketplace() {
  const [input, setInput] = useState("");
  const [term, setTerm] = useState("");
  const { items, total, loading, error, retry } = useCourseSearch(term);
  useEffect(() => { document.documentElement.lang = "zh-TW"; document.title = "課程廣場｜SellCase"; }, []);
  return <MarketingShell>
    <main className="sc-courses">
      <header className="sc-courses-hero">
        <p className="sc-courses-kicker">SELLCASE · COURSE MARKETPLACE</p>
        <h1>這裡有更多優秀的說明會課程</h1>
        <p>由台灣教育者分享、經 SellCase 審核的線上說明會。找到值得信任的專業內容，從今天開始學習。</p>
        <form className="sc-course-search" onSubmit={(event) => { event.preventDefault(); setTerm(input.trim()); }}>
          <Search size={19} aria-hidden="true" /><input value={input} onChange={(event) => setInput(event.target.value)} placeholder="搜尋課程主題或關鍵字" aria-label="搜尋課程" /><button type="submit">搜尋</button>
        </form>
      </header>
      <section className="sc-course-results" aria-live="polite">
        <div className="sc-course-result-head"><span>{loading ? "正在整理課程" : `${total} 堂公開課程`}</span><span className="sc-course-trust"><ShieldCheck size={16} /> 已審核內容</span></div>
        {loading && <div className="sc-course-grid">{[1, 2, 3].map((key) => <div className="sc-course-card sc-course-skeleton" key={key}><div /><span /><span /></div>)}</div>}
        {!loading && error && <div className="sc-course-state"><h2>課程暫時未能顯示</h2><p>{error}</p><button onClick={retry}>再試一次</button></div>}
        {!loading && !error && items.length === 0 && <div className="sc-course-state"><h2>{term ? "找不到相符的課程" : "課程廣場正在準備中"}</h2><p>{term ? "換個關鍵字試試，或瀏覽全部公開課程。" : "新的優質說明會即將加入，歡迎稍後再回來看看。"}</p>{term && <button onClick={() => { setInput(""); setTerm(""); }}>查看全部課程</button>}</div>}
        {!loading && !error && items.length > 0 && <div className="sc-course-grid">{items.map((course) => <article className="sc-course-card" key={course.webinarId}>
          <div className="sc-course-cover">{course.cover ? <img src={course.cover} alt="" /> : <span>SELLCASE<br /><b>WEBINAR</b></span>}<small>已審核</small></div>
          <div className="sc-course-body"><h2>{course.title}</h2><p>{course.summary}</p><div className="sc-course-owner"><strong>{course.ownerDisplayName}</strong>{course.ownerCompany && <span>{course.ownerCompany}</span>}</div><a href={course.registrationUrl}>查看課程 <ArrowRight size={16} /></a></div>
        </article>)}</div>}
      </section>
    </main>
  </MarketingShell>;
}