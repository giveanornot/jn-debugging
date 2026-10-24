---
title: n8n RSS 新文章漏寄：無日期項目清空游標，改用成功後記錄日期
description: RSS Feed Trigger 遇到尾端無發布日期的頁面，可能反覆把目前時間當基準而漏抓新文；以 Schedule Trigger、RSS Read、有效日期篩選與寄送成功後更新游標修復。
date: 2026-10-24
tags:
  - n8n
  - rss
  - newsletter
  - docker
  - smtp
status: fixed
system: n8n
severity: medium
aliases:
  - n8n RSS Feed Trigger lastItemDate undefined
  - RSS missing pubDate silently skips new items
  - n8n workflow active but newsletter not sent
---

## 快速結論

n8n 2.44.5 的 RSS Feed Trigger 會用整份 Feed 的 `isoDate` 計算最新日期，沒有先排除無效日期。本次 Feed 尾端包含沒有 `pubDate` 的一般頁面，使 `lastItemDate` 變成 `undefined`；下一輪又以當下時間為基準，已發布的新文章就被跳過。

正式修復改在工作流層處理：**Schedule Trigger → RSS Read → 有效新日期篩選 → 原寄信流程 → 記錄成功日期**。不必修改 n8n 核心或取得部落格原始碼；所有收件者寄送成功後才更新日期。

## 症狀

- 工作流已發布且顯示啟用，RSS HTTP 200，來源也有新文章，卻沒有寄送紀錄。
- 已發布版本的 polling cron 有效，修正過排程參數或重啟後仍漏抓。
- RSS Trigger 的持久資料呈現 `{"node:RSS Feed Trigger":{}}`。
- 手動執行能取得最新文章，不能據此證明自動增量判斷正常。

## 影響範圍

- 實測環境：Docker Compose、n8n 2.44.5、RSS Feed Trigger。
- 來源：同一 Feed 聚合文章、近況與一般頁面，部分頁面沒有發布日期。
- 影響：新文章可能一直被判定為非新項目，下游寄信完全沒有機會執行。
- 本次未證明其他版本皆有相同行為；升級後應重新核對實際節點實作。

## 排查

1. 從 n8n 所在容器讀取 RSS，核對 HTTP 狀態、最新文章連結與發布時間。其他電腦抓到 403，不能直接推論容器也遭阻擋。
2. 查已發布版本、有效 cron 與 trigger activation 狀態；不要只看 active 標記，也不要把空 execution 清單直接當成排程沒跑。
3. 檢查**所有** Feed 項目，列出無效日期與位置。本次共 282 項，其中尾端 6 個一般頁面沒有 `pubDate`。
4. 讀取已安裝的 `RssFeedReadTrigger.node.js`，對照日期基準與最新日期的計算方式。
5. 用相同節點、相同 RSS 做前後兩次輪詢：先建立基準，再加入一篇保留原發布時間的新文章；下游只接 No Operation，不寄信。

原始 Feed 在第二次輪詢仍輸出 0；只移除無日期頁面後，第二次正確輸出 1 篇。另以完整隔離 n8n 的真實排程重現，排除只直接呼叫函式所漏掉的執行環境差異。

## 根因

該版本節點的關鍵邏輯可縮成：

```javascript
const cutoff = Date.parse(
  pollData.lastItemDate ?? pollData.lastTimeChecked ?? now,
);
pollData.lastItemDate = feed.items.reduce((a, b) =>
  new Date(a.isoDate) > new Date(b.isoDate) ? a : b,
).isoDate;
```

`new Date(undefined)` 是無效日期，大小比較不成立。如果歸約最後選到無日期項目，結果的 `isoDate` 就是 `undefined`。序列化時此欄位消失，因此資料庫只看到空物件。

下一輪再次落到 `now`。正常文章的發布時間早於實際輪詢時間，無法通過「發布時間晚於基準」的條件，於是回傳沒有新項目，而非報錯。

**空的持久資料本身仍不足以證明每一次正式輪詢都發生這個問題**；本次結論依據是實際節點程式碼、同來源資料對照及隔離排程重現。

## 修正

修改工作流，保留原訂閱名單、SMTP credential 與信件內容：

```text
Schedule Trigger（每小時整點）
  → RSS Read
  → 新文章（Code）
  → 訂閱名單 → Split Out → Send email
  → 記錄寄送成功日期（Code）
```

「新文章」Code 節點只讀取游標，保留有效、已到發布時間、晚於上次成功日期的項目。`pairedItem` 保留輸入對應，讓後續信件引用正確文章。

```javascript
const state = $getWorkflowStaticData('global');
// 部署前填入目前 Feed 最新的有效發布時間，避免自動重播歷史文章。
const initialCutoff = 'REPLACE_WITH_LATEST_RSS_ISO_DATE';
const cutoff = Date.parse(state.newsletterLastItemDate ?? initialCutoff);
if (!Number.isFinite(cutoff)) throw new Error('先設定有效起始日期');
const now = Date.now();

return $input.all()
  .map((item, index) => ({ item, index,
    date: Date.parse(item.json.isoDate || item.json.pubDate) }))
  .filter(row => Number.isFinite(row.date) && row.date > cutoff && row.date <= now)
  .sort((a, b) => a.date - b.date)
  .map(row => ({ json: row.item.json, pairedItem: { item: row.index } }));
```

寄信內容原本若引用 RSS Feed Trigger，須同步改成引用「新文章」，不能只替換節點類型。將更新日期放在整個 Send email 節點**之後**，不在篩選時提前標記成功：

```javascript
const dates = $('新文章').all()
  .map(item => Date.parse(item.json.isoDate || item.json.pubDate));
if (!dates.length || dates.some(date => !Number.isFinite(date))) {
  throw new Error('缺少有效的已處理文章日期');
}
const state = $getWorkflowStaticData('global');
state.newsletterLastItemDate = new Date(Math.max(...dates)).toISOString();
return $input.all();
```

透過支援的 UI、API 或 CLI 匯入／發布版本。本次使用 CLI，依其提示重啟 n8n，再核對已發布版本與當前 trigger 狀態；沒有直接修改 SQLite 的節點或版本欄位。

已有原始碼存取權時，也可以在 RSS 產生端排除無效日期項目。本次沒有刪除所有一般頁面或近況，因為聚合這些內容是來源原本的設計。

## 驗證

### 隔離排程與完整寄信流程

使用與正式環境相同的 image、獨立資料庫、JS runner、容器內 HTTP Feed 與 SMTP 接收器。容器 `network none`，不對外寄信。

- 保留原本無日期項目，另加入未來日期項目：皆不會被選取。
- SMTP 故意在 DATA 結尾回 451：流程停在 Send email，成功日期不更新。
- 下一輪自動排程：同一篇成功送到 4 位測試訂閱者，之後才更新日期。
- 相同 Feed 再輪詢、重啟再輪詢：沒有重寄。
- 加入第二篇新文：再寄 4 封，內文連結與文章配對正確，後續不重寄。

這項失敗測試是在第一封遭拒；它不代表已驗證「部分收件者成功後才失敗」時的逐人去重。

### 正式環境與實寄

- 暫以每分鐘排程執行兩輪，確認實際 RSS 可讀、Code runner 正常、新文章 0 時不寄信，再恢復每小時整點。
- 取得補寄同意後，只允許指定文章進入流程、短暫回退游標，實際寄給原有 4 位訂閱者。
- 同一次成功執行的 4 筆 SMTP 結果均 accepted 1、rejected 0、回覆 `250 2.0.0 Message received`，4 個 message ID 相異；收件者集合與原名單一致。
- 成功日期更新後，後續兩輪新文章 0、寄信 0。移除單篇限制並恢復整點排程，確認版本一致、trigger activated、沒有啟用錯誤。
- 其他工作流定義與 credential data 雜湊前後不變。

SMTP 250 證明寄信服務已接收，不能直接推論收件匣已收到；本次未讀取收件者信箱或核對後續投遞佇列。

## 下次先查

1. 從執行 n8n 的環境抓 Feed，檢查所有項目的日期，尤其尾端一般頁面。
2. 對照已安裝節點的游標更新方式，不先將漏抓歸因於 cron 或 SMTP。
3. 用「先建立基準、再加入新文、再重複輪詢」驗證增量判斷；只跑一次手動執行不夠。
4. 故意測試寄送失敗，確認成功日期沒有提前更新。
5. 部署後分別核對實際排程、SMTP 接受結果與防重複；明確區分服務接收和收件匣投遞。
