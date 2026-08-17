---
title: Good POSSE 分享圖卡沒有保留短文手動換行
description: Canvas 圖卡若先將所有空白正規化，短文中的換行符會被變成空格；應逐段保留手動換行後再做寬度換行。
date: 2026-08-17
tags:
  - good-posse
  - canvas
  - share-card
  - text-rendering
status: fixed
system: static-publisher
severity: low
aliases:
  - Canvas wrapText newline removed
  - 分享圖卡換行消失
---

## 快速結論

分享圖卡的短文不應把作者輸入的換行當成一般空白。先前的文字清理以空格取代所有空白字元，連 `\n` 也被移除；Canvas 只會依可用寬度自動折行，無法保留作者指定的段落。

保留換行符，對每個作者段落分別量測與折行；只有超過圖卡可用行數時才在最後一行加省略號。

## 症狀

- 編輯器與公開短文保留分行，但分享 JPEG 把兩段接成同一段。
- 圖卡有時仍會因寬度不足而自動折行，容易被誤認為手動換行有保留。

## 影響範圍

- Service：local-first 靜態發布工具的 Canvas 分享圖卡。
- 使用者影響：短文的語氣、段落與刻意留白在社群圖片上失真。
- 資料風險：無；僅影響暫態 JPEG 與 release 產生的社群圖卡。

## 排查

先比對輸入、文字前處理與 Canvas 的實際畫字函式。若前處理出現下列形式，換行一定會消失：

```ts
value.replace(/\s+/g, " ")
```

同時檢查內容摘要函式；即使 `wrapText()` 支援換行，若摘要已將 `\n` 收斂為空格，renderer 仍拿不到段落資訊。

## 根因

`\s` 包含換行符。圖卡 renderer 的摘要與折行邏輯都將它正規化為單一空格，混淆了「連續空格」與「作者手動換行」兩種不同語意。

## 修正

文字清理只收斂非換行空白，並保留至多一個空白行：

```ts
text
  .replace(/\r\n?/g, "\n")
  .replace(/[^\S\n]+/g, " ")
  .replace(/\n{3,}/g, "\n\n")
```

`wrapText()` 以 `\n` 分段；每段獨立依 `measureText()` 折行。行數耗盡時才截斷並加上 `…`。

## 驗證

```bash
cd good-posse/poc
npm run check && npm test && npm run build
```

- 建立含明確換行、長行與空白行的短文圖卡。
- 確認每個明確換行至少對應一個新的 Canvas 視覺行。
- 確認過長內容仍能在最後一行安全截斷。

## 下次先查

先檢查文字是否在進入 renderer 前已被 `\s+` 正規化；不要只看圖片是否剛好因寬度而自動換行。
