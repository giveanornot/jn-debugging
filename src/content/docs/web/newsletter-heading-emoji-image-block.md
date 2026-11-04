---
title: 電子報標題 emoji 換行：內文圖片樣式套到圖示
description: n8n 電子報標題中的 emoji 獨占一行、色塊被撐高時，檢查郵件端圖片替換與過廣的內文 img 樣式。
date: 2026-11-04
tags:
  - n8n
  - newsletter
  - gmail
  - css
  - emoji
status: fixed
system: html-email
severity: low
aliases:
  - newsletter emoji image display block
  - Gmail 標題 emoji 換行
  - 電子報標題留白過大
---

## 快速結論

電子報標題內的 emoji 若以圖片呈現，可能套到 `.article-body img` 的 `display: block` 與上下 margin，造成圖示獨占一行、標題背景增高。對標題內圖片補上 inline、字級相對尺寸與零 margin，即可保留原文並修正排版。

本案以真實 RSS 文章及模擬的 emoji 圖片替換重現截圖，修正版已發布至 n8n。未取得原郵件 DOM，也沒有追加實寄；Gmail 桌機與手機的實際顯示仍待確認。

## 症狀

- 寬度足夠的標題色塊中，emoji 在上、文字在下。
- 標題背景比一般單行標題高出一大截。
- 下方段落與次標題顯示正常。

## 影響範圍

問題位於共用電子報樣式，與 n8n 的 RSS 日期篩選、訂閱名單或 SMTP 設定無關。受影響的是標題中的圖片圖示；同一份樣式中的正文照片仍需維持區塊顯示。

## 排查

1. 確認截圖來自 n8n 電子報，保留標題文字。
2. 讀取共用 HTML、CSS 及渲染程式，找到套用所有內文圖片的規則：

```css
.article-body img {
  display: block;
  max-width: 100%;
  width: auto;
  height: auto;
  margin: 18px auto;
  border-radius: 6px;
}
```

3. 核對 RSS：標題原始內容為 emoji 加文字，沒有刻意插入換行元素。
4. 在隔離瀏覽器將標題 emoji 換成帶有 `alt` 的圖片，模擬郵件端替換。原樣式重現圖示與文字分行；增加標題圖片覆寫後恢復同行。
5. 比較修正前後文章文字，並在 713、390、320px 寬度檢查橫向溢位。

## 根因

已直接驗證的 CSS 行為是：圖片位於標題中時，仍會符合 `.article-body img`，被設為 block 並加入上下共 36px 的 margin。標題原有的行高再加上圖片區塊，便會撐高背景。

「原郵件的 emoji 被轉成圖片」是依截圖與模擬重現結果推定，未讀取實際 Gmail DOM。不能將此案例外推成所有郵件客戶端、所有 emoji 都會被替換。

## 修正

在既有正文圖片規則之後加入標題專用覆寫：

```css
.article-body h1 img,
.article-body h2 img,
.article-body h3 img,
.article-body h4 img,
.article-body h5 img,
.article-body h6 img {
  display: inline;
  width: 1em;
  height: 1em;
  margin: 0;
  border-radius: 0;
  vertical-align: -.15em;
}
```

本案標題圖片皆用作圖示；若網站會在標題內放大圖，應再縮小選擇器範圍。保留共用 `<style>` 與 class，不需要為此改寫文章或轉成 inline CSS。[Gmail 官方 CSS 文件](https://developers.google.com/workspace/gmail/design/css)列有 class／element selector 及本次使用的相關樣式屬性；支援清單不代表已完成實際郵件驗收。

n8n 的渲染 Code 節點內已打包 CSS 字串，因此修改本機來源後仍須重新打包、發布。部署前讀取最新流程，僅替換 stylesheet；保留節點連線、排程、訂閱者、SMTP 與當時最新的寄送游標。不要為驗證樣式直接執行正式寄信流程。

## 驗證

- 模擬圖片替換後，三種寬度下標題高度均由約 112px 降為約 52px；圖示與文字同行、沒有橫向溢位。
- 原文與修正版的文章文字相同，沒有修改標題用字。
- 發布後核對目前版本與發布版本一致，節點與連線內容符合預期，兩個 trigger 均為 activated。
- 部署期間電子報新增 execution 為 0、寄信為 0；原寄送游標保留，其他工作流與憑證資料列雜湊不變。
- 初次 readiness 通過時 trigger 狀態尚未建立；待啟動完成重跑同一驗證即通過，未再次匯入或重啟。
- 未實寄驗收 Gmail 桌機或手機 App。此處的 fixed 指共用模板修正與正式發布已完成。

## 下次先查

先看原始標題有沒有換行，再檢查郵件端 emoji 是否變成圖片及其 computed style。若一般瀏覽器的文字 emoji 正常，不能只靠原始 HTML 預覽排除郵件端圖片規則衝突；用最小圖片替換 fixture 重現後，再安排經授權的實際郵件驗收。
