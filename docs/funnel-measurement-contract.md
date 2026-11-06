# 個人漏斗與外部成交驗收契約

本次僅為「開賣啦 SellCase」的開發變更；未 Publish、未修改 Production 資料、
商店設定或密鑰，未呼叫外部扣款／廣告服務。

## 觀看：位置與有效秒數分開

- 播放位置是 `last_position`，不能用來代表聽完或累計秒數。
- 播放器約每 10 秒回報 `measurementVersion:2`、頁面獨立的 `viewerSessionId`、
  `lastPosition`、實測 `totalWatched`、`watchedRanges:[{start,end}]`。
- 前端只採計可見頁面、播放中、連續向前且合理速度的播放樣本。
  跳轉／暫停／buffering／長時間無樣本不計秒數。
- 伺服器依 session 起點與經過時間限制可申報區間，首筆最多接受 15 秒的觀測。
  同一報名以資料庫鎖序列化，合併所有 v2 session 的內容區間，避免重送、重看或
  多裝置重疊重複加算。寫入 `registrations.watch_duration` 並標記
  `watch_measurement_version=2`。v2 的離房 API 不得再以播放位置覆蓋秒數。
- 舊 progress 客戶端仍能儲存續播位置，但不獲得 v2 有效觀看秒數。
  舊秒數沒有足夠證據可以自動轉換，因此不回填為精確觀看。
- 這是帶身分與時間上限的瀏覽器觀測，不是 DRM 播放證明；被控制的瀏覽器仍能
  偽造合理速度的訊號。網路中斷尚未送出的區間不保證恢復。
- 區間上限 300、影片位置上限 86400 秒；超出明確拒絕，不靜默裁切。

## 到達銷售段

使用直播間最早的非封存、非 live-only CTA `start_time` 當銷售段起點。
未配置這類 CTA 時，不捏造銷售段事件；目前未新增設定頁。
須有實際觀測到起點後至少 0.5 秒的觀看區間，單純跳轉或進房不算。
`sales_segment_reached` 由伺服器寫入，公開 funnel-events 禁止自行宣告。
以 registration+selected-session 的獨立 dedupe key 保證同筆報名同場次一次，
與入房、CTA 點擊、付款各用不同事件 ID。session_id 可為 null（隨到隨看／JIT
沒有對應持久化場次）。

## CTA 與旅程共同鍵

`cta_click` 沿用 webinar_funnel_events，每個點擊實例有獨立穩定去重鍵。
頁面／進度檢查點只在同一頁面旅程去重，不再跨所有報名永久共用。
同一瀏覽器事件轉送至主辦人 Pixel／GTM 時沿用該事件的 event_id。
此次未新增 CAPI 發送服務。

外站歸因走 external-referrals → opaque scRef → /r/ → 外站 sc_ref。
token 雜湊存於 external_referrals；原文只交給需要跳轉／回報的一端。
webinar／owner 由伺服器指定；registration 來自已驗證觀看憑證；
session 從該報名的預約時間對應，沒有時為 null。匿名來源不能冒稱已驗證個人。
此 scRef 不等於 handoff 或觀看 token，也不能作成交通過驗證的證據。
既有 SellCase 私人觀看連結的觀看憑證格式未改；不把它轉傳到外站 CTA URL。
API 日誌只記路徑、狀態、耗時，不新增 body、header、簽章或秘密紀錄。

## 測試隔離

is_test 存在 webinars、registrations、webinar_funnel_events、external_referrals、
external_order_events、external_orders；正常公開報名不能傳入測試分類。
測試 webinar 自動傳遞到報名／事件／scRef／外部訂單；商家也能在簽章 body
設定 isTest:true。外部訂單測試分類不可在狀態變更時偷偷改成正式。

MCP、funnel aggregation、分析摘要、場次報名統計與外部營收摘要預設排除測試，
沒有公共／MCP includeTest 參數。MCP 同時排除軟刪除報名。
已標記測試 webinar 的主辦人 Pixel/GTM 不載入、不轉送漏斗／完成報名事件。
平台本身行銷網站的既有追蹤與正式廣告設定未改。

驗收使用開發資料庫 UUID 夾具與 loopback HTTP，無正式學員、無真實訂單、
無寄信排程、不執行瀏覽器廣告事件。非測試標記的對照樣本也僅在開發夾具中，
用來驗證預設聚合；finally 刪除所有夾具。未呼叫正式站成交回報。

驗證命令：

```sh
NODE_ENV=test node --import tsx --test --test-concurrency=1 \
  server/watchMeasurement.test.ts server/funnelAnalytics.test.ts \
  server/webinarTrackingClient.test.ts \
  server/funnelAnalyticsUi.test.ts server/externalJourneys.contract.test.ts \
  server/externalJourneys.integration.test.ts server/mcpOAuth.test.ts \
  server/trackingSettings.test.ts server/externalJourneySafety.test.ts \
  server/externalJourneys.url.test.ts
npm run check
npm run build
```

關鍵斷言：
- 播放到 900 秒可仍只有 3 秒有效觀看；暫停／跳轉不加算。
- 兩台裝置重疊、同 report 重送、同銷售段重送不重複累計。
- 99999 測試秒數及測試 CTA 不進入 MCP 的對照彙總。
- 999999 測試金額保留收據但不改變正式口徑摘要。
- 偽簽章、沿用簽章竄改金額、跨客戶密鑰、跨 webinar body／scRef 均拒絕。
- 同事件重送冪等；換事件 ID 同訂單不加錢；更改已付款金額 409。
- pending／failed 不加收入；paid 不被晚到 pending 蓋掉；累計退款正確。
- 新工具仍受 OAuth scope、撤銷、會員與選定直播間限制，無寫入與解遮罩。

## 老闆 Publish 前確認

1. 檢視 Publish schema diff：新增測試／測量／狀態欄位，以及事件型別 check
   必須允許 sales_segment_reached。不得重播整套應用 migration 到正式資料庫。
2. 舊外站 type-only 回報仍相容；新 status 回報需簽入 webinarId 或有效 scRef。
   各事件必須使用不同且可重試的 eventId；同訂單金額修正現在會 409。
3. 評估歷史可能已重複入帳的外部訂單：本次未自動更改或重算正式舊帳。
4. 審核哪些非 live-only CTA 代表銷售起點；未來若需另設起點或區分非銷售 CTA，
   另訂明確設定與契約，不能把所有互動當銷售。
5. 在隔離的測試直播間確認實際播放器、手機／iframe 與外站保留 sc_ref 的完整流程。
   自動測試未登入真實外站、未操作真實金流或廣告轉換。
6. user-sellcase 所在外部 connector 仍需自行新增工具／欄位對映；本次沒有修改
   AI創業家專案或其他產品。
