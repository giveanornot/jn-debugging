---
title: IndiePing scanner 因 RSS 欄位型別與 Codeberg fetch 失敗
description: RSS parser 回傳非字串欄位，或 Node fetch 無法連到 Codeberg Pages 時，scanner 的診斷與 IPv4 fallback 修法。
date: 2026-08-10
tags:
  - indieping
  - rss
  - node.js
  - sqlite
  - codeberg
status: fixed
system: indieping
severity: medium
aliases:
  - Too few parameter values were provided
  - SQLite3 can only bind numbers strings bigints buffers and null
  - Codeberg Pages fetch failed
  - Undici IPv4 timeout
---

## 快速結論

IndiePing scanner 寫入新文章時，不能假設 RSS parser 的欄位一定是 SQLite 可綁定的字串；先在 RSS 邊界正規化成 `string | null`，並用具名 SQL 參數寫入。

若 Node built-in `fetch`（Undici）對 Codeberg Pages 逾時，但 IPv4 的 `curl` 或 `https.get` 成功，對 HTTPS RSS 加入強制 IPv4 的 `https.get` fallback，不要將該站誤判成 feed 失效。

## 症狀

- scanner 在處理後段的新文章時中止，先出現：

```text
RangeError: Too few parameter values were provided
```

- 改用具名參數後，錯誤變得可辨識：

```text
TypeError: SQLite3 can only bind numbers, strings, bigints, buffers, and null
```

- 某個 Codeberg Pages RSS 在 scanner 中重複失敗：

```text
TypeError: fetch failed
cause: AggregateError [ETIMEDOUT]
```

## 影響範圍

- Service: IndiePing feed scanner
- Environment: Node.js + `rss-parser` + `better-sqlite3`
- User-visible impact: 一個不規則 RSS item 可中止整輪掃描；Codeberg Pages 站點會累積失敗計數、停止更新。
- Data risk: 中；該輪後面的站點不會完成掃描，新文章或 backlink 可能延遲出現。

## 排查

先從 systemd log 確認真正拋錯的 scanner 行：

```bash
journalctl -u indieping --since '24 hours ago' --no-pager
```

比對 INSERT 欄位與傳入值，尤其是 RSS `title`、`link`、日期與內容欄位。TypeScript type assertion 不會改變 runtime value；有些 XML 結構可讓 parser 回傳物件。

Codeberg Pages 類型的連線問題，分別測試 DNS、curl、Node HTTPS 與 Node fetch：

```bash
getent ahosts example.codeberg.page
curl --noproxy '*' -4 -sSIL https://example.codeberg.page/index.xml

node - <<'NODE'
const https = require('https')
https.get('https://example.codeberg.page/index.xml', { family: 4 }, (res) => {
  console.log(res.statusCode)
  res.resume()
}).on('error', console.error)
NODE

node -e "fetch('https://example.codeberg.page/index.xml').catch(console.error)"
```

如果 curl 與 `https.get({ family: 4 })` 都成功、但 fetch 報 IPv4 `ETIMEDOUT`，這是 Node/Undici 的連線路徑問題，不是 RSS URL 不存在。IPv6 `ENETUNREACH` 表示主機沒有 IPv6 route，應記錄但不是唯一根因。

## 根因

有兩個獨立的邊界條件：

1. RSS 欄位在 runtime 不一定是字串。直接交給 SQLite positional bind 會變成參數數量或型別錯誤。
2. 該環境的 Node built-in fetch 無法可靠連到特定 Codeberg Pages endpoint；同一主機的 IPv4 TLS socket 可用，因此不是 DNS、憑證或 feed 本身故障。

## 修正

RSS 欄位先安全轉為字串或 `null`。遇到無法字串化的物件，視為空值，讓 RSS item 繼續走既有的缺內容 fallback：

```ts
function asText(value: unknown): string {
  if (typeof value === 'string') return value
  if (value == null) return ''
  try { return String(value) } catch { return '' }
}
```

新文章 INSERT 改用具名參數，讓 SQL 欄位與值有清楚對應：

```ts
db.prepare(`INSERT INTO posts (...)
  VALUES (@blogId, @url, @title, @publishedAt, @scannedAt, @contentHash, @contentSource)`)
  .run({ blogId, url, title, publishedAt, scannedAt, contentHash, contentSource })
```

對 HTTPS RSS，保留原本 `fetch`；僅在它拋連線錯誤時，以 `https.get` 的 `family: 4` 重試。HTTP status 非 2xx 則仍回傳原本的 HTTP 錯誤，不把 404 或 500 當成 transport failure。

## 驗證

- `npm run build` 通過 TypeScript 與 frontend build。
- 對有問題的 RSS 呼叫 `fetchRSS()`，確認有 item 且沒有 `error`。
- 重啟服務後手動完整跑一次：

```bash
npm run scanner
```

- 確認 log 有 `[scanner] done (...)`，沒有 SQLite bind error，受影響站點的 `consecutive_fails` 回到 `0`。
- 檢查公開 health endpoint 與查詢結果仍正常。

## 下次先查

1. 先抓完整 stack trace，確認錯在 RSS parse、SQLite bind 還是 network fetch。
2. 用 `curl -4`、`https.get({ family: 4 })`、Node fetch 三者交叉比較。
3. 若只有 Node fetch 失敗，做受限於 HTTPS 的 IPv4 fallback；不要刪除站點或改判為無 RSS。
