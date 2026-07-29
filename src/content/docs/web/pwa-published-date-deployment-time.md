---
title: PWA editor 日期正確但發布後全變成今天
description: A local-first static publisher can display a default publish date without persisting it, causing a later full-site deployment to stamp every post with deployment time.
date: 2026-07-29
tags:
  - pwa
  - indexeddb
  - static-site
  - publishing
  - date
status: fixed
system: progressive-web-app
severity: medium
aliases:
  - PWA published date becomes today
  - static site deployment overwrites post dates
  - editor 顯示日期正確但發布日期錯誤
  - 短文發布後全部是今天
---

## 快速結論

若 local-first publisher 的 editor 在 `published_at` 缺值時直接顯示 `new Date()`，畫面看起來會有正確的預設日期，但資料本身沒有日期。整站輸出若再以 `new Date()` 補值，每一次發布都會把所有缺日期貼文標成部署當天。

建立貼文時就持久化 `published_at`。對已存在但缺值的資料，migration 要回填一個既有時間欄位（通常是 `updated_at`），而不是在 renderer、export 或 deployment 時補現在時間。

## 症狀

- editor 的「發佈時間」欄位顯示合理日期。
- 靜態站首頁、短文頁與 RSS 的多篇貼文卻都顯示今天。
- 重發整個網站後，舊貼文日期再次隨部署日變動。
- 文章與短文共用相同的發佈前 normalize 流程時，兩種內容都可能受影響。

## 影響範圍

- Service：IndexedDB local-first PWA，發布時產生完整 static-site snapshot。
- 觸發條件：資料模型允許 `published_at` 缺值，editor 只提供視覺預設值。
- 使用者影響：公開時間、排序、RSS `pubDate` 與社群連結脈絡錯誤。
- 資料風險：原本時間沒有獨立欄位時無法精準還原；只能選擇已保留的最接近時間。

## 排查

先比較 editor 顯示值、IndexedDB 記錄與發布器實際輸入，不要只看畫面：

```ts
function localDateTime(value?: string | null) {
  const date = value ? new Date(value) : new Date();
  return toDateTimeLocal(date);
}
```

這段只會讓 UI 看起來有日期；它不會寫入資料。接著搜尋所有發布時間 fallback：

```bash
rg -n "published_at|new Date\(\)" src/
```

特別檢查建立貼文、IndexedDB migration、發布 normalize、preview、RSS 與 export。若發布層有下列邏輯，就會覆蓋整站日期：

```ts
published_at: post.published_at || new Date().toISOString()
```

## 根因

「editor 有預設值」和「資料已持久化」是兩件事。

新貼文建立時沒有寫入 `published_at`；editor 為了呈現輸入欄位，以目前時間作為顯示 fallback。使用者不手動修改日期時，IndexedDB 記錄仍缺該欄位。發布器收到這種記錄後，又以部署當下時間補值，因此每次 full-site deployment 都改變公開時間。

## 修正

在建立資料時固定時間，並保留它於後續編輯：

```ts
const now = new Date().toISOString();

return {
  id: createId("post"),
  updated_at: now,
  published_at: now
};
```

對舊資料，在 load/migration 階段回填可追溯的時間。此例以最後更新時間為最佳可用值：

```ts
const updatedAt = String(source.updated_at || new Date().toISOString());

return {
  ...source,
  updated_at: updatedAt,
  published_at: validDate(source.published_at)
    ? source.published_at
    : updatedAt
};
```

最後讓所有輸出層使用同一條 fallback，絕不使用 deployment time：

```diff
- published_at: source.published_at || new Date().toISOString()
+ published_at: source.published_at || source.updated_at
```

同樣規則要套用到公開 renderer、RSS 與 export，避免某個輸出重新引入不一致的日期。

## 驗證

- 建立文章與短文後，不手動修改日期，直接檢查儲存記錄已有 `published_at`。
- 將舊記錄的 `published_at` 移除後重開 PWA，確認 migration 回填 `updated_at`，且不會每次載入改變。
- 連續發布兩次同一批貼文，首頁、貼文頁、RSS `pubDate` 都維持相同日期。
- 執行型別檢查、既有測試與 production build。
- 以實機開啟更新後 PWA，再按一次「更新網站」驗證既有公開內容。

## 下次先查

1. 先讀 IndexedDB 的實際 `published_at`，不要只相信 datetime input 顯示值。
2. 搜尋所有 `published_at || new Date()`；發布、RSS、export 任一處出現都可能重寫日期。
3. 沒有真正的建立時間欄位時，以既有 `updated_at` 做一次性 migration，並向使用者說明精度限制。
4. 靜態站是完整 snapshot 時，修正 PWA 不會回寫已公開內容；仍要用新版 client 重發一次網站。
