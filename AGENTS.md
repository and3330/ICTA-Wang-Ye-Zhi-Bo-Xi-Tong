# 給 AI 的守則（開賣啦 SellCase／icta-webinar.com）

1. **先看 `ARCHITECTURE.md`**，找到任務屬於哪個模組，只打開那個模組的檔案。不要整個專案讀一遍。
2. `server/routes.ts`、`client/src/pages/admin-webinar-detail.tsx`、`server/storage.ts`、`shared/schema.ts` 都很大：先搜尋，再讀相關那一段。
3. 新的 API 放進 `server/<功能>Routes.ts`，不要再往 `server/routes.ts` 加。
4. 這是正式營運的多租戶 SaaS：每個後台路由都要檢查資料所有權，不准跨講師讀寫資料。
5. **金流（Stripe、綠界）、訂閱方案、AI 點數、退款相關檔案，沒有老闆明確同意不准改**；改之前先列計畫。
6. 金鑰、token、帳號密碼一律放 Replit Secrets，絕不寫進任何檔案（包括 `.replit`、`replit.md`、`attached_assets/`）。
7. 不要把學員或講師資料（姓名、電話、Email）寫進程式碼、測試資料、log 或知識庫。
8. 公司中央知識庫的專案卡是 `project:sellcase`：開工前先查，做完更新卡上的 `last_activity`、`todo`。
9. 改了模組結構或對外 API，順手更新 `ARCHITECTURE.md` 和 `docs/`。
