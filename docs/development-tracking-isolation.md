# 開發 GTM 隔離與跨站歸因接收端驗收

本次不 Publish、不改任何正式 CTA URL 或 approvedOrigins、不真扣款、不輸出秘密，
也不向正式 GA／Meta Pixel 發送事件。

## 正式容器的開發隔離

- 不可變容器清單至少包含 `GTM-NVHG4XMR`。
- Vite 的 DEV／非 production MODE，或 localhost／loopback／replit.dev hostname，
  任一成立即視為非 production；正式 build 放在 replit.dev 也不能解除隔離。
- 非 production 不載入此清單的 GTM，不推送相應 webinar_* dataLayer 事件。
- 若偵測到其他程式已注入受保護容器，也停止其他容器的 webinar dataLayer
  轉送，因為 dataLayer 是全頁共用，不能靠改另一個容器 ID 保證隔離。
- 保留同意檢查與 Set 去重。production 下仍可載入正式容器並去重。
- 此變更不是全站廣告流量封鎖器，未重寫平台 Meta Pixel 或既有同意政策。
  測試必須另在開啟頁面前攔截所有第三方網路。

單元測試以假 DOM 驗證禁止插入 script／gtm.js 初始化事件、正式情境可載入且只一次。
Playwright 使用開發伺服器實際編譯的 React provider／loader，但 HTML 是攔截建立的
隔離測試頁，不載入平台追蹤、Clerk 或真實報名資料。
在頁面載入前即攔截並拒絕所有非開發主機的請求，再檢查正式容器腳本數、
webinar_* 轉送數及追蹤請求嘗試數。這不是登入正式 GTM 或 GA 的收件驗證。

## scRef：只驗證接收端，不繞過白名單

正式 CTA 目的地維持：
`https://noncodingai.com/physical-classes/checkout/`

本次不修改其設定，也不修改任何既有直播間的 approvedOrigins。
該正式直播間的已發佈白名單為空，因此真實 CTA 自動建立／附加 sc_ref 仍受阻塞。
不可用任意隨機字串、watch token 或個資替代有效 scRef。

測試在 UUID 隔離的開發資料夾具中，以伺服器直接插入有效 opaque token 的 SHA-256
及 webinar／registration／session 關聯，不經公開 referral admission。
夾具目的地使用上述 checkout URL，但不發出外站請求。
接收端仍必須通過會員 HMAC、timestamp 與 token owner/webinar 查表驗證。

正面案例驗證 paid 接受、保留 referral／session、測試訂單不進一般列表，且夾具
直播間的空白名單前後一致。
獨立負面子測涵蓋：原簽章下改金額、錯簽章、過期 timestamp、不存在的 scRef、
確實存在但跨 webinar／跨 owner 的 scRef、同事件重送，以及同訂單新事件去重。
原有 HMAC、pending／failed、並發去重及退款測試繼續保留。
全部夾具於結束後清除，不建立寄信工作或呼叫真實金流。

## 共用簽章的名稱

- 外站文件占位名稱：`SELLCASE_EXTERNAL_SECRET`
- SellCase 會員整合儲存：`member_integration_secrets.secret_encrypted`
- 所屬會員／版本資訊：`user_id`、`version`、`rotated_at`
- HMAC 標頭：`X-External-Timestamp`、`X-External-Signature`
- handoff 的外站標頭：`X-External-Destination`
- SellCase 內部加密用途：`SESSION_SECRET`，不是對外共用的 HMAC 密鑰。

文件不包含任何上述秘密的值。

## 重現命令

```sh
NODE_ENV=test node --import tsx --test --test-reporter=tap --test-concurrency=1 \
  server/gtmRuntime.test.ts server/externalJourneys.integration.test.ts
E2E_MODE=staging E2E_BASE_URL=https://YOUR-DEVELOPMENT-HOST.replit.dev \
  npx playwright test e2e/gtm-isolation-local.spec.ts --reporter=line
npm run check
npm run build
```

Playwright 必須指向已有的開發工作流程；測試會拒絕非開發 hostname。
不需要啟動另一個服務，也不需要任何正式帳號、密鑰或測試扣款。
