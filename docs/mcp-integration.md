# SellCase 唯讀 MCP 整合

尚未發布。確認後才將此版本與新增資料表發布至 Production。

## 連線與發現

- 正式 MCP URL（發布後）：`https://icta-webinar.com/mcp`
- Streamable HTTP，stateless JSON 回應；使用 POST。GET／DELETE 不建立常駐 SSE，回 405。
- 授權伺服器資訊：`/.well-known/oauth-authorization-server`
- Protected resource 資訊：`/.well-known/oauth-protected-resource/mcp`，另提供根路徑別名。
- OAuth：`GET /authorize`、`POST /register`、`POST /token`、`POST /revoke`。
- 支援公開 client（`none`）與 confidential client（`client_secret_post`）。
  confidential client 的密鑰只在動態註冊回應顯示一次，資料庫只保存雜湊。
- 只支援 authorization_code + S256 PKCE，以及會輪替的 refresh_token。
  不支援 implicit、password grant、client_credentials 或任意第三方 token 轉送。
- `resource` 為 PUBLIC_BASE_URL + `/mcp`，不可指定其他受保護資源。
- 註冊 redirect URI 必須 HTTPS（原生應用 loopback HTTP 例外），授權與換取 token 時必須匹配。
- Code verifier 43–128 字元；code 60 秒有效、單次使用。
- Access token 1 小時；授權／refresh token 最長 30 天。重用 code 或已消耗的 refresh token 會撤銷整份授權。

## 授權流程

1. 外部應用動態註冊 client，產生 PKCE verifier／challenge。
2. 開啟 `/authorize`，帶 client_id、response_type=code、redirect_uri、code_challenge、
   code_challenge_method=S256、resource、state 與 scope。
3. 使用既有帳密或 Google 登入。未參與 OAuth 的登入依舊回到原本的工作台。
4. 用戶閱讀並明確同意所請求的唯讀範圍。
5. 下一頁以卡片單選**自己的一個直播間**；未選擇不能完成授權。
6. 按完成後才產生 code，回到已登記 callback，保留原 state。
7. 外部應用用 verifier 換取 token，透過 Authorization: Bearer 存取 `/mcp`。

支援範圍：`webinars:read`、`sessions:read`、`registrations:read`。
每份授權只綁定選定的一個直播間，即使會員還有其他直播間也不能讀取。
會員可在工作台選單 → **已授權的應用**（`/admin/settings/authorized-apps`）取消授權。
取消後 access／refresh token 同時失效，無需等候原有效期限。

## 工具

| 工具 | 輸入 | 用途 |
|---|---|---|
| list_webinars | 無 | 只列出此授權選定的直播間 |
| get_webinar | webinar_id | 基本資料；不含金流憑證或內部設定 |
| get_registration_link | webinar_id | 回傳 canRegister、reason、url，可直接提供報名按鈕 |
| list_sessions | webinar_id、limit、offset | 場次分頁 |
| list_registrations | webinar_id、limit、offset | 報名分頁；Email、電話一律遮罩 |
| get_registration_stats | webinar_id | 報名、出席、觀看秒數統計 |

分頁 limit 預設 25、上限 100；offset 上限 100000，nextOffset 為 null 時結束。
沒有任何寫入工具，也沒有解遮罩參數。

## 報名連結

- 只由 `PUBLIC_BASE_URL` + `/register/{webinars.id}` 組成，忽略 Host／Forwarded Host。
- Production 已設定 `PUBLIC_BASE_URL=https://icta-webinar.com`；Development 使用開發環境網址，
  讓測試 OAuth issuer 與實際登入同來源。
- 必須「直播間已發布」且「落地頁已發布或已發布的旅程設定為外站模式」。
- 也重新確認會員的實際公開發布權限，避免訂閱／試用到期後提供無法使用的網址。
- 不可報名時 url 為 null，提供「直播間未發佈／落地頁未發佈／會員公開發布權限已失效」原因。
- 外站的草稿設定不會被視為已啟用。無須用戶再去「嵌入與分享」配置連結。

## 隔離與稽核

- 與 Clerk、Express Session、Stripe、綠界及 member_integration_secrets 分離。
- Session 只用於用戶確認／選擇／撤銷；MCP 僅接受自身簽發的 Bearer token。
- 每次工具執行重查 token、會員啟用狀態、直播間 ownership、授權範圍與撤銷狀態。
- 所有 OAuth code／access／refresh token 只保存 SHA-256 雜湊。
- 稽核只記用戶、client、grant、動作、工具、結果與時間，不記原始 token、聯絡資料或完整輸出。
- PostgreSQL 持久化速率限制：client 註冊 20／小時、OAuth protocol 120／分鐘、
  授權 UI 90／分鐘、MCP IP 180／分鐘、單份 grant 60／分鐘。
- 授權 UI 使用同來源 Origin 與 CSRF 驗證，不允許 iframe；授權頁不載入平台追蹤 Pixel。
- 新增 migration 只在開發套用；Production 沿用現有 Publish schema 流程，不在啟動重播 migration。

## 驗證

- `npm test`：包含真實 PostgreSQL、OAuth HTTP、Streamable HTTP 工具與隔離測試。
- `npm run check`、`npm run build`
- 開發服務已運行時：
  `E2E_MODE=local npx playwright test e2e/mcp-oauth-local.spec.ts`
  使用短暫測試會員執行真實帳密登入、同意、鍵盤單選、callback、換 token、MCP 與撤銷。
  不保存包含 token／code 的 trace 或影片。
- Google 外部帳號互動與 Claude／ChatGPT 各自帳戶的連線流程仍需在適當環境由持有人確認；
  不繞過 Google 或建立任何正式授權。
