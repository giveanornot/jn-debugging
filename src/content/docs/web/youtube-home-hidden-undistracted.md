---
title: YouTube 首頁空白：UnDistracted 隱藏推薦區
description: 首頁導覽正常、推薦影片卻整片空白時，比對新舊分頁的 DOM 與 computed style，確認是否為 UnDistracted 殘留的隱藏規則。
date: 2026-11-03
tags:
  - youtube
  - brave
  - browser-extension
  - css
status: investigating
system: youtube
severity: low
aliases:
  - YouTube home blank
  - undistracted-style
  - Hide Feed
---

## 快速結論

本案 YouTube 已載入影片內容，但 UnDistracted 注入的 CSS 將首頁推薦區設為 `display: none !important`。舊分頁仍保留規則，同一個 Brave、同一帳號新開首頁則正常顯示。

先檢查擴充功能的 YouTube → Hide Feed。暫停過濾後，若舊分頁仍空白，可重新整理讓頁面重新載入設定。[UnDistracted 官方網站](https://undistracted.app/)列有 Hide Feed 與暫停過濾功能；本案未實際驗收原分頁重新整理後的結果。

## 症狀

- YouTube 頂端搜尋列、帳號與左側訂閱清單正常。
- 首頁推薦區整片空白，未顯示載入錯誤。
- 擴充功能面板顯示已開啟 Pause for 5 minutes，但原分頁仍空白。

## 影響範圍

確認影響原本的 YouTube 首頁分頁。原分頁的隱藏樣式也列有 Shorts 與相關影片選擇器，但本次沒有逐一驗收這些區域。未確認其他瀏覽器或擴充功能版本是否相同。

## 排查

1. 在同一瀏覽器、同一帳號另開首頁，確認推薦影片與縮圖能正常顯示。
2. 唯讀檢查原分頁 DOM，發現已有 107 個 `ytd-rich-item-renderer`；這是整頁節點數，不代表全部屬於目前首頁。
3. 找到 `id="undistracted-style"` 的樣式，其中包含：

```css
[page-subtype="home"] #primary,
[page-subtype="explore"] #primary {
  display: none !important;
}
```

4. 比對首頁主要區域的 computed style：原分頁為 `none`；新分頁為 `block`，且沒有該樣式節點。

可在 DevTools Console 唯讀檢查：

```js
const primary = document.querySelector(
  'ytd-browse[page-subtype="home"] #primary'
);
({
  display: primary ? getComputedStyle(primary).display : null,
  injectedRule: document.getElementById('undistracted-style')?.textContent,
});
```

## 根因

直接原因是原分頁的推薦區被 UnDistracted 樣式隱藏。暫停狀態與舊分頁實際樣式不一致；尚未追蹤擴充功能事件，不能進一步斷言是哪個設定同步或清理流程失效。

## 修正

這次提供設定層的處理方式，沒有修改擴充功能或 YouTube 程式：

- 暫時觀看：啟用暫停過濾後，重新整理空白分頁。
- 持續顯示首頁：到 UnDistracted 的 YouTube 設定關閉 Hide Feed，再重新整理。

## 驗證

已實測同一瀏覽器與帳號的新首頁正常顯示影片；新舊分頁的樣式與 computed style 對照支持隱藏原因。未修改 Hide Feed、未重新整理原分頁，也未驗證五分鐘暫停結束後的行為，因此維持 investigating。

## 下次先查

先比較同帳號的新分頁，再查空白區域是否已有 DOM、是否被 `display: none` 隱藏及規則來源。擴充功能面板的暫停開關不能取代頁面實際樣式的驗證。
