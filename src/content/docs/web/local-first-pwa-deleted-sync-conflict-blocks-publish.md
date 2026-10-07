---
title: Local-first PWA 完整同步後仍無法發布：已刪除貼文的衝突被清單隱藏
description: 發布檢查可能先花時間掃描舊 R2 事件，完成後又被貼文清單未顯示的 delete/update 衝突阻擋。
date: 2026-10-07
tags:
  - pwa
  - cloudflare-r2
  - sync
  - publishing
  - ux
status: fixed
system: local-first-static-publisher
severity: medium
aliases:
  - 正在確認跨裝置狀態
  - 完整同步後仍不能發布
  - deleted tombstone conflict hidden from library
  - R2 delete update conflict blocks publish
---

## 快速結論

「完整同步成功」只表示遠端事件已下載並合併，不代表所有版本衝突已解決。這次發布檢查先對舊 R2 同步空間掃描數百筆事件，讓畫面長時間停在「正在確認跨裝置狀態」；掃描完成後，發布仍被一筆 `status: deleted`、`sync.conflict: true` 的短文擋住。貼文清單原本排除所有已刪除項目，使用者無從處理。

讓刪除衝突出現在「待處理」，明確確認要保留刪除版本後建立 resolution event，再同步一次。掃描效能與重複檢查是另一層問題，需分開量測和修正。

## 症狀

- 開啟發布面板後，長時間顯示「正在確認跨裝置狀態」。
- 使用者已按「完整同步」，發布按鈕仍被同步狀態擋住。
- 貼文清單看不到任何可解決的衝突，或只看到與發布阻擋數量不一致的項目。
- 待遠端檢查結束，狀態可能變成「需要同步」或「有同步衝突」；這兩種結果必須分開診斷。

## 影響範圍

- Service：以 IndexedDB 保存本機貼文、以 R2 append-only events 和 tombstone 做跨裝置同步的靜態發布 PWA。
- 使用者影響：發布被阻擋，但清單沒有衝突處理入口；遠端檢查耗時又讓阻擋原因延後出現。
- 資料風險：本案例沒有證據顯示內容遺失。選擇保留刪除會決定衝突的最終版本，必須由使用者確認。

## 排查

1. 記錄發布面板的階段與同步進度。若停在遠端檢查，先分清首次舊空間補索引、一般增量檢查和重複觸發的檢查；不能只憑等待時間推定死循環。
2. 完成檢查後，分別記錄遠端未知事件數、本機待上傳事件數、網站設定衝突數與貼文衝突數。`needs-sync` 和 `conflict` 的下一步不同。
3. 檢查所有本機貼文，包括 tombstone，而非只讀 UI 的可見清單。特別找出已刪除且仍標記衝突的紀錄：

```ts
const deletedConflicts = posts.filter(
  post => post.status === "deleted" && post.sync?.conflict
);
```

4. 對照發布 gate 與清單過濾條件。若 gate 對所有貼文檢查 `sync.conflict`，清單卻排除 `status === "deleted"`，就會形成無法從 UI 解決的阻擋。
5. 確認版本衝突的種類與使用者原意。delete/update 並行、不同裝置的刪除操作或舊資料投影，都應由事件因果關係判斷；不要僅憑 `deleted` 自動消除衝突。

```ts
const publishBlocked = posts.some(post => post.sync?.conflict);
// 舊清單若一律排除 deleted，可能看不到阻擋發布的項目。
const visiblePosts = posts.filter(post => post.status !== "deleted");
```

## 根因

發布 gate 正確地將任何未解決的貼文衝突視為阻擋條件，包含 tombstone。清單則把「已刪除」和「不需要顯示」視為同一件事，沒有為已刪除但仍有衝突的紀錄留例外。同步完成不會替使用者選擇衝突版本，因此重按同步無法消除這筆衝突。

此外，舊同步空間的完整 R2 事件掃描與發布入口的重複 freshness check，讓結果出現得慢。等待時間本身不是刪除衝突的根因；掃描效能另見增量同步 runbook。

## 修正

- 清單保留 `status !== "deleted" || sync.conflict` 的貼文，並讓刪除衝突出現在「待處理」與計數中。
- 發布面板顯示刪除衝突數量及處理路徑；檢查期間顯示實際進度。
- 「保留刪除」先顯示確認對話框，呼叫既有衝突解決流程建立引用衝突版本的 resolution event；完成後要求再同步一次，讓其他裝置收斂。
- 發布前檢查以 remote marker、本機完成同步 checkpoint 和 blocking counter 加快正常增量路徑；同一代資料的檢查共用進行中請求，短時間重用已確認的 ready 結果。舊 identity 第一次仍可能完整掃描。

```ts
const librarySource = posts.filter(
  post => post.status !== "deleted" || post.sync?.conflict
);
```

## 驗證

- 原專案的單元測試、型別檢查與建置已通過；修正後的正式 PWA 已實際顯示一筆「待處理」刪除衝突，以及遠端掃描進度。
- 尚未由使用者在正式資料上確認「保留刪除」並重跑同步、發布；因此不能把端到端發布記為已驗證。
- 回歸時至少驗：一般已刪除貼文仍不出現在清單、刪除衝突出現在「待處理」、確認後產生 resolution event、再次同步後 gate 不再被該衝突阻擋。另以乾淨 PWA session 確認載入的是新部署版本，避免舊 service worker 資產影響觀察。

## 下次先查

發布前卡住時，先看檢查進度與最後 gate 狀態；若是 `conflict`，直接比對完整本機貼文集合與 UI 清單，特別查 `deleted && sync.conflict`。若是 `needs-sync`，比較遠端 marker、checkpoint 和兩端待處理事件數，再查是否重複執行完整掃描。
