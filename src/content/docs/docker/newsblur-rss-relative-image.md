---
title: NewsBlur RSS 相對圖片破圖
description: feedparser used the feed URL as the base for relative images inside content:encoded, causing story images to resolve to the wrong host path.
date: 2026-07-13
tags:
  - newsblur
  - rss
  - docker
  - python
status: fixed
system: newsblur
severity: medium
aliases:
  - RSS relative image
  - feedparser base URL
related:
  - docker/newsblur-rss-relative-image
---

## 快速結論

在 feedparser 解析前，用每篇 item 的 link 作為 base，把 `content:encoded`、`description`、`summary` 裡的相對 `src` / `href` / `poster` / `srcset` 改成絕對 URL。

重點是修在「feedparser 之前」。如果等 story content 已經存進資料庫，通常只看得到錯誤絕對 URL，已經無法可靠推回原本的相對路徑。

## 症狀

自架 NewsBlur 顯示某篇文章圖片破圖。來源 feed 內圖片路徑是相對路徑，但 NewsBlur 解析成站台根目錄底下的錯誤絕對 URL，正確位置應該在文章路徑底下。

典型例子：

```html
<img src="desktop.jpg">
```

如果 feed URL 是 `https://example.com/feed.xml`，但文章 URL 是 `https://example.com/posts/desktop/`，錯誤解析會變成：

```text
https://example.com/desktop.jpg
```

實際應該依文章 URL 解析成：

```text
https://example.com/posts/desktop/desktop.jpg
```

## 影響範圍

- 服務：自架 NewsBlur
- 類型：RSS item 內容使用相對圖片路徑的 feed
- 影響：既有 story 內容與未來抓取內容都可能顯示錯誤圖片 URL

受影響的不只 `img[src]`。如果文章內有連結、影片 poster、或 `srcset`，同樣可能被錯誤 base URL 解析。

## 排查

- 檢查 item link / guid，確認文章 URL 正確。
- 檢查 `content:encoded`，確認來源 HTML 使用相對圖片路徑。
- 檢查 feedparser 行為，確認它已先用 feed URL 當 base 解析成錯誤絕對路徑。
- 檢查其他 feed，多數圖片已是絕對 URL，少數相對圖需要同類處理。

排查時先保存三份資料：

```bash
curl -L 'https://example.com/feed.xml' > /tmp/feed.xml
```

- 原始 feed 內容。
- feedparser 解析後的 entry。
- NewsBlur 儲存後的 story content。

如果原始 feed 是相對 URL，但 feedparser output 已經變成錯誤絕對 URL，就代表修正點必須提前。

## 根因

feedparser 在 NewsBlur 後處理之前已經解析相對 URL。等進到 story content processing 時，原始相對路徑資訊已遺失，所以不能只在後處理階段修。

錯誤不是「圖片 host 壞掉」，也不是「前端 lazy loading 壞掉」。真正問題是 URL base 選錯：feedparser 用 feed 文件位置當 base，但這些 HTML fragment 的合理 base 應該是該篇 item 的 link。

## 修正

在 feedparser 前處理階段，依每篇 item / entry link 改寫 HTML 欄位內的相對 URL。

處理原則：

- 已經是 `http://`、`https://`、`data:`、`mailto:` 的值不要動。
- protocol-relative URL，例如 `//cdn.example.com/a.jpg`，不要用文章 URL 重組。
- fragment-only URL，例如 `#section`，通常不應改成外部絕對 URL。
- `srcset` 要逐項處理，不能把整串當單一 URL。

需要覆蓋的屬性：

- `src`
- `href`
- `poster`
- `srcset`

需要處理的欄位：

- `description`
- `content:encoded`
- `summary`
- `content`

概念上的修正：

```python
from urllib.parse import urljoin

absolute_url = urljoin(entry_link, relative_url)
```

HTML 實作要用 parser 或 sanitizer 階段處理，不要用簡單字串 replace。

## 驗證

- 加 regression tests 覆蓋 feedparser 前處理。
- container 內跑 `py_compile`。
- 跑目標 test class，3 tests OK。
- 回填既有 story 的錯誤圖片 URL，並同步 cache。

測試案例至少要覆蓋：

- `img[src]`
- `a[href]`
- `video[poster]`
- `img[srcset]`
- 已經是絕對 URL 的欄位不變
- protocol-relative URL 不被破壞

## 下次先查

遇到 RSS 圖片路徑錯誤時，先看原始 feed item 的 `content:encoded` 與 item link，不要只看 NewsBlur 已儲存的 story content。

如果只看儲存後內容，會誤以為來源站真的輸出了錯誤絕對 URL。先比對原始 feed，才能判斷錯誤發生在抓取、解析、儲存或前端顯示哪一層。
