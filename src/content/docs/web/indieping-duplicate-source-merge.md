---
title: IndiePing 同一篇反向連結重複：來源合併與收錄防重
description: 新舊網域共用 RSS 卻各自收錄時，先確認來源身分，再以交易合併歷史文章、連結與通知識別碼，並在核准與掃描入口防止重複。
date: 2026-10-24
tags:
  - indieping
  - rss
  - sqlite
  - domain-alias
  - deduplication
status: fixed
system: indieping
severity: medium
aliases:
  - duplicate backlink rows
  - same RSS registered twice
  - IDNA duplicate blog
  - 重複收錄新舊網域
  - 保留 Feed GUID 合併文章
---

## 快速結論

同篇文章出現兩列，先比對 API 的 `post_id` 與來源部落格；若新舊網域各建立一份來源，前端依文章 ID 分組就會如實顯示兩列。修正要合併已確認同站的來源與歷史資料，再攔截重複核准、匯入及 RSS 修改。

不要把文章 URL 恢復成跨來源全域唯一：不同站的轉載仍需隔離，否則先寫入的來源可能搶占真正作者的文章。也不能只加別名而留下兩份獨立來源繼續掃描。

## 症狀

- 標題、來源名稱、文章網址、引用文字與日期都相同，但 API 回傳不同 `post_id`。
- 兩筆來源分別使用舊網域與新網域；舊首頁已轉址，新舊資料仍各自掃描。
- 中文網域與 Punycode 拼法各建一筆資料，或託管平台網址和自訂網域都被收錄。

## 影響範圍

- 環境：Node.js、Hono、Vue、SQLite 的反向連結監控服務。
- 影響：查詢重複、掃描成本增加，同一個事件可能發出兩份 RSS 通知。
- 資料風險：直接刪除舊來源會丟失新 RSS 已不再包含的歷史文章；重算通知 GUID 會讓舊通知重新出現。

## 排查

先查正式 API，再以唯讀連線的一致性快照盤點資料。在備份副本執行以下查詢：

```sql
SELECT p.url, COUNT(DISTINCT p.blog_id) AS source_count,
       GROUP_CONCAT(DISTINCT b.domain) AS sources
FROM posts p JOIN blogs b ON b.id = p.blog_id
WHERE p.url LIKE 'http%'
GROUP BY p.url
HAVING COUNT(DISTINCT p.blog_id) > 1;

SELECT rss_url, COUNT(*) AS source_count,
       GROUP_CONCAT(domain) AS domains
FROM blogs GROUP BY rss_url HAVING COUNT(*) > 1;
```

查詢只產生候選，不能直接自動合併。接著核對首頁 HTTP 轉址、`canonical`、HTML refresh、最終 RSS 網址與歷史文章路徑。網域用 URL parser 做 IDNA 正規化，Feed 比對去除空白、片段及既定的 `www` 變體。

同內容 hash、同作者名稱或同標題也只能輔助判斷：同作者可能維護不同分站，聚合站可能包含另一個站的文章，而兩站的 `/about/` 相對路徑相同不代表同站。無法連線的舊站要用足夠的歷史對應資料判斷，保留證據不足的候選。

## 根因

來源原本主要以輸入網域區分，沒有在所有寫入入口一致檢查正規化網域、最終轉址與 RSS 身分。新舊來源因此各自建立合法的 `(blog_id, url)` 文章紀錄；這是來源重複，不是前端多 render 一次。

既有別名操作適用尚未獨立收錄的網域，無法處理已累積文章與連結的兩個來源。只提供前端確認視窗，也不能阻擋直接呼叫 API 或並行匯入。

## 修正

資料層以一筆交易處理已確認的來源合併：

1. 核對來源與保留站雙方的 revision，拒絕過期操作。
2. 先凍結既有 Feed GUID；先處理目前 500-link 視窗，再補存較舊項目，避免去重後舊項目重新進入視窗時換身分。
3. 只在本次確認同站的來源範圍內，比對正式網域與別名的等價文章 URL。保留獨有舊文，重複文章合併至一個文章 ID。
4. 合併重複文章的相同目標連結，保留最早 `first_seen_at`、最晚 `last_seen_at` 及留下的原始目標網址與 context。
5. 搬移既有別名，將舊來源網域改為別名，完成外鍵檢查後提交。

同一事件原本有兩個 GUID 時，去重後保留其中一個既有 GUID；不要求被移除的重複通知仍各占一個項目。保留站原有的目標 Feed 身分優先延續。

程式層在核准、匯入與 RSS 修改時檢查來源身分；衝突回 `409 duplicate_source`，附可人工確認的候選。外連驗證後，在寫入交易內重查；`rss_identity` 唯一索引負責攔住並行衝突。

掃描器登記最終 RSS 網址。如果與另一來源重複，停止該次文章寫入並記錄 `source_conflicts`，在管理頁提示處理。它不依 Feed 裡的文章 URL 自動替來源分配擁有權。

回退需先停服務，保留回退前資料庫，再同步還原切換前 SQLite、runtime 與前端產物；只還原程式不會撤銷合併。

## 驗證

- 39 項回歸測試、TypeScript 與前端建置通過；涵蓋交易回滾、過期版本、IDNA、合併、RSS 身分衝突與既有來源隔離。
- 正式庫副本與實際切換前備份都驗證文章 ID 映射、保留連結的 context／文字位元組、發現時間、外鍵及 `quick_check`。
- 本次 15 組同站合併後，來源從 324 降至 308，去除 1,345 筆重複文章；保留的 4,548 個已發布通知項目沿用既有 GUID。
- 原始失敗案例由兩列變一列；對該來源實際重掃前後均為 811 篇，沒有重新產生重複文章。
- 正式 query/check、別名 Feed 308 與管理驗證正常。本輪沒有可用瀏覽器連線，未做互動 UI 驗收。

## 下次先查

1. 兩列的文章 URL、`post_id` 和來源 `blog_id` 是否相同？
2. 新舊首頁是否轉址、共用 canonical 或最終 RSS？有沒有 IDNA 拼法重複？
3. 合併會不會丟掉獨有舊文、原始目標或最早發現時間？保留的 GUID 是否都能對上舊通知？
4. 核准、匯入、修改和掃描是否都經過後端檢查，並在網路驗證後重查並行狀態？
