---
title: Threads 引用卡片讓網址、時間與內文錯配
description: A Threads extractor can assign the outer card's first timestamp and text to a quoted permalink, falsely satisfying a search checkpoint; bind timestamps to each permalink and reject unverified legacy coverage.
date: 2026-10-25
tags:
  - threads
  - browser-automation
  - dom
  - checkpoint
  - data-integrity
status: investigating
system: browser-automation
severity: medium
aliases:
  - Threads quoted post wrong timestamp
  - card querySelector time mismatch
  - Threads permalink timestamp pairing
  - Threads quote false coverage
---

## 快速結論

抽到不同貼文 URL，不能直接給它們同一張外卡的第一個 time 與整段 innerText。引用與回覆可能共用外層容器，導致網址屬於一篇、時間與文字卻來自另一篇。

本例已修正抽取程式並通過重建 DOM 與搜尋續跑測試；原 Brave 線上 DOM 尚未驗收，因此保留 investigating 狀態。舊結果沒有保存 DOM，不能猜測回填時間或宣稱歷史搜尋覆蓋已修好。

## 症狀

- 相同 query 中，不同帳號／permalink 共用完全相同的時間與整段摘要。
- 摘要開頭顯示外卡作者，URL 卻指向引用貼文作者。
- 引用貼文沒有自己的時間，仍被記成已取得絕對時間。
- 最舊時間已跨 checkpoint，但不能證明該時間屬於抽到的 URL。

## 影響範圍

- Threads 搜尋結果的網址、摘要與時間配對。
- 根據最舊累積時間判定 completed 的搜尋 runner。
- 以舊 completed manifest 決定下一輪搜尋起點的流程。

[虛擬 DOM、逾時與續跑問題](/ai-tools/threads-search-virtual-dom-checkpoint/) 是另一層：資料有落盤、runner 可恢復，不代表每筆資料本身已正確配對。

## 排查

檢查三次既有搜尋的 JSONL，分別發現 7、5、2 組「不同 URL、相同時間與整段文字」。這是值得追查的訊號，不能只憑文字相同就斷言所有資料都錯。

回查抽取程式，發現它逐一走訪所有 /post/ 連結，卻對每個連結使用相同的外層容器：

```javascript
const card = anchor.closest('article, [data-pressable-container]');
const time = card?.querySelector('time');
// href 來自 anchor；time 和 text 卻來自可能包含其他貼文的 card。
```

以共用容器重建最小案例：

```html
<article data-pressable-container>
  <header>
    <a href="https://www.threads.com/@outer/post/new">
      <time datetime="2026-10-25T12:00:00Z">new</time>
    </a>
  </header>
  <p>外卡內容</p>
  <div>
    <a href="https://www.threads.com/@quoted/post/old">引用作者</a>
    <p>引用內容，沒有自己的時間</p>
  </div>
</article>
```

舊抽取器會讓引用 URL 借用外卡時間與文字；新版在同一 fixture 留空引用 URL 的時間與文字，保留 URL 供逐篇補查。

## 根因

DOM selector 找得到元素，不等於元素屬於目前的貼文。closest 找到的容器可能同時包含外卡與引用卡；querySelector 只取其中第一個匹配元素，沒有證明時間與 URL 的歸屬。

若後續只檢查 Date.parse 是否成功，錯配的時間仍是合法日期，會流入最舊時間與 completed checkpoint。

目前證據能證明舊演算法在重建結構上的錯誤，並支持歷史資料的配對風險；沒有原始 DOM，不能逐筆判定歷史真實時間。

## 修正

### 先證明時間屬於 permalink

```javascript
const time = anchor.querySelector('time[datetime]');
const value = time?.getAttribute('datetime') || '';
const verified = Boolean(value) && !Number.isNaN(Date.parse(value));
```

這是本例採用的保守規則，不保證涵蓋所有 Threads 頁面結構。找不到相同 permalink 內的時間時，不借用外卡時間；保留 URL，時間與文字留白供補查。

完整實作另處理以下情況：

- media URL、重複 permalink 與舊網域正規化後再去重，避免無時間的媒體連結先占住結果。
- 抽取文字時隔離不同 permalink 的引用／回覆分支，避免將整張外卡文字指定給引文。
- 未標記 article 的引用分支也納入測試；實頁驗收仍需確認這個假設。

### 讓 checkpoint 帶可信來源

新版結果使用以下欄位：

```json
{
  "extraction_version": 2,
  "time_source": "permalink"
}
```

這是自訂 runner 的資料版本，並非 Threads API 欄位。

- 只有新版且時間來源已驗證的結果能參與最舊時間計算。
- 已知 URL 有未驗證時間時，不宣稱搜尋窗口已完成；重新取得可靠資料後可補正同一 URL。
- 沒有新版證據的舊結果與 completed manifest 保留作歷史，不當 checkpoint。
- 沒有可信 checkpoint 時從最近 24 小時建立新基準；這不等於補完過往歷史。

## 驗證

九組 DOM 測試通過：原版錯配可重現、新版避免借時間；另包含巢狀引用、沒有時間的引用、media 連結去重、無效時間、舊網域、外站連結與無標記的引用分支。

搜尋 runner 回歸涵蓋：

- 舊版錯誤的早期時間不再讓搜尋提前 completed。
- 舊 completed manifest 不再推進 checkpoint。
- 可靠舊貼文與不可靠時間混合時仍保持 incomplete。
- 相同 URL 補正後可恢復可信覆蓋判定。
- 原有短批次、續跑與近期窗口規則仍通過。

本輪瀏覽器連線不可用，尚未重跑原 Brave 線上頁面。重建 DOM 測試的成功只證明測試涵蓋結構下的修正；不能據此宣稱線上所有卡片結構都已支援。

## 下次先查

1. 選一張含引文／回覆的實頁卡片，同時保存各 permalink、datetime、容器及文字來源。
2. 比對網址、作者、時間與摘要是否各自歸屬同一貼文。
3. 缺時間時逐篇補查，不以更多捲動代替配對驗證。
4. 檢查結果與 manifest 的資料版本，拒絕未驗證的舊 checkpoint。
5. 線上回歸通過後，再更新本頁狀態；歷史時間仍依可取得的原始證據另行處理。
