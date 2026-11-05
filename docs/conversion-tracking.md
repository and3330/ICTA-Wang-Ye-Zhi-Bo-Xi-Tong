# 直播間轉換追蹤設定

## 設定與限制

入口：直播間管理 → 設定 → 轉換追蹤。

- Meta Pixel ID：5–32 位數字。填的是 Pixel ID，不是 API token 或整段 JavaScript。
- GTM Container ID：`GTM-` 開頭的大寫英數字，總長 8–24 字元。
- 可以只填其中一項；留白並儲存會清除該項設定。
- 需按「儲存追蹤設定」。畫面上的範例是 placeholder，不代表已設定。
- 儲存的是該直播間的主辦人追蹤 ID，不是平台自己的 Pixel。
- 設定值會供公開報名頁與嵌入報名頁等觀看流程載入官方 SDK。

GTM ID 只負責載入容器，不會自動替主辦人建立 Google Ads、GA4 或其他標籤。
主辦人仍須在 GTM 設定觸發條件及標籤並發佈容器。
廣告阻擋器、瀏覽器限制、Pixel／容器未啟用等也可能影響實際送達。

## 報名完成事件

一般及嵌入報名表在成功取得伺服器建立的報名 ID 後，會回報：

| 目的地 | 事件名稱 | 去重 |
| --- | --- | --- |
| 主辦人 Meta Pixel | `CompleteRegistration`，以 `trackSingle` 指定該 Pixel | `eventID: registration_<registrationId>` |
| GTM dataLayer | `webinar_registration` | `event_id: registration_<registrationId>` |

事件資料包含 `webinar_id`、`registration_id`、`event_id`，
不包含姓名、Email、電話或觀看 token。前端同一頁載入內不重複派發同一
Pixel／容器的同筆報名事件，Meta 另收到穩定的 eventID。

只有成功持久化報名才發送；開啟報名頁、驗證失敗、API 失敗都不會回報完成。
同 Email 再次報名若建立另一筆報名 ID，屬於另一筆報名事件。

成功跳往外部感謝頁的流程不由本站重複送出這個完成事件。
外站應先依 [安全交接指南](registration-handoff-api.md) 驗證交接，
再顯示成功狀態並以報名 ID 去重回報，不能只憑感謝頁網址就算轉換。

## 既有互動事件

觀看、進入直播間、影片進度、CTA 顯示、CTA 點擊、開始結帳等既有事件，
仍由該直播間的追蹤提供者發送。主辦人事件不可廣播至其他主辦人或平台 Pixel。

## 付款界線

這個設定與報名完成事件不是付款證明。不得把點擊 CTA、開啟付款結果頁或
瀏覽器參數當成 Purchase；商品付款狀態仍由可信金流回呼決定。
本文件不保證只填 ID 就已建立主辦人的完整 Purchase／退款廣告回傳鏈路。
平台 SaaS 自身訂閱轉換與主辦人商品轉換是不同用途，不可混用。

## 驗證方式

開發測試以隔離直播間驗證設定新增／清除、SDK 請求、實際報名寫入、
報名失敗不回報與成功事件去重；第三方 SDK 使用測試替身，避免污染真實廣告資料。

正式上線後仍需以主辦人的 Meta 測試事件工具／GTM 預覽確認真實帳戶收件，
以及檢查容器內標籤與觸發條件。測試通過不等於第三方廣告報表已收件。
