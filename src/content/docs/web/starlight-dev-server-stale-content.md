---
title: Starlight dev server 舊 content store 導致 500
description: Astro/Starlight production build 通過，但背景 dev server 仍吃舊 content store，導致 sidebar slug 找不到並回 500。
date: 2026-07-14
tags:
  - astro
  - starlight
  - dev-server
  - content-collection
status: fixed
system: starlight
severity: low
aliases:
  - Astro dev server 500
  - Starlight sidebar slug
  - stale content store
---

## 快速結論

Starlight production build 已經通過，但背景 dev server 仍保留舊的 content store / sidebar state，導致新增頁面的 slug 在 dev server 裡查不到。先檢查 dev server logs；若錯誤只出現在 dev server，重啟 Astro dev server 通常就能恢復。

## 症狀

開本機預覽首頁時回 500，但 `npm run build` 可以成功產出 static site。

HTTP 檢查會看到：

```text
HTTP/1.1 500 Internal Server Error
```

dev server logs 裡的關鍵錯誤：

```text
AstroUserError: The slug `"license-ai-notice"` specified in the Starlight sidebar config does not exist.
Hint: Update the Starlight config to reference a valid entry slug in the docs content collection.
```

但 production build 的 route generation 已經看得到該頁：

```text
├─ /license-ai-notice/index.html
✓ Completed
```

## 影響範圍

- Astro dev server
- Starlight sidebar navigation
- content collection hot reload
- 本機 preview

不影響已成功產出的 `dist/`，也不代表 content collection schema 或 sidebar config 一定寫錯。

## 排查

先確認 production build 是否真的成功：

```bash
npm run build
```

如果 build 成功，再看 dev server 狀態：

```bash
npm run astro -- dev status
```

讀 dev server logs：

```bash
npm run astro -- dev logs
```

接著比對三件事：

- `src/content/docs/<slug>.md` 是否存在。
- `astro.config.mjs` sidebar 是否引用同一個 slug。
- build output 是否已產出該 route。

這次的關鍵矛盾是：build 成功，`dist/license-ai-notice/index.html` 存在，但背景 dev server 仍說 `license-ai-notice` 不存在。

## 根因

背景 dev server 在多次新增頁面、修改 sidebar、更新 config 後，沒有乾淨重載 Starlight content collection。它仍用舊 content store 判斷 sidebar slug，因此 runtime route request 回 500。

這不是 Markdown 內容錯，也不是 `astro.config.mjs` 寫錯。判斷依據是 production build 能完整通過，且 static route generation 已包含該頁。

## 修正

停止舊 dev server：

```bash
npm run astro -- dev stop
```

重新啟動：

```bash
npm run dev -- --host 127.0.0.1
```

重啟後再確認首頁和新增頁面：

```bash
curl -I http://127.0.0.1:4321/
curl -I http://127.0.0.1:4321/license-ai-notice/
```

預期結果：

```text
HTTP/1.1 200 OK
```

## 驗證

修正後做三層驗證：

```bash
npm run build
```

確認 static build 仍成功。

```bash
curl -I http://127.0.0.1:4321/
curl -I http://127.0.0.1:4321/license-ai-notice/
```

確認 dev server runtime 回 200。

```bash
curl -s http://127.0.0.1:4321/llms.txt | sed -n '1,30p'
```

確認 plugin route 也正常輸出，避免只驗 HTML 頁漏掉 generated text route。

## 下次先查

遇到 Starlight dev server 500，但 build 成功時，先不要急著改 sidebar 或移檔。

最短路徑：

1. `npm run build`
2. `npm run astro -- dev logs`
3. 比對 build routes 與 sidebar slug
4. `npm run astro -- dev stop`
5. `npm run dev -- --host 127.0.0.1`
