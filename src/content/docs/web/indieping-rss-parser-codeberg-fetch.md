---
title: IndiePing RSS parser 與 Node fetch 失敗
description: RSS 欄位型別不符或 Node fetch 逾時時，scanner 與查詢首頁的 IPv4 fallback 診斷與修法。
date: 2026-08-10
tags:
  - indieping
  - rss
  - node.js
  - sqlite
  - codeberg
  - undici
status: fixed
system: indieping
severity: medium
aliases:
  - Too few parameter values were provided
  - SQLite3 can only bind numbers strings bigints buffers and null
  - Codeberg Pages fetch failed
  - Undici IPv4 timeout
  - IndiePing query unreachable
  - RSS discovery unreachable
---

## 快速結論

IndiePing scanner 寫入新文章時，不能假設 RSS parser 的欄位一定是 SQLite 可綁定的字串；先在 RSS 邊界正規化成 `string | null`，並用具名 SQL 參數寫入。

若 Node built-in `fetch`（Undici）逾時，但 IPv4 的 `curl` 或 `https.get` 成功，對 HTTPS 的 RSS 抓取、首頁 RSS discovery 與 RSS probe 都加入強制 IPv4 的 `https.get` fallback，避免把正常網站誤判為無法連線。

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

- 使用者查詢一個 HTTPS 正常、首頁也宣告 Atom/RSS 的部落格，IndiePing 卻顯示「找不到這個網站」並回傳 `reason: "unreachable"`。同一台主機用 `curl -4` 或 `https.get({ family: 4 })` 可取得首頁與 feed。

## 影響範圍

- Service: IndiePing feed scanner 與公開查詢 API
- Environment: Node.js + `rss-parser` + `better-sqlite3`
- User-visible impact: 一個不規則 RSS item 可中止整輪掃描；特定 HTTPS 站點可能累積失敗計數、停止更新，或在使用者查詢時被誤判為無法連線，無法加入待審核名單。
- Data risk: 中；該輪後面的站點不會完成掃描，新文章或 backlink 可能延遲出現。

## 排查

先從 systemd log 確認真正拋錯的 scanner 行：

```bash
journalctl -u indieping --since '24 hours ago' --no-pager
```

比對 INSERT 欄位與傳入值，尤其是 RSS `title`、`link`、日期與內容欄位。TypeScript type assertion 不會改變 runtime value；有些 XML 結構可讓 parser 回傳物件。

這類連線問題，分別測試 DNS、curl、Node HTTPS 與 Node fetch；查詢誤判時，首頁與實際 feed 都要測：

```bash
getent ahosts example.example
curl --noproxy '*' -4 -sSIL https://example.example/
curl --noproxy '*' -4 -sSIL https://example.example/feed.xml

node - <<'NODE'
const https = require('https')
https.get('https://example.example/', { family: 4 }, (res) => {
  console.log(res.statusCode)
  res.resume()
}).on('error', console.error)
NODE

node -e "fetch('https://example.example/').catch(console.error)"
```

如果 curl 與 `https.get({ family: 4 })` 都成功、但 fetch 報 IPv4 `ETIMEDOUT`，這是 Node/Undici 的連線路徑問題，不是 RSS URL 不存在。IPv6 `ENETUNREACH` 表示主機沒有 IPv6 route，應記錄但不是唯一根因。

## 根因

有兩個獨立的邊界條件：

1. RSS 欄位在 runtime 不一定是字串。直接交給 SQLite positional bind 會變成參數數量或型別錯誤。
2. 該環境的 Node built-in fetch 無法可靠連到特定 HTTPS endpoint；同一主機的 IPv4 TLS socket 可用，因此不是 DNS、憑證或 feed 本身故障。初次修正只在已知 RSS URL 的 scanner fetch 加 fallback；查詢流程先用 fetch 抓首頁找 `<link rel="alternate">`，RSS probe 也只用 fetch HEAD，仍會在這一步誤回 `unreachable`。

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

同一個 fallback 要套用到查詢時的首頁 discovery；若一般 fetch 失敗，但 HTTPS IPv4 request 成功，就用 fallback 取得的 HTML 繼續尋找 alternate feed link。候選 feed 的 HEAD probe 也以相同方式重試，避免首頁沒有宣告 RSS 時再次誤判。

## 驗證

- `npm run build` 通過 TypeScript 與 frontend build。
- 對有問題的 RSS 呼叫 `fetchRSS()`，確認有 item 且沒有 `error`。
- 對首頁有 alternate feed link 的 HTTPS 網站執行 `discoverBlogInfo()`；正常 fetch 與強制讓 fetch 失敗的測試，都應回傳相同 RSS URL。
- 重啟服務後手動完整跑一次：

```bash
npm run scanner
```

- 確認 log 有 `[scanner] done (...)`，沒有 SQLite bind error，受影響站點的 `consecutive_fails` 回到 `0`。
- 檢查公開 health endpoint 與查詢結果仍正常。

## 下次先查

1. 先抓完整 stack trace，確認錯在 RSS parse、SQLite bind、首頁 discovery 還是已知 RSS 的 network fetch。
2. 用 `curl -4`、`https.get({ family: 4 })`、Node fetch 三者交叉比較。
3. 若只有 Node fetch 失敗，做受限於 HTTPS 的 IPv4 fallback；不要刪除站點或改判為無 RSS。
