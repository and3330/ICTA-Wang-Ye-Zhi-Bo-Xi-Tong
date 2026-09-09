# 開賣啦 SellCase 正式營運手冊

## 每日監控

1. 在 Replit 的 Publishing 工具開啟目前部署。
2. 進入 Monitoring，確認 uptime、延遲與最近錯誤率。
3. 啟用部署離線 Email 告警。
4. 後端未處理的 5xx 錯誤會寫入 `error_events`，相同錯誤十五分鐘內只寄送一次告警，避免告警風暴。
5. Stripe Dashboard 應同時開啟付款失敗與 Webhook 失敗通知。

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
npm run check
npm test
npm run build
git diff --check
```

發布後至少驗證：

- 首頁及登入頁正常。
- 新會員可收到驗證信並完成驗證。
- 忘記密碼回應不會暴露 Email 是否存在。
- Stripe 方案目錄正常，Checkout 可建立。
- 免費會員不能發布；付費權益及額度正確。
- 客服回報可送出，超級管理員可更新狀態。
- Monitoring 顯示服務正常，沒有新增 5xx。

## Secret 輪替

- Resend 或 Stripe 金鑰疑似外洩時，先在服務商端撤銷舊金鑰，再更新 Replit Secrets 並重新發布。
- `SESSION_SECRET` 輪替會讓既有登入 Session 失效，應安排維護時間並告知使用者重新登入。
- 不得在聊天、Issue、截圖或客服案件中貼出 Secret。