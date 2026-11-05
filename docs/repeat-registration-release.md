# 重複 Email 報名：上線注意事項

同一 Email 可再次報名同一直播間，包含相同或不同場次。每次成功報名
都是獨立紀錄，沿用原有觀看憑證、事件、寄信與每月報名額度計數流程；
不刪除、不合併、不覆寫舊報名。

## 資料庫前置更新

上線此程式版本前，需在核准的正式資料庫變更流程中套用
`migrations/0036_repeat_registrations.sql`。它只移除舊 Email 唯一性
觸發器、其函式及歷史唯一索引，不刪除報名或舊 identity 資料。

不能只靠 Drizzle schema diff：舊限制是 SQL trigger，未必會被發布的
schema diff 移除。不要為此開啟正式環境啟動時重播全部 migrations。

尚未取得上線核准時，不要對正式資料庫執行此更新，也不要發佈。
更新後可唯讀檢查 `pg_trigger`，確認 `registrations` 上沒有
`registrations_email_identity_trigger`，以及 `pg_indexes` 沒有
`registrations_webinar_email_uniq`，再確認公開報名服務正常。

## 開發驗證

`e2e/hybrid-scheduling-local.spec.ts` 包含重複 Email（含大小寫／空白）、
不同場次、並行報名、獨立觀看憑證與事件，以及月額度並行保護測試。
測試直播間關閉寄信，避免對外寄出測試通知。
