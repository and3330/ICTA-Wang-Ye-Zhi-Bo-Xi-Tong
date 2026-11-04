# 模組地圖：開賣啦 SellCase（icta-webinar.com）

> 給所有 AI（Grok、CC、CX、Replit Agent）看的地圖：**先看這份，只打開跟任務有關的模組。**
> 功能規則細節在 `replit.md`、`docs/`（對外 API 文件）、`.agents/memory/`（過去踩過的坑）。
> 知識庫專案卡：`project:sellcase`。GitHub repo 名稱是 `ICTA-Wang-Ye-Zhi-Bo-Xi-Tong`（前身 ICTA-WEBINAR／LiveCast）。
> 初版 2026-11-05，依目錄、檔名、路由與 replit.md 整理；改了結構請順手更新本檔。

## 一、整體結構

單一 Node 專案（npm）：React + Vite + Wouter + TanStack Query 前端，Express + ws 後端，PostgreSQL + Drizzle，部署在 Replit。
產品是「用預錄影片模擬直播」的多租戶自動銷講 SaaS：講師建直播間 → 觀眾報名 → 看「直播」（假人聊天、CTA、投票）→ 下單。

| 位置 | 是什麼 |
|---|---|
| `client/src/pages/` | 前端頁面（約 28 頁，見第三節） |
| `client/src/components/` | 共用元件；`ui/` 是 shadcn，`ai-assistant/`、`management/` 是功能元件 |
| `server/routes.ts` | **主要 API，約 5,100 行**（直播間、報名、Stripe、會員訂單…） |
| `server/*Routes.ts` | 已拆出的 API：`adminManagementRoutes`、`aiKnowledgeRoutes`、`aiManagementRoutes`、`bunnyMediaRoutes`、`courseMarketplaceRoutes`、`salesScriptRoutes` |
| `server/*.ts` | 各功能的服務邏輯（見第二節），旁邊的 `*.test.ts` 是對應的單元測試 |
| `server/storage.ts` | 資料存取層（約 2,600 行） |
| `server/mcp/` | 對外的唯讀 MCP 伺服器＋OAuth（`docs/mcp-integration.md`） |
| `shared/schema.ts` | **全部資料表定義（約 1,400 行，70 多張表）**；`shared/*.ts` 其餘是前後端共用規則 |
| `docs/` | 給外部網站串接的 API 文件，介面改了要同步更新 |
| `e2e/` | Playwright 測試（`npm run test:e2e`） |
| `migrations/` | Drizzle 遷移檔 |
| `script/` | 建置（`build.ts`）與上線前檢查（`production-preflight.ts`） |
| `attached_assets/`、`screenshots/`、`reports/` | 對話時貼上的檔案、截圖、報告，不是程式 |

## 二、功能模組

| 模組 | API 路徑 | 後端檔案 | 前端頁面 |
|---|---|---|---|
| **帳號與登入** | `/api/admin/login`、密碼重設、Email 驗證；Clerk 登入橋接 | `routes.ts`（約 1,500–1,720 行）、`middlewares/clerkProxyMiddleware.ts`、`watchTokens.ts` | `admin-login`、`forgot-password`、`reset-password`、`verify-email` |
| **直播間設定**（核心） | `/api/webinars`、`/api/webinars/:id/*`（ctas、polls、tips、questions、fake-users、scheduled-messages、sessions、publish…） | `routes.ts`、`webinarScheduling.ts`、`webinarAccess.ts`、`liveCtaKeys.ts` | `admin-dashboard`、`admin-webinar-detail`（**約 6,300 行**） |
| **觀眾端直播間**（報名、觀看、聊天） | `/api/registrations`、`/api/webinars/:id/progress`、`watch-state`、`chat-messages`；WebSocket | `routes.ts`、`sessionRegistrationCounts.ts` | `registration`、`webinar-room`、`embed-register`、`embed-webinar` |
| **主持人即時控制台** | WebSocket | `routes.ts` | `admin-control` |
| **通知與 Email** | `/api/webinars/:id/email-sequences`、`webhooks` | `email-scheduler.ts`、`gmail.ts`、`mail.ts`、`webhookDelivery.ts` | 直播間設定的「通知」分頁 |
| **分析與漏斗** | `analytics`、`funnel-events`、`funnel-analytics`、`lead-insights` | `funnelAnalytics.ts`、`leadInsights.ts`、`platformConversions.ts` | 直播間設定的「分析」分頁 |
| **銷售頁、商品、訂單** | `/api/products`、`/api/sales-pages`、`/api/product-sales-pages`、`/api/webinars/:id/offers`、`offer-checkout`、`/api/member/orders` | `productCommerce.ts`、`salesPages.ts`、`offerPayments.ts`、`memberOrders.ts` | `admin-products`、`admin-orders`、`sales-page`、`sales-page-editor`、`landing-page-editor` |
| **金流與訂閱方案** | `/api/stripe/*`、`/api/admin/ecpay-connection`、`/api/ecpay/return`、`/api/trial*` | `stripeClient.ts`、`webhookHandlers.ts`、`seed-stripe-products.ts`、`ecpay.ts`、`subscription*.ts`、`noCardTrial.ts`、`trialCommerce.ts`、`pricingRegion.ts` | `pricing`、`purchase-result` |
| **AI 功能**（AI 精靈、AI 回覆、銷講稿產生器、AI 點數） | `/api/webinars/:id/ai`、`sales-script`、`/api/webinars/ai-wizard` | `aiGenerator.ts`、`aiReplyService.ts`、`aiReplyAdmission.ts`、`aiAssistant.ts`、`aiKnowledge*.ts`、`salesScript*.ts`、`aiSalesPage.ts`、`byteplus.ts` | `admin-ai-assistant`、`components/sales-script-generator.tsx` |
| **媒體（Bunny）** | `/api/media`、`/api/upload` | `bunnyMedia.ts`、`bunnyMediaRoutes.ts`、`uploadStorage.ts`、`mediaReferenceLock.ts` | `admin-media` |
| **外部串接**（報名交接、歸因、外部訂單） | `/api/external/*`、`/api/member/external-*`、`/api/webinars/:id/external-journey` | `externalJourneys.ts` | — |
| **課程市集** | `/api/management/course-marketplace`、`/api/webinars/:id/course-marketplace` | `courseMarketplaceRoutes.ts` | `course-marketplace` |
| **平台管理**（超級管理員、會員方案、客服、稽核） | `/api/super-admin/*`、`/api/management/*` | `adminManagementRoutes.ts`、`memberManualPlans`、`manualPlanEntitlements.ts`、`operations*.ts`、`errorReporter.ts` | `super-admin` |
| **MCP 與授權 App** | `/mcp`、`/authorize`、`/token`… | `server/mcp/` | `authorized-apps`、`oauth-consent` |
| **行銷官網** | — | — | `landing`、`marketing-pages`、`legal`；`client/src/marketing-*.ts` |

## 三、改東西前要知道的

- **大檔先搜尋再讀**：`server/routes.ts`、`client/src/pages/admin-webinar-detail.tsx`、`server/storage.ts`、`shared/schema.ts`。
- **新 API 放新檔**：照 `server/<功能>Routes.ts` 的模式，不要再往 `routes.ts` 加。
- **多租戶隔離**：所有後台路由都要經過 `requireWebinarOwner` 這類所有權檢查，不能讓 A 講師讀到 B 講師的資料。
- **金流、訂閱、AI 點數、退款**有冪等與併發規則，先看 `.agents/memory/` 對應筆記，並且要老闆同意才能改。
- **改資料表**：改 `shared/schema.ts` 再 `npm run db:push`；拿掉表定義會讓 Drizzle 把表連資料一起刪掉。
- **對外 API 改了**，同步改 `docs/` 和測試（`npm test`、`npm run test:e2e`）。

## 四、待處理（2026-11-05 發現）

- repo 目前是**公開**的，建議改成 Private。
- 舊版 `replit.md` 寫著超級管理員帳號的明碼密碼，而 `/api/admin/login` 仍接受帳密登入；已從文件拿掉，但 git 歷史還看得到，**要到後台改掉 admin 密碼**。
- `.replit` 目前只有 ID 與網址，沒有金鑰；金鑰請繼續放 Replit Secrets。
