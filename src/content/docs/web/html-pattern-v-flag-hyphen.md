---
title: HTML pattern 的連字號在 v 模式造成 Invalid character class
description: Slug 與網站名稱欄位使用舊式字元集合，導致瀏覽器忽略 pattern；須跳脫字面連字號並驗證真正的 DOM 欄位。
date: 2026-10-27
tags:
  - html
  - regex
  - form-validation
status: fixed
system: web
severity: low
aliases:
  - Pattern attribute value is not a valid regular expression
  - Invalid character class
---

## 快速結論

HTML `pattern` 使用 Unicode `v` 模式。`[a-z0-9-]+` 的最後一個字面連字號也須跳脫，改成 `[a-z0-9\-]+`。這是表單驗證問題，與同畫面中的 CSP 錯誤不同。[MDN 規則](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/pattern)

## 症狀

```text
Pattern attribute value [a-z0-9-]+ is not a valid regular expression
Invalid regular expression: /[a-z0-9-]+/v: Invalid character class
```

## 影響範圍

本案涉及 slug 與網站名稱欄位。無效的 pattern 被忽略，所以非法字串可能通過這項瀏覽器約束；其他程式驗證是否仍有效要另查，不能宣稱所有驗證均失效。

## 排查

搜尋所有 HTML pattern，並讀取真正輸出 DOM 的 `input.pattern`。只檢查 JavaScript regex literal 不足以證明 HTML 欄位正常。

## 根因

舊寫法把字元集合尾端的 `-` 當成可不跳脫字元，但 `v` 模式的規則不同。

## 修正

HTML／Svelte 屬性：

```html
<input pattern="[a-z0-9\-]+">
```

若透過 JavaScript 字串產生 regex，要再處理字串本身的跳脫：

```js
new RegExp('^(?:[a-z0-9\\-]+)$', 'v');
```

## 驗證

原寫法在乾淨 Chrome 重現錯誤且沒有攔下非法值。修正後在正式站的文章／短文實際欄位驗證：`test-123` 通過，`bad slug!` 不通過，Console 不再報 regex 錯誤。另以回歸測試編譯來源中的所有 pattern。

## 下次先查

先看錯誤是否帶 `/v`，再核對 DOM 屬性。輸入正確值與錯誤值各測一次，不能只看欄位有顯示。
