---
title: PWA 更新後卡在載入：舊 Service Worker 與 IndexedDB 升級互相阻擋
description: A deployed PWA can fail or keep showing an old shell after a release when a browser or CDN caches service-worker files; verify the custom domain before changing app code.
date: 2026-07-22
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
  - Cloudflare Pages 手機 PWA 部署後無法載入
---

## 快速結論

PWA 發版後若仍看到舊 UI，先分開檢查四件事：正式網域是否真的已指向新 deployment、瀏覽器是否仍被舊 service worker 控制、CDN 是否快取了 `sw.js`，以及 shell 指向的 JS URL 是否仍代表相同內容。

`sw.js` 與 Workbox runtime 不應使用長效 HTTP cache。部署平台要讓這些檔案每次重新驗證（例如 `Cache-Control: no-cache`）；hashed JS/CSS 才適合長效 immutable cache。

即使 repository 已有 `_headers`，也要以正式自訂網域的實際 response header 為準。Pages deployment URL 已是新版、手機卻無法載入時，優先判定為 edge 或既有 PWA cache；不要先把它當成手機相容性或 IndexedDB bug。

如果新版同時提高 IndexedDB schema version，另一個開著的舊分頁可能持有資料庫連線，讓新版停在初始化。不要改 database 名稱或清空資料；在 database connection 加上 `onversionchange` 關閉舊連線，並在 upgrade 被阻擋時明確提示使用者關閉其他分頁後重整。

## 症狀

- Pages deployment 已成功，新 deployment URL 有新版本檔案，但自訂網域或既有安裝 PWA 短暫仍回舊 shell。
- 新 deployment 的 `sw.js` 已回傳 `Cache-Control: no-cache`，但自訂網域仍可能暫時回傳舊的長效 cache header，表示 CDN edge 或既有 browser cache 尚未更新。
- 舊 HTML shell 仍引用 `app.js?v=舊版`，但開發伺服器或 CDN 已在同一個 URL 回傳新的 JS；新 JS 尋找新版 DOM 節點時出現 `Cannot set properties of null` 或類似錯誤。
- 首次開啟新版時，畫面結構已更新，但內容庫空白、草稿區長時間顯示載入中。
- 瀏覽器沒有可用的 application error；`indexedDB.open()` 的 upgrade request 持續等待。

## 影響範圍

- Service：使用 service worker、IndexedDB 的 static PWA
- 觸發條件：cache-first shell 在新舊 app 交替時仍存在；可能再加上 IndexedDB schema 升級
- 使用者影響：新版暫時不可編輯；既有草稿與媒體不會遺失
- 資料風險：低；不要用改 DB 名稱、刪 DB 或清 site data 當修法

## 排查

先直接讀正式網域與新 deployment URL，確認問題是 deployment alias、HTTP cache，還是 service worker cache：

```bash
curl -s https://example.com/ | rg 'src/app\\.js\\?v='
curl -s https://example.pages.dev/ | rg 'src/app\\.js\\?v='
curl -sI https://example.com/sw.js
curl -sI https://example.pages.dev/sw.js
```

若重新整理後新 UI 已出現，但本機資料沒有完成初始化，檢查這次是否改了資料庫版本或新增 object store。特別留意：舊分頁沒有處理 `versionchange` 時，新分頁的 `indexedDB.open(name, nextVersion)` 不會自行失敗，也不會完成。

## 根因

這是兩個獨立快取／連線層，實務上也可能再加上一個 asset version 誤配：

1. 舊 service worker 的 cache-first 策略先回傳舊 app shell；若 `sw.js` 被瀏覽器或 CDN 用長效 HTTP cache 保存，瀏覽器甚至不會及時取回新版 worker。
2. 新 app shell 成功載入後，IndexedDB schema upgrade 被舊分頁持有的資料庫連線阻擋。原本的 open request 沒有 `onblocked`，所以 UI 留在無限載入狀態。
3. 把 query string 當版本號但允許同一個 URL 的內容被覆寫時，舊 shell 可取得語意上較新的 JS。HTML 與 JS 的 DOM contract 不一致，會直接在初始化或操作事件中失敗；這和 IndexedDB 無關。

## 修正

每次 release 同步變更 app asset query、service worker cache name 與 shell 清單；保留 `skipWaiting()` 與 `clients.claim()`，並讓使用者第一次重整取得新 worker。asset URL 必須是不可變版本：改檔時要同時換 URL，不能讓舊 query URL 被伺服器回傳新內容。

在 static hosting 專案加入 service worker 專用 headers，避免把 worker 與 Workbox runtime 當一般靜態 asset 長效快取：

```text
/sw.js
  Cache-Control: no-cache

/workbox-*.js
  Cache-Control: no-cache
```

部署後要分別檢查新 deployment 與自訂網域的 response headers。前者正確、後者仍舊時，不要誤判為前端 build 問題；等待 edge cache revalidate，或依平台權限針對 `sw.js` 做精準 purge，再以既有 PWA client 驗證。

手機回報「載不出來」時，先請使用者完全關閉已安裝的 PWA 或瀏覽器分頁再重開；若恢復正常，就把它記為 cache 命中，而不是額外修改初始化程式。

最小驗證是檢查 HTML 引用與預快取清單完全一致：

```text
index.html  → app.js?v=30
sw.js shell → app.js?v=30
```

若兩者不一致，先修版本對應並取得新 shell，再判斷是否真有 IndexedDB upgrade 問題。

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
- `sw.js` 和 `workbox-*.js` 回應 `Cache-Control: no-cache` 或等效的每次驗證策略；兩個 origin 的 header 一致。
- `sw.js` 的 cache name、`index.html` 的 app URL、預快取 shell 版本一致。
- 舊 shell 要求的 asset URL 不會被回傳不同版本的 JS；重新整理後不再有缺少 DOM 節點的 initialization error。
- 全新 origin 可建立空白草稿並完成 IndexedDB 初始化。
- 兩個分頁使用不同 schema version 時，舊分頁收到更新通知並關閉資料庫；新分頁若仍被阻擋，顯示關閉其他分頁後重整的提示，而非無限載入。
- 既有草稿、媒體與設定在 schema upgrade 後仍存在。

## 下次先查

1. 先用 `curl -I` 比對自訂網域與最新 deployment URL 的 `sw.js` cache header，再比對 HTML asset URL。
2. 若只有自訂網域還是舊 header，先等 edge revalidate 或做精準 purge；不要先改前端程式。
3. 確認舊 asset URL 沒有被覆寫成新內容；版本不一致先修這層。
4. 請手機使用者完全關閉已安裝 PWA 或瀏覽器分頁後再開，讓 browser 完成 service worker update。
5. 新 UI 卡在本機載入時，才看 IndexedDB version upgrade 是否被其他分頁阻擋。
6. 優先加 `onversionchange` / `onblocked`；不要清使用者資料來解除問題。
