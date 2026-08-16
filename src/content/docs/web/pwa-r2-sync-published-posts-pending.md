---
title: R2 同步後，已發布貼文全變成待公開
description: A local-first publisher can lose device-local publication evidence during cross-device sync and incorrectly mark every already-live post as pending.
date: 2026-08-16
tags:
  - pwa
  - r2
  - indexeddb
  - sync
  - publishing
status: fixed
system: local-first-static-publisher
severity: medium
aliases:
  - R2 sync marks all published posts pending
  - 已發布內容同步後全部待公開
  - release report site published state
---

## 快速結論

跨裝置同步不應複製某台裝置的本機 `site_published` 狀態；但收到與目前來源完全相符的可攜 release report 時，新裝置仍需在本機補上「這個快照已上站」的證據。否則 UI 只看到缺少本機快照，會把所有公開內容誤判為待公開。

用來源指紋比對 release report。相符時只在本機 materialize 已發布快照與網站發布回條，不寫入新的同步事件，也不宣稱這台裝置執行過部署。

## 症狀

- 裝置 A 已成功發布靜態網站並完成 R2 同步。
- 裝置 B 合併同一份內容後，整批公開貼文都顯示「待公開」。
- 貼文本身沒有改動，公開網站仍正常；但再次發布可能把所有內容誤帶進社群同步確認。

## 影響範圍

- Service：IndexedDB local-first PWA，使用 append-only R2 operations 跨裝置同步。
- 觸發條件：發布證據刻意是 device-local，但同步完成後沒有從可攜 release report 重建本機證據。
- 使用者影響：網站狀態誤導，且可能在後續發佈時把整批舊文列為待同步。
- 資料風險：原始內容不會遺失；風險在錯誤的發佈／社群送出判定。

## 排查

先分開檢查「內容已同步」和「這台裝置知道它已發布」：

```ts
function postNeedsSitePublish(post) {
  if (post.status !== "published") return false;
  if (post.site_published !== true || !post.last_published) return true;
  return JSON.stringify(siteSnapshot(post))
    !== JSON.stringify(siteSnapshot(post.last_published));
}
```

若裝置 B 的貼文內容正確、卻缺 `site_published` 或 `last_published`，問題不是內容 merge。接著檢查同步投影是否刻意移除了本機發布欄位，以及是否存在內容指紋相符的 release report：

```text
source fingerprint of current posts + site profile
==
source_fingerprint in a successful portable release report
```

這個相等比對必須涵蓋網站設定與公開內容；只按貼文 ID 或發布時間比對，可能把不同版本錯認為已上站。

## 根因

`site_published` 和最近一次公開快照屬於裝置本機的觀察結果，不能直接放入跨裝置的內容事件。同步層正確地排除了它們，但 UI 又把它們當成唯一的已發布證據。

成功部署留下的 release report 已經可攜，卻只用於顯示整體摘要，沒有被用來在新裝置重建本機證據。因此內容相同的新裝置看起來像從未發布。

## 修正

保留同步事件的可攜性，但在載入與完整同步後執行本機 reconciliation：

```ts
if (releaseReport.source_fingerprint === currentSourceFingerprint) {
  await store.recordKnownPublishedPosts(currentPublishedPosts);
  await store.recordKnownSitePublication(currentSite, releaseReport);
}
```

這兩個寫入只能更新 IndexedDB 的本機 metadata：

- 對每篇相符公開貼文寫入其當前 published snapshot 與 `site_published: true`。
- 寫入對應的網站發布回條，供網站設定狀態使用。
- 不建立 R2 operation、不回傳到其他裝置，也不說明本機執行過部署。

同步投影若要保留既有裝置的本機證據，也只可從同一個裝置原紀錄帶回：

```ts
if (typeof original?.site_published === "boolean") {
  incoming.site_published = original.site_published;
}
```

這避免一次 sync reload 不必要地抹除已知的本機狀態；是否能補新證據仍由嚴格的 release-report 指紋比對決定。

## 驗證

- 執行型別檢查、同步核心合約測試與 production build。
- 在第二台乾淨 PWA 載入相同 R2 資料，確認相符 release report 會讓舊文不再整批顯示待公開。
- 只修改其中一篇已發布貼文，確認只有那篇重新標為待公開。
- 不按社群送出按鈕驗收前，先確認同步沒有建立新的 R2 event。
- 發布 PWA 後，以正式網域確認最新 bundle 已提供。

## 下次先查

1. 先比對貼文內容與公開快照，確認是內容衝突還是本機發布證據缺失。
2. 檢查可攜 release report 是否存在，且 source fingerprint 是否精確相符。
3. 缺證據時只做本機 hydration；不要把 `site_published` 直接同步成全域欄位。
4. 發布前確認待發布清單；若同步後突然整批待公開，先停止社群確認流程。
