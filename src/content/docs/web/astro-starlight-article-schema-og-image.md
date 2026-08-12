---
title: Astro Starlight 文件站的 Article schema 與逐頁 Open Graph 圖
description: A Starlight documentation site is crawlable but its Article markup and shared social image are incomplete; emit Google-compatible Article data and prerender a representative image per page.
date: 2026-08-12
tags:
  - astro
  - starlight
  - seo
  - json-ld
  - open-graph
  - social-image
status: fixed
system: astro-starlight
severity: low
aliases:
  - Starlight SEO metadata
  - TechArticle Google Article schema
  - Open Graph per-page image
  - Twitter image alt
  - Astro static OG image
---

## 快速結論

文件站即使已經有 `robots.txt`、sitemap、canonical 與 `TechArticle` JSON-LD，仍要檢查 Google 實際支援的 Article 類型，以及每篇文章是否有能代表內容的圖片。

在 Starlight route middleware 同時輸出 `Article` 與 `TechArticle`、作者 URL、`dateModified`、Open Graph/Twitter image metadata。以 static endpoint 從 content collection 預先產生每篇標題圖，避免所有文章共用一張品牌卡。

## 症狀

全 sitemap crawl 沒有 4xx、canonical 或 description 問題，但文章 metadata 有幾個容易漏掉的點：

- JSON-LD 只有 `TechArticle`，沒有 Google 文件列出的 `Article` 類型。
- 所有文章的 `og:image` 都指向同一張網站品牌圖。
- Twitter image 使用 Open Graph 的 `property` 屬性，且沒有 image alt text。
- 作者 URL 指向站內頁面，但該頁沒有 `ProfilePage` 包裝。

這些不會阻止一般收錄，卻會降低 Article 資料、社群卡片與作者識別的一致性。

## 影響範圍

- Service：Astro + Starlight static documentation site
- 影響：Article rich result compatibility、社群分享預覽、作者實體辨識
- 資料風險：無；只改 static metadata 與產生的 PNG assets

## 排查

先從 sitemap 取出所有 URL，對每篇 HTML 檢查 status、canonical、title、description、H1 與 JSON-LD。不要只看首頁。

接著針對文章頁確認：

```text
@type contains Article
image points to a crawlable, page-specific PNG
author.url points to a real profile page
datePublished and dateModified use ISO 8601
og:image / og:image:alt are present
twitter:image / twitter:image:alt use name attributes
```

若圖片由 Astro endpoint 生成，build 後還要確認每個 HTML 引用的圖片都存在於 `dist/`，再從 production 對每個 image URL 取一次 HTTP status。

## 根因

Schema.org 的合法類型不等於 Google Article rich result 文件列出的支援類型。`TechArticle` 可保留技術語意，但單獨使用會少一層明確相容性。

共用品牌圖技術上是有效的 Open Graph asset，但不會描述每一篇 runbook 的內容。對 Article 結構化資料，圖片應代表該篇文章，而不是網站識別本身。

## 修正

在 route middleware 依文件 route 組出專屬圖片 URL，並把 `Article` 與 `TechArticle` 一起放入 JSON-LD：

```ts
const imageUrl = route.id ? `/og/${route.id}.png` : '/og.png';

'@type': ['Article', 'TechArticle'],
image: [imageUrl],
author: { '@type': 'Person', name: 'Author', url: '/about/' },
dateModified: route.lastUpdated?.toISOString(),
```

Open Graph 使用 `property`，Twitter Card metadata 使用 `name`，兩者各自補 image alt text：

```html
<meta property="og:image" content="..." />
<meta property="og:image:alt" content="Article title | Site name" />
<meta name="twitter:image" content="..." />
<meta name="twitter:image:alt" content="Article title | Site name" />
```

以 Astro catch-all endpoint 搭配 `getCollection('docs')` 與 `getStaticPaths()` 預先輸出 `/og/<slug>.png`。圖片可由 SVG 經 `sharp` 轉 PNG；長標題要以多個 `<text>` element 換行，不要依賴單一 SVG `<text>` 裡多個 `tspan` 的 renderer 行為。

站內作者頁使用 `ProfilePage`，再把 `Person` 放到 `mainEntity`：

```json
{
  "@type": "ProfilePage",
  "mainEntity": {
    "@type": "Person",
    "name": "Author",
    "url": "https://docs.example/about/"
  }
}
```

## 驗證

```bash
npm run index
npm run build
```

確認 build 有輸出文章的 `/og/<slug>.png`，再用腳本掃過 sitemap：每個頁面與其 `og:image` 都必須回 200，且所有頁面都有 image 與 alt metadata。

production 至少抽查首頁、最長標題文章、作者頁與一張 nested slug 圖片；有 CDN 時，若 HTML 已更新但 image 短暫 404，稍候重查，避免把 edge propagation 誤判成 build 漏檔。

## 下次先查

1. Crawl 全 sitemap，不只首頁。
2. 分開驗 `schema`、Open Graph、Twitter Card 與圖片 asset status。
3. 對最長的中英混排標題實際看 PNG，確認不截字、不把英文單字切半。
4. 最後用 Search Console URL Inspection 確認 Google 看到的 production 版本。
