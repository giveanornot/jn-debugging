---
title: RSSHub 讀政府 OpenData JSON 遺失文章段落格式
description: 某些政府 CMS 的 JSON 開放資料會把文章 HTML 壓成純文字；改讀保留轉義 HTML 的 XML，才能讓 RSS 閱讀器保有段落、清單與圖片。
date: 2026-09-02
tags:
  - rsshub
  - rss
  - opendata
  - xml
  - docker
status: fixed
system: rsshub
severity: low
aliases:
  - RSSHub OpenData XML
  - RSS description no line breaks
  - OpenData JSON HTML stripped
---

## 快速結論

政府 CMS 同一個文章分類常同時提供 JSON 與 XML 開放資料，但兩者不一定等價。若 JSON 的內文字段已經是沒有標籤與段落的純文字，RSSHub 再怎麼輸出都無法還原換行。

優先讀 XML，並用 XML parser 取出已被 entity-escape 的 HTML 內文。RSS XML 的 `<description>` 會再次轉義這些標籤，這是正常行為；閱讀器解析後才能顯示段落、清單與圖片。

## 症狀

RSS feed 有正確標題、日期與全文，但閱讀器把所有段落連成一長段：

- 清單項目沒有分行。
- 圖說與正文黏在一起。
- `<p>`、`<ul>`、`<img>` 等內容結構完全消失。

直接檢查 JSON 常會看到內文只是純文字：

```json
{
  "title": "每日天文新知彙整",
  "內容": "第一則摘要 第二則摘要 第三則摘要"
}
```

## 影響範圍

- Service：RSSHub 自訂 route
- Source：提供 JSON 與 XML 的政府 CMS OpenData endpoint
- 影響：文章可閱讀但可讀性大幅下降；圖片與清單語意可能遺失
- Data risk：無資料毀損

## 排查

先確認列表頁實際提供的每種開放資料格式，不要假設 JSON 一定最完整：

```bash
curl -fsS 'https://example.gov/OpenData.aspx?SN=<json-id>' -o /tmp/feed.json
curl -fsS 'https://example.gov/OpenData.aspx?SN=<xml-id>' -o /tmp/feed.xml
```

比較同一篇文章的內文字段：

```bash
jq -r '.[0]["內容"]' /tmp/feed.json | sed -n '1,3p'
rg -o '&lt;(p|ul|ol|li|img)\b' /tmp/feed.xml | sort | uniq -c
```

若 JSON 沒有 HTML 標籤，但 XML 仍含有 `&lt;p&gt;`、`&lt;ul&gt;` 或 `&lt;img&gt;`，根因已可確認在來源格式，不在 RSS reader。

部署前也要檢查 RSSHub 最終輸出。RSS XML 將 HTML 顯示為 `&lt;p&gt;` 是正確的序列化結果；重點是標籤仍存在：

```bash
curl -fsS 'https://rss.example.com/<route>?cache-bust=1' -o /tmp/feed.xml
rg -o '&lt;(p|ul|ol|li|img)\b' /tmp/feed.xml | sort | uniq -c
```

## 根因

JSON endpoint 不是 HTML 的無損表示。該 CMS 在產生 JSON 時先抽取內文文字，於是段落、清單、圖片與 `<br>` 都在 RSSHub 收到資料前遺失。

XML endpoint 則把完整 HTML 以 XML entity 放在內文字段中。XML parser 解碼後能得到可直接放入 RSSHub `description` 的 HTML string。

## 修正

route 改讀 XML endpoint，並以 Cheerio 的 XML mode 讀各資料列。不要以 `textContent` 或 HTML-to-text helper 再次壓平內文。

```ts
import { load } from 'cheerio';

const xml = await ofetch<string>(xmlUrl);
const $ = load(xml, { xmlMode: true });

const items = $('Data')
  .toArray()
  .map((article) => {
    const $article = $(article);
    return {
      title: $article.find('[name="title"]').text(),
      link: $article.find('[name="Source"]').text(),
      description: $article.find('[name="內容"]').text(),
      pubDate: parseDate($article.find('[name="上版日期"]').text()),
    };
  });
```

若 XML 中另有圖片 JSON 字段，可解析後放入 item 的 `image`；內文中的 `<img>` 仍應保留，讓閱讀器能在正文顯示圖片與圖說。

部署時只更新 RSSHub service，避免不必要重建相依服務：

```bash
docker build -t localhost/rsshub:<tag> .
# 先備份 compose，再將 rsshub image 指向新 tag
docker compose up -d --no-deps --force-recreate rsshub
```

## 驗證

- TypeScript syntax／type check 通過。
- XML 包含預期的段落、清單與圖片標籤。
- RSSHub container 為 `running healthy`。
- 公開 feed 回 200，且含有文章與格式化 HTML：

```text
items: 50
htmlParagraphs: > 0
htmlLists: > 0
images: > 0
```

若公開入口有快取，使用 cache-busting query 檢查新輸出；一般訂閱端則等待其既有 cache TTL 後重新整理。

## 下次先查

文章「沒有換行」時，先比較來源 JSON 與 XML 的內文字段：

1. JSON 是否已經是平面文字？
2. XML 是否仍有 `&lt;p&gt;`／`&lt;li&gt;`？
3. RSSHub route 是否用 XML mode 解析並保留 HTML？
4. 最終 feed 是否仍含 `&lt;p&gt;`？
5. 最後才排除閱讀器快取或閱讀器自身的 HTML rendering 限制。
