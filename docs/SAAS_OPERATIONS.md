# 開賣啦 SellCase 正式營運手冊

## 每日監控

1. 在 Replit 的 Publishing 工具開啟目前部署。
2. 進入 Monitoring，確認 uptime、延遲與最近錯誤率。
3. 啟用部署離線 Email 告警。
4. 後端未處理的 5xx 錯誤會寫入 `error_events`，相同錯誤十五分鐘內只寄送一次告警，避免告警風暴。
5. Stripe Dashboard 應同時開啟付款失敗與 Webhook 失敗通知。
6. `GET /health/live` 只確認程序存活；負載平衡器應使用 `GET /health/ready`，它會在資料庫不可用或程序正在關閉時回傳 503。
7. `GET /health/operations` 僅輸出不含租戶與個資的營運指標。應對 Email／Callback queue 最舊等待秒數、耗盡重試工作、Callback failures，以及各 scheduler 的 `lastSuccessAt`／連續失敗設定告警。

## 支援的部署拓撲

- Web/API 與排程器目前在同一個 Node.js 程序中。可執行多個相同版本的 instance；Email 與 Callback 工作以 PostgreSQL lease token／條件更新 fenced，序列建立另有唯一索引，因此 instance 間不得改用記憶體鎖。
- SIGTERM／SIGINT 會先讓 readiness 失敗、停止接受 HTTP/WS 與新工作 claim，再於有限時間內排空進行中的工作。超時工作由資料庫 lease 到期後讓其他 instance 接手。
- WebSocket presence 與 fan-out 是 instance-local。支援單一 instance 的完整即時直播；多 instance 若負載平衡器沒有 sticky session，跨 instance 的即時訊息／presence 不保證同步。要水平擴充即時層，必須先加入共享 pub/sub。
- PostgreSQL 是必要相依服務。每個 instance 的 pool 上限由 `DB_POOL_MAX` 控制；總連線預算須涵蓋所有 instance、migration 與 session store。

## 上傳檔案持久化

- 正式上傳使用 Replit App Storage（由 `@replit/object-storage` SDK 存取）；資料庫只保存素材 metadata，不保存檔案內容。物件不公開，應用程式的 `/uploads/:filename` 路由負責安全回應標頭。
- 不可把 autoscale instance 的本機 ephemeral filesystem 當正式素材儲存。`UPLOADS_DIR` 僅供本機開發及既有 legacy 素材讀取，不是正式環境的必要設定。
- 若要在本機測試而未設定 `UPLOADS_DIR`，會使用 `client/public/uploads`；測試可注入 upload storage adapter，不需 Replit 儲存憑證。

## 告警收件人

正式環境需設定：

- `ERROR_ALERT_EMAIL`：技術錯誤告警的收件地址。
- `RESEND_API_KEY`：Resend 寄信金鑰。
- `EMAIL_FROM_ADDRESS`：已驗證網域的寄件地址。

任何 Secret 都只能放在 Replit Secrets，不得寫入程式、文件或日誌。

## 資料庫備份

Replit Production Database 提供每日還原點與時間點還原。正式上線後：

1. 每週在 Database 工具確認 production 備份仍正常產生。
2. 每月安排一次還原演練，還原到隔離環境，不得直接覆蓋目前 production。
3. 還原後檢查會員、直播間、報名、訂閱生命週期、AI 點數與客服案件數量。
4. 保留演練日期、還原時間點、驗證人與結果，但不得記錄個資或資料庫憑證。

## 發生資料事故時

1. 先停止會持續寫入錯誤資料的功能或部署。
2. 記錄事故發生的大約時間與最後一筆可信資料時間。
3. 在 Replit Database 工具選擇事故前的時間點建立還原。
4. 先在隔離環境驗證資料完整性及 migration 相容性。
5. 確認後才切換正式服務，並重新驗證登入、發布、付款與 Webhook。
6. 若事故涉及 Stripe，不可用資料庫內容直接推定付款狀態；必須重新由 Stripe backfill／Webhook 同步權益。

## 每次發布檢查

```bash
npm run preflight:production
npm run check
npm test
npm run build
git diff --check
```

`preflight:production` 只確認設定名稱存在、格式及公開 URL 關係，不會輸出 Secret
內容，也不會連線或產生交易。它要求 `DATABASE_URL`、`SESSION_SECRET`、
`APP_BASE_URL`、Resend/告警信箱及 Stripe live key 的正式
設定名稱。ECPay HashKey/HashIV 是會員在後台設定並以 `SESSION_SECRET` 衍生金鑰
加密，不是部署環境變數，因此需由下方 staging 演練確認。
`APP_BASE_URL` 是 production 唯一權威公開 URL；`REPLIT_DOMAINS` 若存在只做
hostname 語法檢查，不作 URL 比對。正式 uploads 使用 Replit App Storage，
`UPLOADS_DIR` 僅是 legacy/local 選項，不是 production 必填。

發布後至少驗證：

- 首頁及登入頁正常。
- 新會員可收到驗證信並完成驗證。
- 忘記密碼回應不會暴露 Email 是否存在。
- Stripe 方案目錄正常，Checkout 可建立。
- 免費會員不能發布；付費權益及額度正確。
- 客服回報可送出，超級管理員可更新狀態。
- Monitoring 顯示服務正常，沒有新增 5xx。

## Disposable/Staging 瀏覽器 E2E

這組測試只可指向可拋棄資料庫或 staging，fixture 必須使用 ECPay 測試環境，
不得放正式卡號、正式 Merchant、正式 Stripe key 或個人信箱。先建立一場已發布
且可立即觀看的測試直播、一筆有效報名與 watch token、一份啟用問卷、一個已封存
CTA，另建立一筆已撤銷觀看權限的報名。測試會寫入一筆問卷回覆，資料需可丟棄。

```bash
E2E_TARGET_KIND=staging \
E2E_CONFIRM_NO_LIVE_MONEY=1 \
E2E_BASE_URL=https://staging.example.test \
E2E_WEBINAR_ID=... E2E_WATCH_TOKEN=... \
E2E_REVOKED_WEBINAR_ID=... E2E_REVOKED_WATCH_TOKEN=... \
E2E_SURVEY_ID=... E2E_ARCHIVED_CTA_ID=... \
npm run test:e2e
```

值只能透過 CI/Replit Secrets 注入，不可提交。測試確認：(1) 撤銷後播放器不渲染，
(2) 假 token 被拒而有效 token 可提交回饋，(3) 封存 CTA 不出現在公開 payload
與 viewer UI。失敗產物位於 `test-results/`，分享前需先確認截圖/trace 沒有測試
token；fixture 用完立即撤銷。瀏覽器首次安裝由環境管理者執行 Playwright 官方
browser 安裝步驟，正式部署不需要安裝瀏覽器。

## 每次候選版的完整 staging 人工流程

全程使用專屬測試網域、可拋棄帳號、Vimeo 測試影片及 ECPay stage Merchant。
記錄 order ID、時間與結果即可，不記錄憑證、完整 Email、卡號或 callback body。

1. **註冊與 Email**：以唯一別名信箱註冊，確認未驗證不能登入；從實際收到的信件
  輸入六位數電子郵件驗證碼，確認驗證碼 10 分鐘後失效且僅能使用一次；再測忘記密碼信與一次性重設。
2. **Vimeo 與 viewer**：建立 on-demand 測試直播並嵌入允許 staging 網域的 Vimeo
   測試影片，發布落地頁與直播，完成報名、從信件連結進場、播放及重新整理續看。
   後台撤銷/下架後，最遲在下一次資格輪詢時播放器必須消失且不可只靠舊 iframe
   繼續觀看。
3. **問卷與 CTA**：用報名連結送出問卷，確認錯誤/過期 token 被拒；封存 CTA 後
   重新載入 viewer，確認按鈕與 API 都不再提供該 CTA。
4. **ECPay sandbox settlement**：後台連線環境必須顯示 `stage`，建立低額測試 offer；
   從 viewer CTA 進入 ECPay 測試頁，使用 ECPay 官方測試資料完成付款。確認 callback
   是 HTTPS staging origin、驗章成功、重送同一 callback 不重複入帳，訂單由 pending
   轉 paid，銷售/營收只增加一次。不得把瀏覽器成功頁當付款證明。
5. **Refund**：從 sandbox 執行退款/測試退款事件，確認訂單退款狀態、淨營收與交付
   權益一致；重送及「退款先到、付款後到」不得重複扣除或恢復。DB 狀態必須和 ECPay
   後台逐筆核對，不能以 DB 單方面推定金流結果。
6. **Worker restart**：在 Email/付款工作佇列各留一筆可安全重試的 staging 工作，
   於 lease 中途重新部署 worker。確認 lease 到期後工作接續、同一 Email/入帳只執行
   一次、retry 次數及最後錯誤可觀察，且沒有永久卡在 processing。
7. **收尾**：撤銷 watch token、停用測試 ECPay connection、封存測試直播並清除測試
   個資。把版本、驗證人、時間、各步 pass/fail 與無敏感資訊的 provider reference
   寫入發布紀錄；任一步失敗即停止正式發布。

## 隔離還原演練（每月）

還原演練永遠建立全新的隔離 Database、隔離 uploads 儲存與禁止外送的部署；先關閉
Email scheduler、付款 callback 對外路由及所有會呼叫 provider 的 worker。禁止把
隔離部署掛到正式 ECPay/Stripe webhook，也禁止在演練中補發信或重播付款。

1. 選定演練時間點，記錄 production DB 還原點與 uploads 快照/檔案清單雜湊；只在
   Replit Database 工具複製到隔離環境，不覆蓋 production。
2. 以相同程式版本啟動 migration 相容性檢查；核對 users、webinars、registrations、
   `uploaded_assets`、實體 uploads 檔案、ECPay orders/payment events、AI credit
   ledger 的筆數、主外鍵及抽樣關聯。遺失檔、孤兒檔、負點數或 ledger 與餘額不合
   都視為失敗，不可靜默略過。
3. **Uploads**：從獨立備份還原到新的路徑，依 DB 清單抽查 MIME、安全檔名、大小及
   checksum；不得讓隔離環境寫入 production uploads。
4. **ECPay orders**：保持 callback/checkout 停用，只做唯讀比對。抽查 pending、
   paid、refunded 及亂序/重送事件；金流 provider 是最終來源，絕不可因 DB restore
   自動建立付款、退款或交付。正式切換前另做 provider reconciliation/backfill。
5. **AI credits**：依 immutable ledger 逐會員重算發放、消耗、到期及退款，與快照餘額
   比對；有差異先保留證據並修正 reconciliation，不可直接改餘額掩蓋問題。
6. 在隔離環境完成登入、viewer、圖片讀取的唯讀 smoke test；任何 worker 恢復前，
   先列出 restore point 後可能漏掉的工作，以 idempotency key 逐批 reconcile。
7. 記錄 RTO/RPO、還原耗時、檢查數與差異（不含個資/Secret），銷毀隔離 DB、uploads
   與暫時憑證，確認 callback DNS/URL 從未指向隔離環境。

**重要：**ECPay HashKey/HashIV 等資料由 `SESSION_SECRET` 衍生金鑰加密。還原時若
沒有「備份當時相同的 `SESSION_SECRET`」，既有密文無法解密。直接輪替 Secret 不只
會使所有 Session 失效，也會使 ECPay 憑證不可讀；必須先保留舊金鑰於受控遷移工作、
逐筆解密並以新金鑰重新加密、驗證完成後才撤銷舊金鑰。不可把 Secret 或解密內容寫入
log、匯出檔或演練紀錄。

## Secret 輪替

- Resend 或 Stripe 金鑰疑似外洩時，先在服務商端撤銷舊金鑰，再更新 Replit Secrets 並重新發布。
- `SESSION_SECRET` 輪替會讓既有登入 Session 失效，並影響 ECPay 憑證解密；必須依上方
  re-encryption 程序安排維護時間，不可直接替換後刪除舊值。
- 不得在聊天、Issue、截圖或客服案件中貼出 Secret。