# 開賣啦 SellCase - AI 自動銷講成交系統

## 專案概述
一個多租戶 SaaS「模擬直播」研討會平台，使用預錄的 Vimeo 影片營造直播體驗。用戶可註冊帳號獨立管理自己的直播間，完整的租戶資料隔離。

## 品牌
- 品牌名稱：開賣啦 SellCase（前身 ICTA-WEBINAR／LiveCast）
- 品牌標語：一開講，就開賣。
- 核心引擎名稱：開賣機
- Widget JS 同時支援 `window.ICTA_WEBINAR` 和 `window.LiveCast`（向下相容）

## 對外串接文件
- 對外技術介面要寫成可供其他網站串接的文件，不只留在對話中；介面變動時同步更新文件與測試。
- 安全報名交接指南：`docs/registration-handoff-api.md`；外部流程與歸因 API：`docs/external-journeys-api.md`。
- 文件需如實列出欄位、錯誤、重試限制及 iframe 行為，不能將建議能力寫成已實作；不得放入真實密鑰、觀看憑證或學員個資。

## 多語系 (i18n)
- 共用 hook：`client/src/hooks/use-lang.ts`（useLang / useAdminLang）
- 語言選擇存儲於 localStorage（key: `icta-lang`），預設為繁體中文
- **首頁 + 登入頁**：支援三種語言（zh-TW、zh-CN、en），使用下拉選單切換
- **後台頁面**（Dashboard、Webinar Detail、Control）：支援兩種語言（zh-TW、zh-CN），使用切換按鈕
- 所有首頁文字、SEO meta tags、OG tags 會隨語言切換更新
- 語言切換器位於導航列右側（Languages 圖標按鈕）

## 多租戶架構
- **用戶註冊**：bcrypt 密碼雜湊（10 rounds），支援 username/email/password/companyName
- **Session 管理**：session 存 userId，非 isAdmin boolean
- **資料隔離**：所有 admin 路由使用 requireWebinarOwner 中間件驗證 webinar 所有權
- **超級管理員**：帳號 admin（密碼不寫在文件裡，由老闆保管）

## 核心功能

### 前台功能（觀眾端）
- **報名頁面**：訪客輸入姓名/Email 報名，系統自動發送 Gmail 通知
- **直播間頁面**：
  - 響應式設計：手機上影片下聊天、電腦左影片右聊天
  - Vimeo 影片播放器
  - CTA 按鈕覆蓋（按時間顯示，用於銷售導購）
  - 即時聊天室（WebSocket）- **獨立場次隔離**
  - 按讚按鈕 + 讚數統計
  - 投票互動功能
  - 小提示卡（按影片時間觸發顯示）

### 觀眾隔離機制 (Session-Based Isolation)
每位觀眾擁有完全獨立的體驗：
- **sessionId 機制**：每位觀眾進入直播間時自動產生唯一 sessionId，存儲於 localStorage
- **獨立聊天**：觀眾只能看到自己發送的訊息和預排訊息（假人訊息），看不到其他真實觀眾的訊息
- **預排訊息**：根據影片播放時間觸發，所有觀眾在相同的相對時間點看到相同的假人訊息
- **主持人視角**：主持人可以看到所有場次的訊息，並回覆特定觀眾

### 訂閱方案管理（Stripe 整合）
- **免費方案**：瀏覽後台但無法建立直播間，需升級
- **月租方案**：$49/月（Stripe 訂閱），可建立無限草稿，最多發佈 3 個直播間
- **企業方案**：超級管理員，無限制
- Stripe Price ID: `price_1Sy8bxIbl9Q8nuPzsLN1d2VC`（環境變數 `STRIPE_MONTHLY_PRICE_ID`）
- **發佈工作流**：直播間預設為「草稿」狀態，需手動發佈才啟用報名連結
- 超級管理員（admin 帳號）可在 `/super-admin` 管理所有使用者的方案、到期日、啟停用
- Stripe 相關檔案：`server/stripeClient.ts`、`server/webhookHandlers.ts`、`server/seed-stripe-products.ts`
- Stripe 路由：checkout、portal、config、handle-subscription、webhook

### 後台功能（管理員）
- **帳號**：超級管理員 admin（密碼不寫在文件裡）
- **直播間管理**：建立多個直播、設定 Vimeo 連結、開始時間、刪除直播
- **7 大分頁管理介面**（eWebinar 風格）：
  - 排程 (Schedule)：排程模式、時區、重播、場次管理、循環排程
  - 通知 (Notifications)：郵件設定、郵件範本、Webhook 整合
  - 互動 (Interactions)：CTA 按鈕、投票、小提示卡、Q&A、回饋問卷
  - 聊天 (Chat)：假人管理、預排訊息
  - 報名 (Registration)：報名名單、CSV 匯出、UTM 追蹤顯示
  - 分析 (Analytics)：報名/出席統計、觀看時長分佈、留存曲線
  - 設定 (Settings)：基本資訊編輯、品牌設定、嵌入代碼、直播連結
- **UTM 追蹤**：自動擷取 utm_source/medium/campaign/term/content 和來源 URL
- **Webhook 整合**：支援 registration/attendance/completion 事件通知，HMAC 簽名
- **CSV 匯出**：匯出報名名單含 UTM 資料
- **即時控制台**：主辦人用自訂名稱即時發言

## 技術架構

### 前端
- React + TypeScript
- TailwindCSS + shadcn/ui
- Wouter 路由
- TanStack Query 資料管理
- WebSocket 即時通訊

### 後端
- Express.js
- WebSocket (ws)
- PostgreSQL (Drizzle ORM)
- Gmail API (Replit 整合)

## 資料庫結構

### Tables
- `webinars` - 直播間資訊（含排程模式、時區、品牌設定）
- `registrations` - 報名記錄（含出席追蹤、觀看時長）
- `fake_users` - 假人角色
- `scheduled_messages` - 預排訊息
- `cta_buttons` - CTA 按鈕
- `polls` - 投票問題
- `poll_votes` - 投票記錄
- `chat_messages` - 聊天訊息
- `likes` - 按讚統計
- `users` - 管理員帳號
- `tips` - 小提示卡（按時間觸發）
- `questions` - 觀眾問答 Q&A
- `feedback_surveys` - 回饋問卷
- `feedback_responses` - 問卷回應
- `viewer_progress` - 觀看進度追蹤
- `webinar_analytics` - 統計分析數據
- `email_reminders` - 郵件提醒設定
- `webinar_sessions` - 直播場次管理
- `webhooks` - Webhook 整合設定（事件類型、目標 URL、密鑰）

## 頁面路由

| 路徑 | 說明 |
|------|------|
| `/admin` | 管理員登入頁 |
| `/admin/dashboard` | 管理後台首頁 |
| `/admin/webinar/:id` | 直播間設定頁 |
| `/admin/webinar/:id/control` | 即時控制台 |
| `/register/:id` | 觀眾報名頁 |
| `/webinar/:id` | 直播間觀看頁 |
| `/embed/register/:id` | 嵌入式報名表單（iframe 用） |
| `/embed/webinar/:id` | 嵌入式直播間播放器（iframe 用） |

## API 端點

### 認證
- `POST /api/admin/login` - 管理員登入
- `POST /api/admin/logout` - 登出

### 直播間
- `GET /api/webinars` - 取得所有直播間
- `GET /api/webinars/:id` - 取得單一直播間
- `POST /api/webinars` - 建立直播間（需認證）
- `DELETE /api/webinars/:id` - 刪除直播間（需認證）

### 報名
- `POST /api/registrations` - 報名
- `GET /api/webinars/:id/registrations` - 取得報名列表（需認證）

### 假人
- `GET /api/webinars/:id/fake-users` - 取得假人列表
- `POST /api/webinars/:id/fake-users` - 新增假人（需認證）
- `DELETE /api/webinars/:id/fake-users/:userId` - 刪除假人（需認證）

### 預排訊息
- `GET /api/webinars/:id/scheduled-messages` - 取得預排訊息
- `POST /api/webinars/:id/scheduled-messages` - 新增預排訊息（需認證）
- `DELETE /api/webinars/:id/scheduled-messages/:msgId` - 刪除（需認證）

### CTA 按鈕
- `GET /api/webinars/:id/ctas` - 取得 CTA 列表
- `POST /api/webinars/:id/ctas` - 新增 CTA（需認證）
- `DELETE /api/webinars/:id/ctas/:ctaId` - 刪除 CTA（需認證）

### 投票
- `GET /api/webinars/:id/polls` - 取得投票列表
- `POST /api/webinars/:id/polls` - 新增投票（需認證）
- `DELETE /api/webinars/:id/polls/:pollId` - 刪除投票（需認證）

### 小提示卡
- `GET /api/webinars/:id/tips` - 取得提示列表
- `POST /api/webinars/:id/tips` - 新增提示（需認證）
- `DELETE /api/webinars/:id/tips/:tipId` - 刪除提示（需認證）

### 觀眾問答 (Q&A)
- `GET /api/webinars/:id/questions` - 取得問題列表
- `POST /api/webinars/:id/questions` - 新增問題
- `PATCH /api/webinars/:id/questions/:questionId` - 回覆問題（需認證）
- `DELETE /api/webinars/:id/questions/:questionId` - 刪除問題（需認證）

### 回饋問卷
- `GET /api/webinars/:id/feedback-survey` - 取得問卷
- `POST /api/webinars/:id/feedback-survey` - 建立問卷（需認證）
- `PATCH /api/webinars/:id/feedback-survey/:surveyId` - 更新問卷（需認證）
- `POST /api/feedback-responses` - 提交回應
- `GET /api/feedback-surveys/:surveyId/responses` - 取得回應（需認證）

### 觀看進度
- `GET /api/webinars/:id/progress/:sessionId` - 取得觀看進度
- `POST /api/webinars/:id/progress` - 更新觀看進度

### 統計分析
- `GET /api/webinars/:id/analytics` - 取得分析數據（需認證）

### 直播場次
- `GET /api/webinars/:id/sessions` - 取得場次列表
- `POST /api/webinars/:id/sessions` - 新增場次（需認證）

### 出席追蹤
- `POST /api/registrations/:id/attend` - 標記出席
- `POST /api/registrations/:id/leave` - 標記離開

### Webhooks
- `GET /api/webinars/:id/webhooks` - 取得 Webhook 列表（需認證）
- `POST /api/webinars/:id/webhooks` - 新增 Webhook（需認證）
- `PATCH /api/webinars/:id/webhooks/:hookId` - 更新 Webhook（需認證）
- `DELETE /api/webinars/:id/webhooks/:hookId` - 刪除 Webhook（需認證）

### CSV 匯出
- `GET /api/webinars/:id/registrations/export` - 匯出報名名單 CSV（需認證）

## WebSocket 訊息類型

### 客戶端發送
- `join` - 加入直播間
- `joinAsHost` - 以主辦人身份加入
- `chat` - 發送聊天訊息
- `like` - 按讚
- `vote` - 投票
- `triggerPoll` - 觸發投票（主辦人）

### 伺服器發送
- `history` - 歷史訊息
- `chat` - 新聊天訊息
- `like` - 按讚更新
- `viewerCount` - 觀看人數
- `poll` - 投票問題
- `pollResults` - 投票結果
- `scheduledMessage` - 預排訊息

## 開發指令

```bash
npm run dev          # 開發模式
npm run db:push      # 同步資料庫結構
npm run build        # 建置生產版本
```

## 整合服務
- Gmail API - 發送報名通知郵件（透過 Replit 連接器）
- Vimeo Player API - 影片播放控制

## User preferences
- 溝通語言：繁體中文（zh-TW），非技術用戶。
- 回覆風格：精簡模式（caveman style）。回話短、重點優先、去除客套廢話，但技術內容、程式碼、指令保持完整準確。
