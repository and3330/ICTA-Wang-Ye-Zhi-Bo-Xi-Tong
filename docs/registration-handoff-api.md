# SellCase 安全報名交接串接指南

本文件供第三方網站後端、前端及測試人員使用，描述目前實作，不代表某個
正式直播間已啟用外部跳轉，也不代表完成了正式環境的端對端驗證。

所有識別碼、交接碼、密鑰及觀看憑證範例皆為佔位值。請勿在文件、截圖、
分析事件或公開紀錄中放入真實憑證與學員資料。

相關文件：[外部流程與成交歸因 API](external-journeys-api.md)。

## 1. 功能與邊界

安全交接讓外站在 SellCase 報名成功後，從自己的後端取得報名結果，
再顯示立即觀看按鈕或預約時間。它不是登入、付款驗證或 MCP 授權機制。

流程：

1. 學員完成 SellCase 報名，資料已成功儲存。
2. SellCase 依直播間「已發佈」的外部流程設定建立一次性交接碼。
3. 報名頁收到 `externalThankYou.redirectUrl` 後，嘗試在目前視窗跳轉。
4. 外站後端兌換 `handoff`，核對 `webinarId`，保存成功結果。
5. 外站以自己的 session 恢復完成頁，並以 `registrationId` 去重轉換。

不可單靠開啟感謝頁、URL 參數或 iframe 通知計算成功報名或購買。
交接失敗也不等於報名失敗：報名資料可能已經成功建立。

## 2. 上線前設定

在對應直播間設定：

| 設定欄位 | 必要值與用途 |
| --- | --- |
| `thankYouMode` | `"external"` |
| `thankYouUrl` | 外站完整 HTTPS 完成頁網址，例如 `https://partner.example/thanks` |
| `secureHandoffEnabled` | `true`，才會產生 `handoff` |
| `includeWatchLinkInHandoff` | 需要觀看按鈕時設為 `true`；必須同時開啟安全交接 |
| `includeContactInHandoff` | 預設 `false`；只有確實需要姓名與 Email 時才明確開啟 |
| `approvedOrigins` | 若需要 `sc_ref` 歸因，加入完成頁的精確 HTTPS origin |
| `approvedEmbedOrigins` | 使用跨站 iframe 時，加入父頁的精確 HTTPS origin；與歸因來源是不同設定 |

Origin 範例為 `https://partner.example`，不包含路徑、查詢或 fragment。
URL 及來源還需通過伺服器 HTTPS、DNS 與非內網位址驗證。
`landingMode`、`landingUrl` 是介紹頁設定，不應為了設定感謝頁覆蓋原值。

設定使用草稿與已發佈快照，只有儲存草稿不會改變公開行為：

- `GET /api/webinars/:id/external-journey`：擁有者讀取草稿與版本。
- `PUT /api/webinars/:id/external-journey`：帶 `{version, settings}` 儲存草稿；
  `settings` 是完整設定物件，不是任意欄位的 PATCH。
- `POST /api/webinars/:id/external-journey/publish`：帶 `{version}` 啟用已存設定；
  直播間必須已發佈，且版本必須符合，否則可能回 `409`。
- 以上管理操作需要既有會員登入及直播間擁有權，並受會員資格限制。

**整合測試完成、主辦人明確確認之前，不要啟用正式直播間的外部跳轉。**
發佈外部流程設定與發佈應用程式是兩件事；即使不部署新程式，啟用正式
設定也可能立刻改變報名者的流程。

### 密鑰

- 使用該主辦會員的外部整合密鑰，不是 Clerk、Stripe、MCP OAuth token。
- 密鑰僅放在外站後端的安全密鑰設定，不能放入前端、URL、聊天或文件。
- 密鑰屬於會員，而不是一次報名；不可假設輪替只影響某個直播間。
- `GET /api/member/external-journeys/connection` 只提供連線狀態與相對端點，
  不會回傳原密鑰。
- 不要為了確認狀態呼叫 `/connection/rotate`：它會真正輪替密鑰，
  既有整合可能因此失效。已安全保存既有密鑰時直接沿用。

## 3. 跳回參數

啟用安全交接時，跳回格式：

```text
https://partner.example/thanks?handoff=<OPAQUE_HANDOFF>
```

若完成頁的 origin 也在 `approvedOrigins`，另外附加：

```text
https://partner.example/thanks?handoff=<OPAQUE_HANDOFF>&sc_ref=<OPAQUE_REFERRAL>
```

參數順序不固定，完成頁原有的查詢參數可能仍保留，請用 URL 解析器讀取。

| 參數 | 用途 |
| --- | --- |
| `handoff` | 短效、一次性的兌換能力；不是報名 ID，也不是觀看 token |
| `sc_ref` | 選用的外部歸因碼，不能代替報名驗證 |

沒有安全交接時也可能只做普通跳轉，因此「抵達完成頁」不代表一定有交接碼。
回跳 URL 不包含學員姓名、Email 或原始觀看 token；`handoff` 本身仍需保密。

標準報名 API 的成功回應可包含：

```json
{
  "externalThankYou": {
    "redirectUrl": "https://partner.example/thanks?handoff=<OPAQUE_HANDOFF>",
    "handoffExpiresInSeconds": 600
  }
}
```

上例只列出外部流程相關欄位，不是完整報名 API 回應。
`handoffExpiresInSeconds` 在安全交接啟用時提供，不是兌換 API 的回應欄位。
若外部流程附加資料產生失敗，成功報名回應可能帶
`externalThankYouUnavailable: true`，並保留內建成功／觀看流程。

## 4. 伺服器兌換 API

```http
POST /api/external/handoffs/exchange
Authorization: Bearer <SELLCASE_EXTERNAL_SECRET>
X-External-Destination: https://partner.example
Content-Type: application/json
```

```json
{
  "handoff": "<OPAQUE_HANDOFF>"
}
```

將此相對端點接在已確認的 SellCase 正式服務基底網址之後。
不要把請求中的 Host 或使用者輸入直接當成服務基底網址或 Destination。
跨站整合應由後端呼叫，不依賴第三方登入 cookie，也不是瀏覽器 CORS API。

| 項目 | 契約 |
| --- | --- |
| `handoff` | 必填 `string`，符合 `^[A-Za-z0-9_-]{24,128}$`；body 不接受額外欄位 |
| `Authorization` | 必須符合該交接碼擁有者的會員整合密鑰 |
| `X-External-Destination` | 外站事先設定的 HTTPS origin，需與交接綁定的完成頁 origin 相符 |
| `Origin` | 若存在，優先於 `X-External-Destination`；後端不要盲目轉送不相關的 Origin |

不接受呼叫者指定其他 `registrationId`、`webinarId` 或觀看 token 來取得資料。

## 5. 成功回應

### 立即觀看：HTTP 200

```json
{
  "registrationId": "<REGISTRATION_ID>",
  "webinarId": "<WEBINAR_ID>",
  "selectedSession": null,
  "watchUrl": "/webinar/<WEBINAR_ID>?watchToken=<REDACTED>"
}
```

### 預約場次：HTTP 200

```json
{
  "registrationId": "<REGISTRATION_ID>",
  "webinarId": "<WEBINAR_ID>",
  "selectedSession": "2026-12-01T12:00:00.000Z",
  "watchUrl": "/webinar/<WEBINAR_ID>?watchToken=<REDACTED>"
}
```

| 欄位 | 實際型別 | 說明 |
| --- | --- | --- |
| `registrationId` | `string` | 持久化報名 ID，不是觀看 token；可用於完成註冊事件去重 |
| `webinarId` | `string` | 直播間 ID，外站應與允許的直播間設定核對 |
| `selectedSession` | `string \| null` | `null` 為隨到隨看；否則為 UTC ISO 8601 場次時間 |
| `watchUrl` | 選用 `string` | 標準報名流程目前提供相對觀看路徑；只在交接允許且保存了觀看連結時回傳 |
| `contact` | 選用 `{name: string, email: string}` | 明確啟用聯絡資料交接時才回傳；不含電話 |

選用欄位可能完全省略，不能假設會回傳 `null`。
交接是否包含觀看連結及聯絡資料，在產生該交接碼時決定。

### 已知缺少的欄位

- 沒有直播間標題。
- 沒有 `mode` 或其他獨立的觀看模式欄位；非空的 `selectedSession`
  無法單靠此介面區分「即時開始」和「一般預約」。
- 沒有直播間時區。`Z` 表示 UTC，不是主辦人設定的 IANA 時區。
  外站應從自己的已核對直播間設定取得標題與顯示時區。
- 沒有通知信排程、寄出或投遞狀態，不能據此宣稱「通知信已寄出」。
- 沒有付款狀態，不能據此觸發購買轉換或判定付款成功。

例如 `2026-12-01T12:00:00.000Z` 以 `Asia/Taipei` 顯示為
2026/12/01 20:00；顯示時區不是 API 回傳的新欄位。
觀看是否已開放仍由 SellCase 觀看權限檢查決定，不要只依外站時鐘放行。

### 相對觀看網址

外站必須以可信任的 SellCase 服務基底網址解析，不可把相對路徑直接當成
外站的站內連結。以下為後端片段，不是完整 callback 實作：

```js
const base = new URL(config.sellcaseBaseUrl); // 事先設定並核對的正式 HTTPS origin
const watchUrl = result.watchUrl ? new URL(result.watchUrl, base) : null;
if (watchUrl && (watchUrl.protocol !== "https:" || watchUrl.origin !== base.origin)) {
  throw new Error("Unexpected SellCase watch URL origin");
}
```

若沒有 `watchUrl`，顯示「報名已確認」及替代說明，不要自行拼出無憑證連結。
觀看網址包含憑證，只應提供給該報名者，不可進入像素事件、第三方分析或公開日誌。

## 6. 失敗回應

目前只有 `message`，沒有固定業務錯誤碼；以下描述兌換路由自身的回應。
網路、代理或上游故障也可能沒有 JSON，外站需另行處理。

| 情況 | HTTP | JSON |
| --- | --- | --- |
| 格式正確但 handoff 不存在或過期 | `401` | `{"message":"Handoff is expired or already used"}` |
| handoff 已兌換，含並行兌換的失敗者 | `401` | `{"message":"Handoff is expired or already used"}` |
| 有效 handoff，但密鑰缺少或錯誤 | `401` | `{"message":"Invalid integration secret"}` |
| 有效 handoff、正確密鑰，但 Destination 缺少或不符 | `403` | `{"message":"Handoff destination mismatch"}` |
| 交接對應的報名不存在 | `404` | `{"message":"Registration not found"}` |
| JSON 欄位驗證或其他處理失敗 | `400` | `{"message":"<驗證或處理錯誤訊息>"}` |

`400` 的詳細文字不是固定契約，某些異常來源格式也可能走此路徑。
不要依文字解析推測成功。不存在、過期、已使用三者刻意共用同一回應。

驗證順序為：body → 交接碼有效性 → 密鑰 → Destination →
原子標記交接碼已使用 → 讀取報名 → 回傳資料。
因此過期的交接碼搭配錯誤密鑰，仍會先得到交接碼錯誤。

## 7. 一次性、重試與恢復

- 自建立起有效 **600 秒（10 分鐘）**，不是自抵達外站時計算。
- 僅能兌換一次，並行兌換不會回傳兩份成功結果。
- 密鑰或 Destination 驗證失敗不消耗交接碼。
- 通過驗證後，會先標記已使用；後續資料讀取、解密、傳輸仍可能失敗。
- **沒有冪等重取機制。** 若 SellCase 已消耗交接碼，即使外站沒有收到
  成功回應，再送一次也可能只得到 `401`。

外站建議：

1. 用同一個後端 callback 處理，不讓 SSR、前端 effect、prefetch 或多個
   工作程序各自重複兌換；用後端鎖或唯一約束控制同碼並行。
2. 成功取得並核對結果後，安全保存至後端，綁定外站自己的使用者 session。
3. 若需索引交接碼，使用雜湊，避免原始交接碼進入一般日誌。
4. 透過乾淨的完成頁 URL 顯示結果；重新整理讀外站後端保存值，不再兌換。
5. 避免在處理交接碼前載入會收集完整頁面網址的分析程式；清除敏感查詢，
   配合適當 Referrer-Policy、`Cache-Control: no-store` 及日誌遮罩。
6. 逾時且沒有保存結果時，顯示無法確認／恢復交接的狀態，不補算轉換，
   也不要讓已報名者被迫重複報名。

外站只能恢復自己已保存的結果；若第一次成功回應已遺失，現有 SellCase
API 不能單憑已使用的 handoff 重新取得結果。

## 8. iframe 與父頁通知

一般報名頁與嵌入報名頁都使用 `window.location.assign(...)`：

- 一般頁跳轉目前頁面。
- iframe 內報名只跳轉該 iframe，**不會自動跳轉整個父頁**。
- 外部完成頁需允許被實際父頁嵌入，並考量 iframe sandbox、CSP、
  X-Frame-Options 及外站自身 session 在第三方環境的可用性。
- SellCase 嵌入報名 POST 使用 `credentials: "omit"`，不依賴第三方登入
  cookie；這不代表外站自己的完成頁可以不考慮第三方 cookie 限制。

嵌入頁在有效 HTTPS 外部跳轉分支呼叫 `assign` 後立即 `return`，
**不會再發送 `livecast:registered`**。不要假設父頁會收到跳轉前通知。

僅在內建成功或程式可捕捉的回退流程，會嘗試發送：

```json
{
  "type": "livecast:registered",
  "webinarId": "<WEBINAR_ID>"
}
```

跨站父頁須由 referrer 辨識，並出現在 `approvedEmbedOrigins`；
同來源父頁可接收。通知不含報名 ID 或觀看憑證。
瀏覽器未拋出可捕捉例外，不代表目的頁一定可成功載入。

若外站需要整個瀏覽器跳轉，或要求跳轉前一定送出帶驗證資料的父頁通知，
這些都不是目前提供的行為，需另訂契約與實作。

### 手機與內建成功頁的觀看連結

未走外部跳轉時，SellCase 報名成功頁會以這次報名回傳的觀看憑證組成觀看網址；
嵌入頁的觀看按鈕使用原生連結在新分頁開啟。這不是外部感謝頁的最外層跳轉協議。
新分頁不能依賴 iframe 的 sessionStorage，儲存被瀏覽器禁止時也不能遺失觀看憑證。
外站同樣應使用兌換回傳的完整 `watchUrl`，不要只開 `/webinar/{id}`，
也不要用舊報名暫存的連結取代本次報名結果。

## 9. 完成註冊事件

僅在後端兌換成功並核對直播間後，才顯示可信的報名完成資訊及回報轉換。
以 `registrationId` 去重，依實際分析平台要求實作事件 ID 與跨端去重。
同一 Email 可以重複報名同一直播間，或選擇不同場次；每次成功報名都有
獨立的報名 ID、觀看憑證及交接結果。外站不得以 Email 覆蓋既有報名或
當作轉換去重鍵，也不得把舊報名的觀看網址套用到新報名。
若同時有 SellCase 端及外站端追蹤，需協調事件責任，避免重複計算。
不要把觀看 token、watchUrl、handoff 或學員個資當成分析參數。

此 API 證明報名結果，不證明付款或郵件投遞成功。

## 10. 串接驗收清單

- [ ] 用隔離測試直播間／測試身分驗證，不先啟用正式直播間外部跳轉。
- [ ] 立即觀看回傳 `selectedSession: null`，專屬觀看入口可正確解析。
- [ ] 預約場次顯示正確日期及時區，不能提前繞過 SellCase 開放時間。
- [ ] 即時開始的時間能顯示，但不假設 API 會提供模式標籤。
- [ ] 關閉交接觀看連結時省略 `watchUrl`，外站不產生錯誤觀看按鈕。
- [ ] 預設沒有 `contact`；明確允許時也只處理需要的欄位。
- [ ] 無效、過期、重複兌換、錯誤密鑰、錯誤 Destination 均不計轉換。
- [ ] 重新整理、多分頁及並行呼叫不重複兌換或計算轉換。
- [ ] 模擬回應遺失，確認無法重取時顯示誠實的恢復提示。
- [ ] iframe 只導向自身，完成頁可被嵌入；不依賴 `livecast:registered`。
- [ ] 測試封鎖第三方 cookie 時，外站 session 與完成頁的替代行為。
- [ ] 日誌、網址、快取、分析工具不洩漏交接碼、觀看憑證或個資。
- [ ] 主辦人確認外站測試完成後，再另行批准正式設定啟用。

## 11. 文件維護

契約來源：

- `server/externalJourneys.ts`：交接建立、有效期、兌換與錯誤順序。
- `shared/externalJourneys.ts`：設定及請求驗證。
- `server/routes.ts`：成功報名後產生相對觀看路徑與選用交接資料。
- `client/src/pages/registration.tsx`：一般報名頁跳轉。
- `client/src/pages/embed-register.tsx`：iframe 跳轉、父頁通知與 cookie 行為。

調整以上契約時同步更新本文件與相關測試，明確區分「目前已提供」
和「未來建議」，不可把新欄位、重試能力或通知行為先寫成已實作。
