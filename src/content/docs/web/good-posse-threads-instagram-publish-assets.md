---
title: Good POSSE 發送 Threads／Instagram 時找不到資源或拒絕圖卡 JPEG
description: A local-first social publisher can fail at real delivery when its Threads relay uses the retired Graph host or its Instagram asset allowlist omits the generated share-card JPEG.
date: 2026-08-16
tags:
  - good-posse
  - threads
  - instagram
  - cloudflare-worker
  - syndication
  - static-assets
status: fixed
system: social-publishing
severity: medium
aliases:
  - The requested resource does not exist
  - media.url must be a public Good POSSE Instagram JPEG asset
  - Threads graph.threads.com publish failure
  - Instagram share-card JPEG allowlist
---

## 快速結論

社群連接成功不代表實際發文可用。兩個容易在首次發文才暴露的 relay 問題是：

1. Threads 發文端點必須使用 `graph.threads.net`；舊的 `graph.threads.com` 可能回 `The requested resource does not exist`。
2. 如果 PWA 以產生的分享圖卡作為 Instagram 圖片，relay 的固定 URL allowlist 必須同時接受原圖衍生的 `instagram.jpg` 與圖卡的 `instagram-share-card.jpg`。

修正 relay 後，重新發布靜態網站以產生本次可公開存取的 JPEG，再由使用者確認重送；不要自動重送失敗收據。

## 症狀

在已完成 OAuth、已選擇同步目的地後，確認送出時顯示：

```text
Threads: The requested resource does not exist
Instagram: media.url must be a public Good POSSE Instagram JPEG asset.
```

前者由 Threads 上游回傳；後者是本地 relay 在將請求送到 Meta 前拒絕。

## 影響範圍

- Service：以 Cloudflare Worker relay 連接 Threads 與 Instagram 的 local-first PWA。
- 使用者影響：已發布的內容無法完成社群同步；本機貼文、可攜匯出與網站本身不受影響。
- 資料風險：低。發送前的已知失敗應記為 `failed`，不可當作結果不明而自動重送。

## 排查

先區分錯誤來源。固定 URL schema 的錯誤通常是 relay input validation；上游的資源不存在則要比對目前官方 host 與 endpoint。

```bash
rg -n 'THREADS_AUTHORITY|instagram-share-card|validateInstagramMedia' relay/src/index.js
```

Threads 的 container 建立與最終發布都必須走同一個官方 API host：

```text
POST https://graph.threads.net/v1.0/<threads-user-id>/threads
POST https://graph.threads.net/v1.0/<threads-user-id>/threads_publish
```

再比對 PWA 在同步確認時產生的公開圖片路徑與 Worker allowlist。例如，原圖衍生檔與文字圖卡是兩種合法的 release-only 資產：

```text
/assets/<media-id>/instagram.jpg
/assets/<post-id>/instagram-share-card.jpg
```

最後檢查這篇內容是否已在本次網站發布前選為 Instagram 目的地。圖卡只存在於該次靜態 release，不能把尚未發布或過去 release 沒產生的檔案當成可送出的媒體。

## 根因

Threads 的 OAuth、profile lookup 與發文可各自成功或失敗；使用舊 Graph host 時，連接流程未必立即暴露問題，最終寫入 container／publish 才可能被上游視為不存在的資源。

Instagram relay 故意不接受任意外部圖片 URL，以避免變成通用 proxy。新增分享圖卡後，PWA 正確產生了新檔名，但 relay 的正規表示式仍只接受舊的 `instagram.jpg`，兩端契約不同步。

## 修正

將 Threads host 換成目前發布 API 使用的 host：

```diff
-const THREADS_AUTHORITY = "https://graph.threads.com";
+const THREADS_AUTHORITY = "https://graph.threads.net";
```

保留 Instagram 的固定資產邊界，但將圖卡列為第二個明確允許的檔名：

```diff
-/assets/<id>/instagram.jpg
+/assets/<id>/(instagram|instagram-share-card).jpg
```

補兩層測試：PWA core contract 驗證圖卡 URL 與發文計畫；Worker contract 驗證 relay 接受圖卡 URL、仍拒絕任意外部 URL。然後只部署 relay；不主動重新發文。

## 驗證

```bash
cd poc
npm run check && npm test && npm run build

cd ../relay
npx wrangler deploy
```

- 以允許的 Origin 呼叫 Threads 與 Instagram connector config，確認 Worker 可回應且不洩漏 secret。
- 重新發布包含該社群目的地的靜態網站，讓 release 產生對應 JPEG。
- 在同步確認頁手動重送；Instagram 圖卡選「分享圖卡（單張）」。
- 只有收到平台確認的發文 ID 才記為 `published`；final publish 網路歧義才標為 `unknown`。

## 下次先查

1. 先看錯誤來自 relay validation 還是上游平台。
2. Threads 實際發文先核對 `graph.threads.net`，不要只因 OAuth 成功就假定 publish host 正確。
3. 新增任何 release-only 社群圖片時，同時更新 PWA URL helper、靜態輸出、relay allowlist 與契約測試。
4. 重新發布生成資產後，再由使用者確認重送。
