---
name: Post-webinar sequence email idempotency
description: Why enqueueing segmented follow-up sequence emails needs a DB-level partial unique index, not just an app-level check
---

# Post-webinar email-sequence enqueue idempotency

The scheduler loops every 60s and, for each ended webinar, enqueues one `email_reminders` row (reminderType `sequence`) per matching registration × enabled sequence. Matching is by segment (all / watched / not_watched / no_show; watched threshold = 70% of video duration).

## Rule: enforce idempotency at the DB, not just app-level check-then-insert
There is a partial unique index `email_reminders_reg_seq_uniq` on `(registration_id, sequence_id) WHERE sequence_id IS NOT NULL`. The enqueue path still does an app-level `hasSequenceReminder` pre-check, but the unique index is the real guarantee — the insert is wrapped in try/catch so a conflict is silently skipped.
**Why:** check-then-insert across a 60s loop / restart race / multiple instances can double-enqueue, sending duplicate follow-up emails to the same registrant. App-level checks alone are not concurrency-safe.
**How to apply:** any "enqueue once per (entity, campaign)" pattern must back the dedupe with a unique constraint/index; treat the app-level check as an optimization only. The index lives in the Drizzle schema (`emailReminders` table extras) so it survives db:push.

## 開播前與當下提醒的產品規則

排程報名除了原有提醒，使用者要求「開播前 5 分鐘跟當下都要寄一封」。尚未開播的既有報名也要涵蓋，但已錯過的提醒時點不事後補寄。

**Why:** 使用者希望客人在接近開播時及開播當下再次收到入場提醒，而不是只依靠一小時前的信。

**How to apply:** 以每筆報名選定的場次時間計算，不以直播間預設時間計算；保留原有提醒。舊直播間沒有新選項時沿用其一小時提醒的開關，避免替原本關閉定時提醒的主辦人擅自寄信。

## 開播後未出席提醒

使用者要求「沒有出席，10 分鐘後就再傳一個連結提醒他說現在加入還來得及」。

**Why:** 提醒尚未入場的客人回來參加，而不是對已出席者重複催促。

**How to apply:** 以報名選定場次的開播時間加 10 分鐘計算；寄送前重查出席狀態，已結束的場次不再寄「現在加入」訊息。同 Email 同場次的重複報名，只要任一有效報名已出席，就不寄未出席提醒；不同場次仍獨立判斷。

## 場次手動補發

使用者要求每場次能手動補發「要上線囉」通知，收件對象「每次發送時自行選擇」全部報名者或尚未出席者。

**Why:** 主辦者需要臨時補發，而不是只能依賴固定時點的自動提醒。

**How to apply:** 手動補發與自動提醒分開；不要因手動發送而改動自動排程。對象與人數要先確認，同場次同 Email 合併一封，未出席模式在寄出前重查出席；斷線重試須沿用同一次通知識別，不能自動另建一批。
