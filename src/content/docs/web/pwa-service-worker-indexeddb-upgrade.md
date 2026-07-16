---
title: PWA 更新後卡在載入：舊 Service Worker 與 IndexedDB 升級互相阻擋
description: A deployed PWA serves an old shell or stays on “loading local drafts” when a stale service worker cache and another tab’s IndexedDB connection delay an application upgrade.
date: 2026-07-16
tags:
  - pwa
  - service-worker
  - indexeddb
  - cache
  - cloudflare-pages
status: fixed
system: progressive-web-app
severity: medium
aliases:
  - PWA update stuck loading IndexedDB
  - service worker stale app shell
  - IndexedDB versionchange blocked
  - PWA 舊版快取
---

## 快速結論

PWA 發版後若仍看到舊 UI，先分開檢查兩件事：正式網域是否真的已指向新 deployment，以及舊 service worker 是否仍回應舊 app shell。

如果新版同時提高 IndexedDB schema version，另一個開著的舊分頁可能持有資料庫連線，讓新版停在初始化。不要改 database 名稱或清空資料；在 database connection 加上 `onversionchange` 關閉舊連線，並在 upgrade 被阻擋時明確提示使用者關閉其他分頁後重整。

## 症狀

- Pages deployment 已成功，新 deployment URL 有新版本檔案，但自訂網域短暫仍回舊 shell。
- 首次開啟新版時，畫面結構已更新，但內容庫空白、草稿區長時間顯示載入中。
- 瀏覽器沒有可用的 application error；`indexedDB.open()` 的 upgrade request 持續等待。

## 影響範圍

- Service：使用 service worker、IndexedDB 的 static PWA
- 觸發條件：新舊 app 同時開啟，且新版本升級 IndexedDB schema
- 使用者影響：新版暫時不可編輯；既有草稿與媒體不會遺失
- 資料風險：低；不要用改 DB 名稱、刪 DB 或清 site data 當修法

## 排查

先直接讀正式網域與新 deployment URL，確認問題是 deployment alias、HTTP cache，還是 service worker cache：

```bash
curl -s https://example.com/ | rg 'src/app\\.js\\?v='
curl -s https://example.pages.dev/ | rg 'src/app\\.js\\?v='
curl -s https://example.com/sw.js | sed -n '1,3p'
```

若重新整理後新 UI 已出現，但本機資料沒有完成初始化，檢查這次是否改了資料庫版本或新增 object store。特別留意：舊分頁沒有處理 `versionchange` 時，新分頁的 `indexedDB.open(name, nextVersion)` 不會自行失敗，也不會完成。

## 根因

這是兩個獨立快取／連線層疊加：

1. 舊 service worker 的 cache-first 策略先回傳舊 app shell；新版 worker 在檢查與 activate 後才接手。
2. 新 app shell 成功載入後，IndexedDB schema upgrade 被舊分頁持有的資料庫連線阻擋。原本的 open request 沒有 `onblocked`，所以 UI 留在無限載入狀態。

## 修正

每次 release 同步變更 app asset query、service worker cache name 與 shell 清單；保留 `skipWaiting()` 與 `clients.claim()`，並讓使用者第一次重整取得新 worker。

資料庫層要同時處理 `onblocked` 和 `onversionchange`：

```js
const request = indexedDB.open(DB_NAME, DB_VERSION);

request.onblocked = () => {
  reject(new Error("資料庫正在被另一個舊版分頁使用；關閉其他分頁後重新整理。"));
};

request.onsuccess = () => {
  const database = request.result;
  database.onversionchange = () => {
    database.close();
    showUpdateNotice();
  };
};
```

將這段包在回傳 Promise 的資料庫開啟函式裡，讓 `reject` 回到啟動流程並顯示可操作的訊息。舊版連線關閉後，使用者重新整理就能完成既有資料庫的 schema upgrade。

## 驗證

- 自訂網域與最新 deployment URL 都回傳同一個 app asset version。
- `sw.js` 的 cache name、`index.html` 的 app URL、預快取 shell 版本一致。
- 全新 origin 可建立空白草稿並完成 IndexedDB 初始化。
- 兩個分頁使用不同 schema version 時，舊分頁收到更新通知並關閉資料庫；新分頁若仍被阻擋，顯示關閉其他分頁後重整的提示，而非無限載入。
- 既有草稿、媒體與設定在 schema upgrade 後仍存在。

## 下次先查

1. 先用 `curl` 比對自訂網域、最新 deployment URL 與 `sw.js` 的版本。
2. 重整一次，讓 browser 完成 service worker update。
3. 新 UI 卡在本機載入時，先看 IndexedDB version upgrade 是否被其他分頁阻擋。
4. 優先加 `onversionchange` / `onblocked`；不要清使用者資料來解除問題。
