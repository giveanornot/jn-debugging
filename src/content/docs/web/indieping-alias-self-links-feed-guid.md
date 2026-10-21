---
title: IndiePing 別名整合後連結數下降與 Feed GUID 驗證
description: 別名管理需要同步查詢、scanner 與 Feed；部署時用來源站拆分自我連結，避免將預期筆數下降誤判為資料遺失。
date: 2026-10-21
tags:
  - indieping
  - domain-alias
  - rss
  - sqlite
  - deployment
status: fixed
system: indieping
severity: medium
aliases:
  - alias query check scanner inconsistent
  - self links counted as backlinks
  - Feed GUID changed after alias
  - 部署 smoke 筆數下降自動回退
---

## 快速結論

IndiePing 的網域別名必須讓 query、check、Feed 與 scanner 使用一致的 canonical domain。僅把別名寫進資料庫，可能讓公開查詢已認得同一站，待審、收錄檢查與後續掃描仍各自處理。

排除自我連結後，公開反向連結與 Feed 項目會合理減少。本次查詢從 313 筆變成 283 筆，差額剛好是 30 筆同站連結；應檢查既有外站資料與 GUID，而不能要求新舊總數、Feed 前 100 筆完全相同。

## 症狀

- 根網域重新導向已收錄的子網域，且使用相同 RSS，卻又出現在待審清單。
- 管理介面沒有把待審網域指定為既有部落格別名的操作。
- 手動新增別名後，query 可找到既有站，check 與 scanner 尚未完整套用同一規則。
- 部署新版本時，smoke 比對發現查詢筆數與 Feed 項目改變，自動還原舊版本。

## 影響範圍

- 環境：Node.js、Hono、Vue、SQLite；systemd 管理服務。
- 功能：待審核、網域別名、反向連結抽取、公開查詢與 RSS Feed。
- 資料風險：直接覆寫歷史 `target_domain` 會失去原始連結身分；重算 GUID 可能讓 RSS reader 把舊通知視為新通知。
- 部署風險：測試若把預期行為變更當成回歸，會觸發不必要的回退。資料庫遷移後只還原程式也可能留下不相容狀態。

## 排查

1. 確認待審網域的 redirect、RSS URL 與既有部落格資料。相同 RSS 僅作候選提示，仍由管理員確認別名關係。
2. 逐一追蹤 query、check、Feed 與 scanner 的網域解析，確認是否只修了其中一條路徑。
3. 在正式資料庫的備份副本套用 migration，檢查原始列與欄位，再比對公開結果。
4. 第一次部署因筆數不符回退後，依來源站拆分連結，確認是少了外站資料，還是排除了本站連結。

以下 SQL 在備份副本執行；將示例網域替換為既有 canonical domain：

```sql
WITH target_domains(domain) AS (
  SELECT 'blog.example.org'
  UNION
  SELECT alias_domain FROM domain_aliases
  WHERE canonical_domain = 'blog.example.org'
)
SELECT
  CASE WHEN b.domain = 'blog.example.org'
    THEN 'self' ELSE 'external' END AS source_kind,
  COUNT(*) AS link_count
FROM links l
JOIN posts p ON p.id = l.post_id
JOIN blogs b ON b.id = p.blog_id
WHERE l.target_domain IN (SELECT domain FROM target_domains)
GROUP BY source_kind;
```

本次結果是 30 筆 self、283 筆 external，合計等於舊版 313 筆。正式資料庫原有列的逐位元組比對也一致，沒有證據顯示原始連結遭刪除。

Feed 有 100 筆上限：排除其中 8 筆同站項目後，會補進較舊的外站項目。接著以「舊版 Feed 分組與 GUID 演算法＋原始資料庫排除自我連結」建立獨立預期，避免用新版函式產生預期再驗證自己。

## 根因

有兩個不同層次的問題：

- 別名規則未覆蓋完整讀寫路徑，且缺少帶並行修改檢查的管理操作。
- 部署 smoke 把「所有舊結果不變」當成驗收條件，未納入這次明確要求的自我連結過濾。Feed 視窗補入較舊項目，也不等於既有外站 GUID 改變。

## 修正

程式層統一 canonical domain 解析，讓 query、check、Feed 與 scanner 都套用別名與同站判斷；別名 Feed 以 308 轉向 canonical Feed。

管理介面新增待審轉別名、既有部落格別名新增／移除與搜尋。交易內核對待審 revision 及目標站 aliasesRevision，再新增別名並移除待審；過期表單回 409。拒絕自我別名、別名鏈、搶占別名，以及直接將獨立收錄站合併。

資料層保留原始連結網域與首次發現時間，透過 `feed_guid_overrides` 保存別名異動前的既有 Feed 身分。追蹤設定 fingerprint 改變時，重新解析目前 RSS 中的文章；這不代表已補掃全部歷史文章。

部署層將驗收拆為原始資料完整性、外站結果正確性、保留項目的 GUID 穩定性。確認獨立預期後，沿用同一份已 push 程式重新部署，不為通過錯誤的斷言而恢復自我連結。

回退需先停止服務，同步還原該次部署備份的 runtime、依賴、frontend 與 SQLite，並保留回退前資料庫以供調查。

## 驗證

- `npm test`：30/30 通過；TypeScript 與 Vite build 通過。
- 備份副本 migration 可重複初始化，原始欄位以 `typeof` 與 `hex(CAST(... AS BLOB))` 比對；不假設 legacy TEXT 都是有效 UTF-8。`quick_check` 正常、foreign key check 無違規。
- 兩個站點保留的 192 個已發布外站 GUID 全部一致，其中受影響站保留 92 個，另一站 100 個。
- 正式 HTTPS：公開 query/check 正確，canonical RSS 200、別名 Feed 308，管理 API 未登入 401／登入 200。
- 真實瀏覽器確認公開清單 321 筆同頁顯示，搜尋／排序與手機版正常，無 pageerror。
- 測試涵蓋別名新增、撤回、重加、並行修改與重新掃描；完整歷史補掃未執行。

## 下次先查

1. 相同 RSS 的待審網域是否其實是既有站別名？所有讀寫路徑是否共用解析？
2. 筆數差額按來源站拆分後，是否剛好等於應排除的自我連結？
3. 原始資料是否仍在？保留的外站項目是否沿用 GUID？Feed 上限是否引入較舊項目？
4. 預期結果是否來自獨立舊版基準？程式與資料庫是否有成套備份可回退？
