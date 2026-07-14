---
title: RSSHub Dcard API 被擋時改抓 JSON-LD
description: Dcard API behind Cloudflare can break RSSHub routes even when the public board page still exposes SocialMediaPosting JSON-LD.
date: 2026-07-14
tags:
  - rsshub
  - dcard
  - cloudflare
  - json-ld
  - puppeteer
status: fixed
system: rsshub
severity: medium
aliases:
  - RSSHub Dcard 503
  - Dcard SocialMediaPosting
  - Dcard JSON-LD
---

## 快速結論

RSSHub 的 Dcard route 若直接打 Dcard internal API 被 Cloudflare 擋住，可以改從公開板頁抓 `application/ld+json`，解析 `SocialMediaPosting` 產生 RSS items。

這不是一般 retry、UA、cookie 就能穩定解的問題。API path 被擋時，公開頁面仍可能能用瀏覽器載入，而且頁面內的 JSON-LD 已包含標題、連結、作者、時間與圖片。

## 症狀

RSSHub Dcard route 回 503，或 route 在本機看起來正常啟動但沒有 items。

常見線索：

```text
GET /dcard/<board> 503
Failed to fetch Dcard structured data.
```

或手動打 Dcard API 時拿到 Cloudflare / anti-bot response，而不是 JSON。

## 影響範圍

- Service：RSSHub
- Route：`/dcard/:section/:type?`
- 影響：Dcard feed 無法更新
- Data risk：無資料毀損，只是 feed 暫時不可用

## 排查

先確認 RSSHub 自身健康：

```bash
curl -fsS http://127.0.0.1:1200/healthz
```

確認 route 是否是單一路由失敗：

```bash
curl -sS -D /tmp/dcard.headers \
  'http://127.0.0.1:1200/dcard/<board>' \
  -o /tmp/dcard.xml

awk 'NR==1 {print}' /tmp/dcard.headers
```

接著分別測 API 與公開頁：

```bash
curl -L 'https://www.dcard.tw/service/api/v2/forums/<board>/posts'
curl -L 'https://www.dcard.tw/f/<board>?latest=true'
```

如果 API 被 anti-bot 擋住，但公開頁能載入，檢查頁面 HTML 內是否有 JSON-LD：

```bash
grep -o 'application/ld+json' /tmp/dcard-page.html | head
grep -o 'SocialMediaPosting' /tmp/dcard-page.html | head
```

## 根因

Dcard internal API 與公開板頁是兩個不同攻擊面。API endpoint 可能被 Cloudflare 或 anti-bot policy 直接擋掉，但公開板頁仍提供給瀏覽器載入。

公開頁內的 `application/ld+json` script 會包含 `SocialMediaPosting` objects。這些 structured data 已足夠組 RSS feed，所以 route 可以避開 API，改用瀏覽器載入公開頁並解析 JSON-LD。

## 修正

用瀏覽器載入 board page，等待 JSON-LD script 出現，再解析 `SocialMediaPosting`。

概念流程：

```ts
const html = await getPageWithBrowser(
  'https://www.dcard.tw/f/<board>?latest=true',
  'script[type="application/ld+json"]'
);

const posts = extractJsonLd(html)
  .flatMap(normalizeGraph)
  .filter((item) => item['@type'] === 'SocialMediaPosting');
```

解析時要處理幾個型態：

- JSON-LD 可能是 array。
- JSON-LD 可能放在 `@graph`。
- `image` 可能是 string、object、或 array。
- script content 可能含 HTML entities，需要先 decode。

RSS item 欄位可從 structured data 對應：

```text
headline       -> title
url            -> link/guid
text           -> description
author.name    -> author
datePublished  -> pubDate
dateModified   -> updated
image          -> img tags
```

## 驗證

先跑 build 或 route build：

```bash
pnpm build
```

如果本機 Node / dependency 狀態與 Docker 不同，至少用最終 runtime image 驗證：

```bash
docker exec rsshub curl -fsS http://localhost:1200/healthz

docker exec rsshub sh -lc '
  curl -sS -D /tmp/dcard.headers \
    "http://localhost:1200/dcard/<board>" \
    -o /tmp/dcard.xml
  awk "NR==1 {print}" /tmp/dcard.headers
  grep -o "<item>" /tmp/dcard.xml | wc -l
'
```

預期：

```text
HTTP/1.1 200 OK
items > 0
```

熱門排序也要測：

```bash
curl -sS 'http://localhost:1200/dcard/<board>/popular'
```

## 下次先查

RSSHub Dcard 失效時，不要只盯 API endpoint。

最短路徑：

1. `healthz` 確認 RSSHub 本體正常。
2. route 回 503 時看 RSSHub logs。
3. 分別測 Dcard API 與公開板頁。
4. 公開頁可載入時，先找 `application/ld+json` / `SocialMediaPosting`。
5. 如果 route 需要瀏覽器，接著檢查 Docker image 是否有 Chromium。
