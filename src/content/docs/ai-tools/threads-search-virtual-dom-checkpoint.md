---
title: Threads 搜尋被虛擬 DOM 與逾時誤判完成
description: Threads search results can look complete while delayed hydration, recycled cards, and a long-running browser call have skipped the required time range.
date: 2026-08-24
tags:
  - threads
  - browser-automation
  - virtual-dom
  - checkpoint
  - codex
status: fixed
system: browser-automation
severity: medium
aliases:
  - Threads search incomplete
  - Threads virtual DOM oldest timestamp
  - Threads search checkpoint
  - browser runner timeout
---

## 快速結論

Threads 搜尋頁不應以目前可見卡片、無新 URL 或捲動次數判定完成。初次導覽先等貼文卡片出現；每輪立即把 URL、絕對時間與摘要 append 到檔案，並以整份累積資料的最舊時間是否跨過 checkpoint 判定完成。

透過 extension backend 時，頁面 JavaScript 的 `window.scrollBy()` 成功執行也不代表可見 feed 已捲動。先量實際 scroll position；若不變，改用 browser-level 的 CUA scroll，僅在該層失敗時才 fallback 到 page-context scroll。

把搜尋拆成短批次，保留同一分頁續跑。這可避開 browser runner 的執行上限，也讓中斷後能從落盤資料恢復。

## 症狀

- 搜尋第一次抽取到零筆，稍後同一頁才出現結果。
- 捲動後可見卡片的最舊時間反而變新，或沒有新 URL。
- 呼叫 `window.scrollBy()` 沒有錯誤，但搜尋結果與實際 scroll position 都不變。
- 一次跑很多輪時，browser runner 被逾時重置，且最後沒有完成 manifest。
- 以 `End` 跳到底後，結果沒有覆蓋上一輪探索的時間點。

## 影響範圍

- Service：Threads 關鍵字搜尋。
- Environment：以瀏覽器 extension 或自動化 backend 抽取搜尋結果的流程。
- User-visible impact：把未完整搜尋誤報為完成，遺漏較舊貼文。
- Data risk：若只在結束時寫檔，逾時會遺失已抽取內容與摘要。

## 排查

實頁量測初次導覽後的卡片數：0 與 0.5 秒都是零，約 1 秒才有四筆結果。接著以約一個卡片高度的小幅捲動，每輪等待載入並抽取卡片。

```javascript
try {
  await tab.cua.scroll({ x: 700, y: 750, scrollX: 0, scrollY: 560 });
} catch {
  await tab.playwright.evaluate((pixels) => window.scrollBy(0, pixels), 560);
}
```

page-context `window.scrollBy()` 在 extension backend 沒有丟錯，但 feed 停在原處。改以 CUA 對可見 viewport 捲動後，document top 由 0 前進到 560，並在後續輪次持續載入較舊貼文。

量測顯示較舊貼文會在數輪後出現，但之後可見 DOM 的最舊時間可能往新方向跳回。這排除了「目前畫面的最舊時間可當游標」的假設，符合搜尋頁回收與重用卡片的行為。

另一個測試讓單次 runner 持續多輪，約 30 秒後執行環境重置；此前每輪已 append 的原始資料仍存在，只有結尾才寫的 manifest 缺失。

## 根因

根因有四層：

1. 搜尋結果採延遲 hydration，太早抽取會得到空 DOM。
2. Threads 使用 virtual DOM，卡片會被回收或重排；最後一輪的 visible DOM 不是完整結果集。
3. 長時間瀏覽器呼叫受執行上限限制；若資料只在 query 結束時寫入，重置會遺失狀態。
4. extension backend 的 page-context JavaScript 與使用者可見的可捲動 viewport 不是可靠的同一層；`window.scrollBy()` 無錯誤回傳不能當成實際輸入已生效的證據。

`End` 的大幅跳轉會加劇第二個問題，因為中間 lazy-load 的卡片未必被載入或抽取。

## 修正

新增可續跑的 extension runner，採用以下規則：

```text
導覽 → 輪詢卡片（250ms，最長 8 秒）
→ 抽取並 append 結果／scratch／event
→ CUA 小幅捲動 560px（失敗才 fallback `window.scrollBy`），等待約 1.1 秒
→ 最舊「累積」時間 <= checkpoint 才 completed
```

- 每個 invocation 只跑一個 query batch；每批最多 12 輪、35 秒安全預算。下一批保留同一 tab，以 `navigate: false` 接續。
- 每批都寫 manifest：未跨 checkpoint 是 `in_progress`，明確收尾才是 `incomplete`；manifest 記錄 `resume.tab_id`、下一輪與批次時間，讓 kernel reset 後接回原頁。
- checkpoint 以同 query 最後一次 `completed` 的 `completed_at` 決定，不使用共享 results JSONL 的 mtime。
- 從既有 JSONL 重建 URL union 與最舊時間，避免中斷後重跑或誤判。
- legacy fallback 將預設按鍵由 `End` 改為 `PageDown`。

## 驗證

- `node --check` 驗證 runner 與 fallback script 語法。
- 以 mock 模擬兩批搜尋：第一批未跨 checkpoint 時回傳 `in_progress` 並帶 resume 資訊；第二批讀回第一批 JSONL 後，加入較舊貼文並回傳 `completed`。
- 實頁量測確認：page-context scroll 停在原位；CUA scroll 會推進 scroll position，並逐步載入更舊結果。修正後重新執行全部關鍵字與啟用 tag；各 query 皆留下 completed 或 explicit incomplete manifest。

## 下次先查

1. 初次導覽後先等貼文卡片，不要把空 DOM 當零結果。
2. 每次 scroll 後量 scroll position 或新貼文數；不要只因 `window.scrollBy()` 沒有錯誤就當作前進。
3. 檢查每輪 JSONL/event 是否都有 append，而不是只看最後畫面。
4. 用整份 JSONL 的最舊絕對時間和 checkpoint 比較。
5. 分成短批次；若 runner 重置，以既有 JSONL／manifest 和同一頁面位置續跑。
