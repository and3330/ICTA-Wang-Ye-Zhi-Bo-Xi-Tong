import { ArrowLeft } from "lucide-react";
import { SellCaseLogo } from "@/components/sellcase-logo";
import { Link, useLocation } from "wouter";

const sections = {
  terms: {
    title: "服務條款",
    updated: "最後更新：2026 年 9 月 9 日",
    content: [
       ["服務內容", "開賣啦 SellCase 提供 AI 自動銷講、報名、影片播放、AI 互動、資料分析及相關管理工具。AI 產生的內容可能不完整或不正確，使用者應在發布、回覆或據以採取行動前自行審核；本服務不保證成交結果、法令遵循或特定成效。實際可用功能與額度依目前方案及訂閱狀態而定。"],
      ["帳號責任", "您應提供正確的註冊資料、妥善保管帳號密碼，並對帳號下建立及發布的內容負責。若發現未經授權的使用，請立即通知我們。"],
      ["可接受使用方式", "不得使用本服務進行詐欺、侵權、散播惡意程式、未經同意的垃圾訊息，或任何違反適用法律的活動。我們得限制或停止明顯危害平台或第三方的使用行為。"],
      ["內容與授權", "您保留所上傳內容的權利，並授予我們為提供、維護及改善服務所必要的有限處理權限。您必須確保擁有影片、圖片、文件及其他素材的合法使用權。"],
      ["SellCase 訂閱與功能", "SellCase SaaS、AI 點數及直播間加購費用由 SellCase 透過 Stripe 收取，與會員銷售的研討會商品款項不同。SaaS 方案可選月繳或年繳；月繳按月續訂，年繳按年預收並續訂。實際價格、幣別、試用、週期、額度及下次扣款日以訂購前的 Stripe 結帳頁與帳戶訂閱管理頁為準。免費帳號可建立、編輯及預覽草稿，需有效訂閱的公開功能將依方案限制。"],
      ["會員商品與 ECPay", "會員可串接其自行持有的綠界 ECPay 商店，向報名者銷售研討會、課程或其他商品。該筆交易的賣方、商品內容、發票、履約、客服、退換貨與爭議處理由該會員依其揭露及適用法律負責；款項由會員的 ECPay 商店收取，並非支付給 SellCase。SellCase 提供技術串接與頁面工具，不因此成為該商品的賣方。"],
      ["服務變更與終止", "我們可能為安全、法規或產品改善而調整服務。重大影響會以合理方式通知。訂閱終止後，內容原則上會保留，但需要有效訂閱的公開功能將受到限制。"],
      ["責任限制", "在法律允許的範圍內，本服務依現況提供；對於第三方服務中斷、網路故障、使用者內容或間接損失，不承擔超出您最近十二個月實際支付服務費用的責任。"],
    ],
  },
  privacy: {
    title: "隱私權政策",
    updated: "最後更新：2026 年 9 月 9 日",
    content: [
      ["我們蒐集的資料", "我們可能蒐集帳號資料、公司名稱、登入與安全紀錄、SellCase 訂閱狀態、直播間設定、報名資料、互動內容、裝置及基本使用紀錄。SellCase SaaS 與 AI 相關付款由 Stripe 處理；會員商品付款則可能由會員自有的 ECPay 商店處理。我們不直接儲存完整付款卡號，但會保存提供服務、對帳或爭議處理所需的交易識別資訊與狀態。"],
      ["使用目的與角色", "資料用於建立及維護帳號、提供直播與 AI 功能、處理 SellCase 訂閱、保護平台安全、回覆支援需求、分析服務品質及履行法律義務。會員自行蒐集研討會報名者、聊天室或購買者資料時，會員應向當事人提供適當告知、確認合法處理依據並回應其權利；SellCase 通常依會員指示提供平台處理功能，但實際角色仍依具體處理情境及適用法律判斷。"],
      ["AI 與受託服務商", "使用 AI 產生內容或回覆時，提示、知識文件、聊天內容及產生回覆所必要的資料，可能傳送給提供 AI、雲端基礎設施或支援功能的受託服務商並由其處理。AI 輸出可能有錯誤，會員應進行人工審核。請勿輸入非必要的敏感個人資料，會員也應確保其提供予 AI 處理的資料具有適當權限與合法依據。"],
      ["行銷追蹤與 Cookie", "主辦人可能為公開研討會頁面設定 Meta Pixel 或 Google Tag Manager。這些非必要的行銷追蹤只會在訪客同意後載入，可能由相關服務商處理裝置識別資訊、瀏覽頁面及互動事件。訪客可拒絕並繼續使用必要功能，也可透過畫面上的「隱私設定」撤回或變更同意；撤回會停止後續追蹤，但不影響撤回前已依法完成的處理。"],
      ["資料分享", "除提供服務所需的受託處理者、取得您的同意、完成企業交易或法律要求外，我們不出售或任意揭露您的個人資料。"],
      ["資料保存", "資料會在帳號有效期間及提供服務、爭議處理、法規與安全需求所必要的期間內保存。依法或依您的有效請求可刪除的資料，會在合理期限內處理。"],
      ["安全措施", "我們採用存取控制、加密傳輸、伺服器端權限驗證及其他合理措施保護資料，但任何網路服務均無法保證零風險。"],
      ["您的權利", "依適用法律及具體情況，您可能有權查詢、更正、下載、限制處理、撤回同意或刪除個人資料；部分權利可能有法定例外。帳號管理者也應依法處理其自行蒐集的研討會報名者與購買者資料。"],
    ],
  },
  refunds: {
    title: "退款與取消政策",
    updated: "最後更新：2026 年 9 月 9 日",
    content: [
      ["SellCase 月繳與年繳", "Starter、Growth、Scale 與直播間加購可依結帳時提供的選項按月或按年訂閱，並由 SellCase 透過 Stripe 收款。月繳方案按月預收並續訂；年繳方案按年預收並續訂，並非每月扣款。年繳方案中的月度額度或 AI 點數發放頻率不會將付款週期改為月繳。實際金額、幣別、折扣、試用期與下一次扣款日期以確認訂購前的 Stripe 結帳頁及客戶管理入口為準。"],
      ["取消 SellCase 訂閱", "您可以透過帳戶中的訂閱管理入口取消月繳或年繳方案。取消通常於目前已付款的月度或年度週期結束時生效，不等同立即退款；在生效前仍可使用該週期已包含的功能。"],
      ["取消後的內容", "取消或到期後，我們原則上保留已建立內容與草稿，但會停止新增發布，並限制需要有效訂閱的公開頁面、報名、直播與嵌入功能。"],
      ["SellCase 退款原則", "除適用法律另有規定、重複扣款或經確認的重大服務異常外，已開始的月度或年度 SaaS 訂閱週期通常不按比例退款。此原則不排除適用法律賦予的強制權利。若認為 SellCase 扣款有誤，請在扣款後 14 日內提供帳號與交易日期以便查核；該期限是為加速查核，並不縮短依法不得限制的請求期間。"],
      ["方案與加購變更", "升級、降級或調整直播間加購所產生的差額、抵扣與下次扣款時間，以 Stripe 在確認變更前顯示的資訊為準。"],
      ["付款失敗", "付款失敗時，我們或 Stripe 可能再次嘗試扣款並通知您更新付款方式。若訂閱失效，需要有效訂閱的公開功能會停止，但草稿內容不會因此立即刪除。"],
      ["會員商品退款與責任", "透過會員自有 ECPay 商店購買的研討會、課程或其他商品，不是 SellCase SaaS 訂閱。退款、取消、發票、商品交付與消費爭議應依結帳頁所示賣方的政策及適用法律向該會員辦理；款項與退款原則上由會員及其 ECPay 商店處理。SellCase 可在合理範圍提供技術紀錄協助，但不代替會員作成退款決定，也不影響買方依法可向實際賣方主張的權利。"],
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
            <SellCaseLogo className="h-auto w-[138px]" />
          </Link>
          <Link href="/" className="flex items-center gap-2 text-sm font-semibold text-[#39707a] hover:text-[#0c8f92]">
            <ArrowLeft className="h-4 w-4" />
            返回首頁
          </Link>
        </div>
      </header>

      <article className="mx-auto max-w-4xl px-5 py-12 sm:py-16">
         <p className="mb-3 text-xs font-bold uppercase tracking-[0.2em] text-[#0c8f92]">SellCase Legal</p>
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
           本頁為開賣啦 SellCase 的一般服務政策說明。若適用法律提供更高的消費者或資料保護權利，仍以該法律規定為準。
        </aside>
      </article>
    </main>
  );
}