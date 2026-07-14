---
title: Hugo Stack v4 Gallery 初始化錯誤
description: Stack v4 gallery.ts 改成 function export 後，舊呼叫方式會讓 gallery client-side 初始化失敗。
date: 2026-05-07
tags:
  - hugo
  - stack
  - javascript
  - gallery
status: fixed
system: personal-blog
severity: medium
aliases:
  - StackGallery
  - hugo-theme-stack v4
---

## 快速結論

Stack v4 的 `gallery.ts` 是 function export，不再用 `new StackGallery(container)`，要改成直接呼叫 `StackGallery(container)`。

這類 theme 升級問題不能只看 Hugo build；JS 初始化方式改掉時，HTML 可能正常輸出，但瀏覽器端互動功能不會動。

## 症狀

Hugo build 可能通過，但瀏覽器端 gallery 沒有正常初始化。只用 `curl` 看 HTML 會漏掉這類 client-side 問題。

可見症狀：

- gallery 圖片有出現在文章 HTML。
- caption 或 lightbox 行為沒有正常套用。
- browser console 可能出現 constructor/function 類型錯誤。
- `hugo --panicOnWarning` 通過，但頁面互動仍壞。

## 影響範圍

- Hugo
- hugo-theme-stack v4
- Gallery / image caption
- 前端 JS bundle

只影響使用 theme gallery 初始化的文章。純 Markdown 圖片或沒有 gallery 的文章通常不受影響。

## 排查

- diff theme v3 / v4 的 `gallery.ts`。
- 檢查 export 型態。
- 開瀏覽器實際進有 gallery 的文章驗證 DOM 與互動。

先找專案內是否有覆寫或自訂呼叫端：

```bash
rg -n "StackGallery|gallery" assets layouts
```

再比較 theme module 內的 export：

```bash
rg -n "export.*StackGallery|function StackGallery|class StackGallery" ~/.cache/hugo_cache
```

如果 theme 從 class 變成 function，舊呼叫端用 `new` 就會壞。

## 根因

theme 升級後，呼叫端仍沿用 class constructor 寫法，但新版本 export 已改成 function。

這不是 Hugo template lookup 問題，也不是 Markdown render hook 問題。根因在 client-side JS API changed。

## 修正

把 gallery 初始化改成直接呼叫 function。

```js
StackGallery(container);
```

舊寫法通常像這樣：

```js
new StackGallery(container);
```

如果專案有 bundler 或 TypeScript，修改後要重新跑前端 build，而不只是重跑 Hugo。

## 驗證

- Hugo build 通過。
- 瀏覽器打開有 gallery 的文章。
- 確認 gallery DOM、caption、點擊互動都正常。

驗證不能只靠：

```bash
hugo --panicOnWarning
```

還要實際開瀏覽器確認 JS 跑完後的 DOM 和互動。若使用 screenshot 或 browser automation，至少檢查有 gallery 的文章而不是首頁。

## 下次先查

升級 theme 前，先 diff client-side TS/JS 檔，尤其是 gallery、color scheme、search 這類初始化入口。

另外也要掃 project-level override。SCSS partial、JS entry、shortcode 或 partial override 都可能完整取代 theme 新版檔案，造成升級後新 class 或新 init 參數沒有進來。
