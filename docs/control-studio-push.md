# 即時控制台：導播台推送

## 使用方式

1. 主辦人登入並進入該直播間的即時控制台。
2. 等待控制台完成 WebSocket 主辦人驗證；只有連線建立還不代表已取得推送權限。
3. 觀眾需使用有效報名觀看連結進入直播間並加入聊天室，才能收到即時推送。
4. 控制台影片預覽本身不是觀眾接收端。測試時另外開啟已報名的觀眾頁。

CTA 可選完整的外部 HTTP(S) 網址、自己已上架的商品，或自己已發佈的成交頁。
`#`、相對路徑、JavaScript URL 不能作為外部 CTA 目標。
例如 `https://example.com/offer` 是格式範例，不是預設銷售網址。

即時推送只送給當時已進場連線的觀眾，不是加入時間軸的永久排程。
需要觀眾播放到某個時間點再顯示，請使用排程互動設定。

## CTA 結果確認

控制台發送 `liveCta` 時附上本次 `requestId`，等待伺服器的：

```json
{
  "type": "hostActionResult",
  "data": {
    "action": "liveCta",
    "requestId": "<REQUEST_ID>",
    "success": true,
    "viewerCount": 1
  }
}
```

`success: true` 代表已儲存 CTA 並將推送交給當時的 WebSocket 接收端；
不是瀏覽器已完成呈現或使用者已點擊的收件證明。
`viewerCount` 是伺服器當時記錄的觀眾連線數。
原有觀眾端仍使用 `liveCta` 訊息呈現按鈕，沒有更換觀看協議。

驗證失敗時回傳 `success: false` 與可顯示的 `message`，例如：

```json
{
  "type": "hostActionResult",
  "data": {
    "action": "liveCta",
    "requestId": "<REQUEST_ID>",
    "success": false,
    "message": "請填寫完整的 http:// 或 https:// 網址，不能使用 # 或相對路徑"
  }
}
```

前端僅在收到相符的成功確認後顯示成功；等待期間禁止重複按 CTA 推送。
斷線或 10 秒未收到確認，結果是未知，應先確認觀眾畫面，不能假設伺服器完全沒有執行。
`requestId` 用於配對回覆，不是伺服器冪等鍵，因此不自動重送。

小提示、聊天與投票目前保留原有訊息協議；新增的 CTA 結果確認不能視為其他工具也有逐筆確認。
