---
title: IndiePing RSS 超過 8 MiB：保留有界抓取並調整 Feed 限額
description: Feed 回 HTTP 200 卻報 Response exceeds byte limit 時，量測解碼後大小並用同一 parser 重現；只調整 RSS 額度，保留其他抓取、解壓縮與 SSRF 限制。
date: 2026-11-03
tags:
  - indieping
  - rss
  - streaming
  - response-size
status: fixed
system: indieping
severity: medium
aliases:
  - Response exceeds byte limit
  - RSS larger than 8 MiB
  - Feed HTTP 200 但掃描失敗
---

## 快速結論

這次來源 RSS 是有效 Atom，但解碼後有 8,517,887 bytes，略高於 scanner 的 8 MiB（8,388,608 bytes）限制。將 `fetchRSS` 的單次上限調為 10 MiB 後，同一份 Feed 可解析並實際掃描 171 篇。

只調整 Feed 呼叫的額度；其他 `safeFetch` 呼叫維持原本預設。不可取消大小限制，也不能改用只涵蓋英文文章的小 Feed 就宣稱完整修復。

## 症狀

首頁與 RSS 都回 HTTP 200，網站持續更新，scanner 卻累積失敗：

```text
Error: Response exceeds byte limit
```

重新探索仍會找到相同 Feed。`HEAD`、Content-Type 或探索成功不代表實際下載與解析成功。

## 影響範圍

- Node.js、TypeScript、rss-parser 與受限 HTTP transport。
- 該來源的新文章及反向連結停止更新，既有歷史資料仍保留。
- 提高限制會增加每個請求的記憶體用量；仍須保留請求併發、deadline、item 數量與位元組上限。

## 排查

1. 在 scanner 正式主機沿用現有 `fetchRSS` 重現，排除只有本機能連線的差異。
2. 檢查首頁實際宣告的 Feed。此案例另有中、英文版本：中文 Feed 仍大於 8 MiB，英文 Feed 只有部分文章。
3. 單次 probe 明確指定較大但有限的額度，量測實際 UTF-8 bytes，再用現有 RSSParser 解析。

```ts
const res = await safeFetch(confirmedFeedUrl, { maxBytes: 10 * 1024 * 1024 })
const xml = await res.text()
console.log(Buffer.byteLength(xml, 'utf8'))
const feed = await parser.parseString(xml)
console.log(feed.items.length)
```

這段是診斷用法，`confirmedFeedUrl` 必須來自實際資料庫或來源頁宣告。不要依賴 `Content-Length` 作為唯一大小檢查，壓縮與串流回應可能不反映解碼後尺寸。

## 根因

transport 正確擋下超限回應；來源 Feed 成長後略超過目前額度。它不是 DNS、XML 語法或 RSS 路徑錯誤，也沒有證據需要繞過來源驗證。

## 修正

只更改 RSS 呼叫層：

```diff
- const res = await safeFetch(rssUrl)
+ const res = await safeFetch(rssUrl, { maxBytes: 10 * 1024 * 1024 })
```

其他 transport 規則維持：一般請求預設 8 MiB，分別計算線上與解碼後 bytes，逐跳驗證公開位址、固定 socket IP、驗證 TLS、保留 deadline 與併發限制。Feed 超過 2,000 items 的既有限制也保留。

## 驗證

- 新測試以本機 fixture 驗證大於 8 MiB 的有效 RSS 可讀。
- 相同回應使用一般 `safeFetch` 仍因預設 8 MiB 而被拒絕。
- 大於 10 MiB 的純文字與 gzip 解碼內容都被拒絕，回傳空 items 與明確錯誤。
- 40 項測試與 `tsc --noEmit` 通過；本次未改前端，未重建前端。
- 正式庫副本及正式 `scanBlog` 都成功，來源共 171 篇，`consecutive_fails=0`、`rss_error=NULL`；外鍵檢查與 `quick_check` 正常。
- 服務重啟後 active，公開 health 與名單 API 正常；未做瀏覽器互動驗收。

## 下次先查

先量測解碼後大小，再分辨額度不足與無效 Feed。若來源繼續長大，評估來源提供的分頁、摘要或歷史視窗；每次都重新衡量額度，不把限額改成無限。
