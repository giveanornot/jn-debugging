---
title: R2 append-only 同步每次都掃描舊事件，少量變更仍要數十秒
description: A local-first PWA can spend most of an incremental R2 sync listing and downloading known events when a device counter has gaps or a completed checkpoint is ignored.
date: 2026-09-30
tags:
  - pwa
  - cloudflare-r2
  - sync
  - performance
  - indexeddb
status: fixed
system: local-first-static-publisher
severity: medium
aliases:
  - R2 incremental sync takes 30 seconds
  - R2 event index counter gaps
  - R2 同步重讀已知事件
---

## 快速結論

append-only R2 同步若用「每台裝置的連續 counter」當唯一的已知範圍，舊資料的 counter 缺口會讓每次同步重新列出、下載數百個早已存在本機的事件。即使改成索引掃描，只要不使用上次完成同步的 remote marker，少量本機變更仍會付出整輪遠端清單請求。

先以 `(device_id, counter)` 對列出的索引 key 與本機事件做差集；當遠端 marker 與已完成的本機 checkpoint 相同時，直接取本機新 counter 作待上傳事件。事件物件與索引仍維持不可覆寫，上傳成功後才寫 marker 和本機 checkpoint。

## 症狀

- 首次從舊同步空間匯入並補建索引約需數分鐘。
- 完成首次同步後，只新增少量內容，下一次同步仍列出數百筆索引，甚至重新 GET 已知事件 JSON。
- 原本 3 個增量事件約 37 秒；刪除一筆內容留下的 tombstone 約 24 秒。
- UI 長時間停在「正在讀取其他裝置的變更」，上傳量卻很少。

## 影響範圍

- Service：IndexedDB local-first PWA，以 R2 append-only 事件和每裝置 counter 索引交換內容。
- 使用者影響：同步等待時間與實際新增事件數不成比例。
- 資料風險：此案例未發現內容遺失；中斷同步後必須保留安全重試能力。
- 範圍限制：首次為舊空間補索引仍是一次性完整掃描，快路徑只適用於已完成 checkpoint 且 remote marker 未變的增量同步。

## 排查

1. 記錄同步各階段進度與遠端 request 數，分清首次補索引、一般增量、圖片傳輸與刪除 tombstone。
2. 檢查 R2 `sync-state.json` 是否有 `index_version`。舊空間第一次完整 backfill 有必要，不能把該次耗時當作一般增量耗時。
3. 比對本機已存事件的 `(device_id, device_counter)` 和列出的 `event-index/<device>/<counter>.json`。即使連續前綴停在 counter 缺口，後面的索引也可能早已存在本機。
4. 檢查 remote marker 是否等於最後一次成功同步後持久化的 marker，以及本機 `synced_local_counter` 是否存在。

```text
index:  device A / 000000000000001.json
        device A / 000000000000003.json
local:  device A counter 1、3 都已存在
frontier: 1（counter 2 缺口）
```

只靠 `frontier` 會每次列出 counter 3；若不再按本機 counter 差集過濾，還會每次重新 GET counter 3 的 JSON。

## 根因

連續 counter 前綴只是一個快速下界，不能代表前綴以外的事件都未知。舊資料或遷移過程留下的缺口使掃描範圍長期不縮小。另一方面，完成同步時已有「本機 checkpoint 對應 remote marker」的證據，原流程仍一律列裝置 registry 和各裝置 event-index，再計算待上傳事件。

此外，已存在的 R2 bucket 與本裝置 registry 被重複確認，讓本來只有一筆 tombstone 的同步多付幾個網路往返。

## 修正

索引掃描路徑對 `(device_id, counter)` 建立本機查找表；已知 key 只用來確認遠端存在，不再下載 JSON。各裝置索引清單以有界並行讀取。

```js
const localByCounter = new Map(
  localOperations.map(op => [`${op.device_id}/${op.device_counter}`, op.event_id])
);
const unknownKeys = indexKeys.filter(key => !localByCounter.has(parseDeviceCounter(key)));
```

若 `remote_marker === checkpoint.remote_marker`，上次 checkpoint 以前的事件已完成上傳，且沒有其他裝置更新遠端狀態；此時只需找出本裝置 `device_counter > synced_local_counter` 的事件。marker 不相符、checkpoint 不完整或新裝置首次接入時，仍走索引或完整掃描，不套用快路徑。

```js
const pending = markerMatchesCompletedCheckpoint
  ? localOperations.filter(op =>
      op.device_id === identity.device_id &&
      op.device_counter > identity.synced_local_counter)
  : await compareWithRemoteIndex();
```

已確認的 bucket 不再每次重列；已完成同步的裝置不再重送 registry。事件物件寫入成功後才寫對應索引；所有待上傳事件與索引完成後才改 remote marker，最後才記本機 checkpoint。這個順序讓中斷重試可再次 PUT 不可覆寫 key，而不會先宣稱同步完成。

## 驗證

- 執行同步核心合約測試、型別檢查和 production build；合約涵蓋 marker 相符、marker 不符、checkpoint 缺失與 counter 缺口。
- 在既有 PWA 建立未公開測試草稿，確認同步成功；刪除草稿後確認 tombstone 也同步成功，最後顯示「已同步」。測試內容不發布到網站或社群。
- 單機實測快路徑的草稿同步約 10 秒內，tombstone 約 11 秒內；先前 37 秒的測試含 3 個事件，工作量不同，不能當成嚴格加速倍率。
- 兩台乾淨裝置的首次配對、圖片、雙向合併與衝突仍須另外驗證。

## 下次先查

1. 看 remote marker 與本機 checkpoint 是否相符；相符卻仍列出整批索引，先查快路徑條件。
2. marker 不符時，分別量測 registry list、index list、未知 JSON GET、媒體和 PUT；檢查 counter 缺口是否造成已知 key 重讀。
3. 首次舊空間補索引與一般增量分開計時，避免用不同工作量宣稱倍率。
4. 中斷後確認 marker 只在所有事件與索引成功寫入後改變，再驗證重試可完成。
