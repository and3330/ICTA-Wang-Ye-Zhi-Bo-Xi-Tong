---
name: Shared notification accounts
description: User-selected account ownership for LINE, SMS and WhatsApp and Taiwan SMS link constraints.
---

SellCase 要一起串接 LINE Flex、簡訊及 WhatsApp，使用者選擇「全站共用我的帳號」，不是各主辦人自備帳號。

**Why:** 使用者明確選擇三種一起串接與共用自己的帳號。

**How to apply:** 服務帳號由站長統一設定，仍保留直播間、客人綁定、收件同意及發送對象的隔離。主辦人不可取得共用憑證；不要擅自改成各主辦人自行申請服務。

## 台灣簡訊的觀看連結

選擇簡訊商前確認台灣帶連結簡訊的品牌登記及網址審核要求，不能假設接好 API 就能送達。

**Why:** Twilio 官方台灣 SMS 規範在 2026-11-06 查核時，要求品牌登記，含網址的內容需先向供應商申請完整網址允許名單，特別限制短網址。

**How to apply:** 先確認使用者已有的簡訊商與已核准的網址／模板。若考慮 Twilio，重新查閱官方 https://www.twilio.com/en-us/guidelines/tw/sms ，不要未審核就承諾台灣可寄帶觀看連結的提醒。
