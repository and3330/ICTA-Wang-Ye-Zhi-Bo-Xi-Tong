import { ArrowLeft, ShieldCheck } from "lucide-react";
import { Link, useLocation } from "wouter";

const sections = {
  terms: {
    title: "服務條款",
    updated: "最後更新：2026 年 9 月 3 日",
    content: [
      ["服務內容", "ICTA Webinar 提供自動化直播研討會建立、報名、影片播放、AI 互動、資料分析及相關管理工具。實際可用功能與發布額度依使用者目前的方案及訂閱狀態而定。"],
      ["帳號責任", "您應提供正確的註冊資料、妥善保管帳號密碼，並對帳號下建立及發布的內容負責。若發現未經授權的使用，請立即通知我們。"],
      ["可接受使用方式", "不得使用本服務進行詐欺、侵權、散播惡意程式、未經同意的垃圾訊息，或任何違反適用法律的活動。我們得限制或停止明顯危害平台或第三方的使用行為。"],
      ["內容與授權", "您保留所上傳內容的權利，並授予我們為提供、維護及改善服務所必要的有限處理權限。您必須確保擁有影片、圖片、文件及其他素材的合法使用權。"],
      ["訂閱與功能", "免費帳號可建立、編輯及預覽草稿。公開發布、公開網址、公開報名、直播及嵌入功能需要有效訂閱。方案額度與加購數量會依結帳時顯示的內容計算。"],
      ["服務變更與終止", "我們可能為安全、法規或產品改善而調整服務。重大影響會以合理方式通知。訂閱終止後，內容原則上會保留，但需要有效訂閱的公開功能將受到限制。"],
      ["責任限制", "在法律允許的範圍內，本服務依現況提供；對於第三方服務中斷、網路故障、使用者內容或間接損失，不承擔超出您最近十二個月實際支付服務費用的責任。"],
    ],
  },
  privacy: {
    title: "隱私權政策",
    updated: "最後更新：2026 年 9 月 3 日",
    content: [
      ["我們蒐集的資料", "我們可能蒐集帳號資料、公司名稱、登入與安全紀錄、訂閱狀態、直播間設定、報名資料、互動內容、裝置及基本使用紀錄。付款卡號由 Stripe 處理，我們不直接儲存完整卡號。"],
      ["使用目的", "資料用於建立及維護帳號、提供直播與 AI 功能、處理訂閱、保護平台安全、回覆支援需求、分析服務品質及履行法律義務。"],
      ["AI 與第三方服務", "使用 AI 回覆、影片、付款或 Email 功能時，必要資料可能傳送給提供該功能的服務商。請勿在提示、聊天或上傳內容中放入不必要的敏感個人資料。"],
      ["資料分享", "除提供服務所需的受託處理者、取得您的同意、完成企業交易或法律要求外，我們不出售或任意揭露您的個人資料。"],
      ["資料保存", "資料會在帳號有效期間及提供服務、爭議處理、法規與安全需求所必要的期間內保存。依法或依您的有效請求可刪除的資料，會在合理期限內處理。"],
      ["安全措施", "我們採用存取控制、加密傳輸、伺服器端權限驗證及其他合理措施保護資料，但任何網路服務均無法保證零風險。"],
      ["您的權利", "依適用法律，您可能有權查詢、更正、下載、限制處理或刪除個人資料。帳號管理者也應依法處理其自行蒐集的研討會報名者資料。"],
    ],
  },
  refunds: {
    title: "退款與取消政策",
    updated: "最後更新：2026 年 9 月 3 日",
    content: [
      ["訂閱週期", "Starter、Growth 與直播間加購皆按月計費，實際金額、幣別及下一次扣款日期以 Stripe 結帳頁及客戶管理入口顯示為準。"],
      ["取消訂閱", "您可以透過帳戶中的訂閱管理入口取消。取消通常於目前已付款週期結束時生效；在生效前仍可使用該週期已包含的功能。"],
      ["取消後的內容", "取消或到期後，我們原則上保留已建立內容與草稿，但會停止新增發布，並限制需要有效訂閱的公開頁面、報名、直播與嵌入功能。"],
      ["退款原則", "除適用法律另有規定、重複扣款或經確認的重大服務異常外，已開始的訂閱週期通常不按比例退款。若認為扣款有誤，請在扣款後 14 日內提供帳號與交易日期以便查核。"],
      ["方案與加購變更", "升級、降級或調整直播間加購所產生的差額、抵扣與下次扣款時間，以 Stripe 在確認變更前顯示的資訊為準。"],
      ["付款失敗", "付款失敗時，我們或 Stripe 可能再次嘗試扣款並通知您更新付款方式。若訂閱失效，需要有效訂閱的公開功能會停止，但草稿內容不會因此立即刪除。"],
    ],
  },
} as const;

type LegalKind = keyof typeof sections;

export default function Legal() {
  const [location] = useLocation();
  const kind = (location.split("/").pop() || "terms") as LegalKind;
  const page = sections[kind] || sections.terms;

  return (
    <main className="min-h-screen bg-[#f4fbfa] text-[#0b3140]">
      <header className="border-b border-[#c8dfdf] bg-white/90">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-5 py-4">
          <Link href="/" className="flex items-center gap-2 font-bold">
            <ShieldCheck className="h-5 w-5 text-[#0c8f92]" />
            ICTA WEBINAR
          </Link>
          <Link href="/" className="flex items-center gap-2 text-sm font-semibold text-[#39707a] hover:text-[#0c8f92]">
            <ArrowLeft className="h-4 w-4" />
            返回首頁
          </Link>
        </div>
      </header>

      <article className="mx-auto max-w-4xl px-5 py-12 sm:py-16">
        <p className="mb-3 text-xs font-bold uppercase tracking-[0.2em] text-[#0c8f92]">ICTA Webinar Legal</p>
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">{page.title}</h1>
        <p className="mt-3 text-sm text-[#64858c]">{page.updated}</p>

        <nav className="my-9 flex flex-wrap gap-2 border-y border-[#c8dfdf] py-4" aria-label="法律文件">
          <Link href="/legal/terms" className={`rounded-full px-4 py-2 text-sm font-semibold ${kind === "terms" ? "bg-[#0b3140] text-white" : "bg-white text-[#39707a]"}`}>服務條款</Link>
          <Link href="/legal/privacy" className={`rounded-full px-4 py-2 text-sm font-semibold ${kind === "privacy" ? "bg-[#0b3140] text-white" : "bg-white text-[#39707a]"}`}>隱私權政策</Link>
          <Link href="/legal/refunds" className={`rounded-full px-4 py-2 text-sm font-semibold ${kind === "refunds" ? "bg-[#0b3140] text-white" : "bg-white text-[#39707a]"}`}>退款與取消</Link>
        </nav>

        <div className="space-y-8">
          {page.content.map(([heading, body]) => (
            <section key={heading}>
              <h2 className="mb-2 text-xl font-bold">{heading}</h2>
              <p className="leading-8 text-[#486b73]">{body}</p>
            </section>
          ))}
        </div>

        <aside className="mt-12 rounded-2xl border border-[#c8dfdf] bg-white p-5 text-sm leading-7 text-[#64858c]">
          本頁為 ICTA Webinar 的一般服務政策說明。若適用法律提供更高的消費者或資料保護權利，仍以該法律規定為準。
        </aside>
      </article>
    </main>
  );
}