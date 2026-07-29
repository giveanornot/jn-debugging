---
title: Hugo Stack 在停用 JavaScript 時保留手機導覽與基本功能
description: Hugo Stack 的手機選單預設隱藏且依賴 JavaScript 展開；以 no-js 初始狀態和 HTML fallback 保留可用導覽。
date: 2026-07-29
tags:
  - hugo
  - stack
  - javascript
  - progressive-enhancement
  - accessibility
status: fixed
system: static-site
severity: medium
aliases:
  - Hugo no JavaScript fallback
  - Stack mobile menu hidden
  - progressive enhancement
---

## 快速結論

靜態網站的文章即使不靠 JavaScript 也能輸出，但 Hugo Stack 的手機選單預設 `display: none`，要等 JavaScript 加上 `.show` 才出現。停用 JavaScript 後，主要導覽會完全不可達。

讓 HTML 先帶 `no-js` 狀態，僅在 JavaScript 成功執行時移除它；CSS 在 `no-js` 狀態直接展開選單。搜尋、留言和隨機文章等本來就需要 JavaScript 的功能，則提供清楚的替代出口。

## 症狀

- 文章、分類與桌面版連結正常顯示。
- 手機寬度下可看到漢堡按鈕，但按下沒有反應。
- 主選單沒有可點的連結，因為 CSS 預設將它隱藏。
- 前端搜尋不會產生結果，第三方留言容器保持空白。

## 影響範圍

- Hugo Stack 或採用相同「JS 展開手機選單」模式的佈景主題。
- 停用 JavaScript、被嚴格內容阻擋器攔截，或主 bundle 載入失敗的訪客。
- 搜尋、留言、圖片燈箱、主題切換等 client-side enhancement。

文章內容、一般連結、RSS 與 build-time metadata 不必依賴 JavaScript。

## 排查

先從建置後的 HTML 確認內容與導覽連結本來就存在，再找出哪一段 CSS 或 script 決定可見性。

```bash
hugo --destination /tmp/site-audit --cleanDestinationDir
rg -n 'toggle-menu|main-menu|<script|<noscript' /tmp/site-audit
rg -n '#main-menu|\.show' themes layouts assets
```

Stack 的典型關鍵規則是：

```scss
#main-menu {
  display: none;
}

#main-menu.show {
  display: flex;
}
```

再檢查 JavaScript 是否只在點擊後才加入 `.show`。若是，停用 JavaScript 時就沒有任何路徑能讓選單出現。

## 根因

佈景主題將手機選單的初始狀態設計成「隱藏」，但沒有提供 no-JS CSS 覆寫。HTML 已有連結，問題不是 Hugo 沒輸出內容，而是 client-side state 成了唯一的顯示開關。

同一類問題也常出現在由 localStorage 初始化的深色模式或字體選擇：停用 JavaScript 後，頁面可能退回不完整的預設樣式。

## 修正

在根元素先標示 no-JS 預設，並給出能直接閱讀的配色與字體；極小的 inline script 只負責在 JavaScript 可用時移除標示。

```html
<html class="no-js" data-scheme="light" data-font="custom">
  <head>
    <script>document.documentElement.classList.remove('no-js');</script>
  </head>
</html>
```

在專案自訂 SCSS 加入 fallback。JavaScript 正常時 `.no-js` 已移除，所以原本的 menu script 不必修改。

```scss
.no-js {
  #toggle-menu {
    display: none;
  }

  #main-menu {
    display: flex;
  }
}
```

不要假裝所有互動都能無 JS 運作；為其餘功能提供合適 fallback：

- 搜尋頁顯示可提交的外部搜尋表單，或文章／封存頁連結。
- 留言容器內用 `<noscript>` 提供 Email 或其他聯絡方式。
- JS 隨機文章按鈕將一般 `href` 指向封存頁，onclick 成功時才攔截為隨機跳轉。
- 保留 JSON-LD：它位於 `<script type="application/ld+json">`，但不是要在瀏覽器執行的互動程式。

## 驗證

```bash
hugo --destination /tmp/site-verify --cleanDestinationDir
rg -n 'class="no-js"|data-scheme="light"|<noscript' /tmp/site-verify
rg -o '\.no-js[^}]+' /tmp/site-verify/scss/*.css
```

- Hugo build 必須成功。
- 產出的 HTML 必須保留 `no-js` 初始 class、可閱讀的預設樣式與 fallback 文案。
- 在瀏覽器停用 JavaScript 後，以手機寬度確認選單直接可見、搜尋與留言都顯示替代途徑。
- 重新啟用 JavaScript，確認選單收合、主題切換與原本互動沒有回歸。

## 下次先查

先問「這個功能的 HTML 是否已在 build-time 輸出？」若有，再檢查 CSS 是否把它預設隱藏、唯一解除條件是否在 JavaScript。導航這類核心功能應預設可用；JavaScript 只負責收合、動畫與個人化。
