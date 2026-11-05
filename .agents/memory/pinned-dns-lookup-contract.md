---
name: Pinned DNS lookup contract
description: Node automatic address-family selection changes the callback format required from a custom HTTPS lookup.
---

自訂 DNS lookup 必須依 `options.all` 回傳單一 address/family 或 address 物件陣列；
即使只允許連到一個已驗證 IP，也不能永遠回傳單一字串。

**Why:** Node 20 的 HTTPS 自動 address-family selection 會要求 `all: true`；
格式不符時會出現誤導性的 `Invalid IP address: undefined`，即使 DNS 已成功解析。

**How to apply:** 所有固定已驗證 IP 的 HTTPS 抓取，都測試兩種 callback 格式及
真正 socket 連線路徑。不要用關閉 SSRF 檢查或重新進行未驗證 DNS lookup 來繞過。
