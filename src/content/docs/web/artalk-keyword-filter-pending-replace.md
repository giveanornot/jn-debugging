---
title: Artalk 關鍵字 filter 不會拒收留言，預設待審時如何處理
description: 釐清 Artalk 2.10.1 的關鍵字待審與替換模式，避免把空字串替換誤認為拒收，並保留全體留言待審設定。
date: 2026-11-04
tags:
  - artalk
  - moderation
  - configuration
status: fixed
system: artalk
severity: low
aliases:
  - Artalk keyword filter
  - Set to pending when match
  - Artalk replace_to 空字串
---

## 快速結論

Artalk 2.10.1 原生關鍵字 filter 只有「命中後轉待審」和「替換命中文字」兩種模式，不能在留言寫入前直接拒收。取消 `Set to pending when match` 並把 `replace_to` 留空，是刪除命中文字，不是拒收留言。

若已設定所有新留言預設待審，關鍵字的待審模式對公開可見性沒有額外效果，也不會減少待審區的垃圾留言。希望保留原文供人工判斷時，可只關閉關鍵字 filter，保留預設待審。

## 症狀

- 廣告留言仍出現在管理員的待審清單。
- 以為關閉「命中後轉待審」就能直接擋掉留言。
- 想用算命暱稱攔截只有一般稱讚文字的留言。

## 影響範圍

- 本次核對版本為 Artalk 2.10.1，Docker 部署、設定檔掛載至 `/data/artalk.yml`。
- 問題涉及原生 keyword filter 的能力與設定語意，不代表待審留言已公開。
- 關閉 keyword filter 不會還原過去已遭替換的內容；這次沒有修改既有留言。

## 排查

1. 只讀檢查 `moderator.pending_default` 與 `moderator.keywords`，避免輸出整份含憑證的設定。
2. 本次現況為 `pending_default: true`、關鍵字 `enabled: true`、`pending: false`、`replace_to: ''`。
3. 比對歷史廣告正文與原字庫，發現新增詞提案只能命中已待審的留言，無法達到「不進待審區」。
4. 查 [官方審核設定說明](https://artalk.js.org/en/guide/backend/moderator.html) 與 [2.10.1 模式選擇原始碼](https://github.com/ArtalkJS/Artalk/blob/v2.10.1/internal/anti_spam/base.go)，確認 `pending: false` 選的是替換模式。
5. 查 [2.10.1 關鍵字 checker](https://github.com/ArtalkJS/Artalk/blob/v2.10.1/internal/anti_spam/keywords.go)，確認只對正文做區分大小寫的子字串比對，不比對暱稱或個人網址。

## 根因

介面中的「不轉待審」不等於「拒收」。`pending: true` 選擇待審模式，`false` 選擇文字替換模式；空的替換字串會移除命中的文字。

此外，`pending_default: true` 已讓非管理員的新留言先待審。此時再加入待審關鍵字，不會改變這些留言的待審結果。把廣告暱稱放進正文關鍵字庫也不會生效。

## 修正

修改設定層，只關閉原生 keyword filter：

```yaml
moderator:
  pending_default: true
  keywords:
    enabled: false
```

以上是局部片段，應合併到既有設定，不要用它覆蓋整份設定檔。保留其他審核、驗證碼與通知設定，也不刪除原關鍵字檔。

先備份設定，確認沒有環境變數覆寫這兩項設定，再編輯實際掛載的檔案並只重啟 Artalk。若服務未恢復，還原備份後重啟同一服務。本次沒有新增代理層拒收規則。

## 驗證

- YAML 完整語意比對只有 `moderator.keywords.enabled` 從 `true` 改為 `false`，`pending_default` 仍為 `true`。
- 重啟後 Artalk 容器為 running，內網 `/api/v2/conf` 回 HTTP 200。
- 前後 comments、users、pages、sites、notifies、votes 六表計數相同；計數相同只證明筆數，未執行全資料逐位元比對。
- 未送出真實測試留言或通知，沒有實測新留言的端到端流程。
- 外部部落格頁面的自動 HTTP 讀取收到 403，未完成公開實頁驗收；內網成功不能替代這項驗證。

## 下次先查

1. 要達成的是不公開、保留原文待審，還是寫入前直接拒收？
2. `pending_default` 是否已開啟？關鍵字的 `pending` 與 `replace_to` 是什麼？
3. 比對目標是否真的在正文，而非暱稱或個人網址？
4. 設定是否受到環境變數覆寫？變更後是否重新載入？
5. 若需求超過原生功能，先說明限制，不因查到其他代理服務就自動擴大修改範圍。
