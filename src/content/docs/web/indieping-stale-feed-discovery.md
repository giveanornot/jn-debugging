---
title: IndiePing 宣告的 RSS 已失效：驗證、替代 Feed 與 HEAD 405
description: 網站的 alternate RSS 連結可能已回 404；探索必須先驗證，繼續檢查其他公開 Feed，並區分 HEAD 不支援與真正無 RSS。
date: 2026-10-24
tags:
  - indieping
  - rss
  - feed-discovery
  - http
status: fixed
system: indieping
severity: medium
aliases:
  - declared RSS returns 404
  - RSS HEAD 405
  - alternate feed stale
  - 首頁正常但 RSS 失效
  - Feed endpoint returns HTML
---

## 快速結論

首頁的 `<link rel="alternate">` 是候選，不是有效 RSS 的保證。宣告的端點失效時，要繼續檢查同頁其他公開 RSS 連結與已知格式，取得可解析且有 item 的 Feed 才更新紀錄。

`HEAD` 回 405 可能只是來源不支援該方法，可在同一時限及大小限制內改用 `GET`。DNS 失敗、403 驗證頁、主機逾時與網站根本沒提供 RSS 則應分開記錄，不能都改成另一個猜測網址。

## 症狀

- 首頁 200 且仍持續寫文章，既有 RSS 卻長期累積失敗次數。
- 探索重新找到原本宣告的 RSS，但該網址實際回 404。
- 端點回 200，內容卻是空白頁、HTML 或 JavaScript 驗證頁。
- RSS 使用者端可讀取，單純 `HEAD` 驗證卻回 405。

```text
HTTP 404
Error: Feed not recognized as RSS 1 or 2.
Error: Unexpected close tag
AbortError: The operation was aborted
```

這些訊息只指出失敗階段，不能單憑 XML parser 錯誤認定來源的 XML 語法壞掉；它可能根本回了 HTML。

## 影響範圍

- 功能：已收錄網站的 RSS 更新、公開探索與管理員更正 RSS。
- 影響：新文章與反向連結漏抓，舊 Feed 的失敗計數持續增加。
- 修復邊界：可更正本站保存的 Feed URL 和探索程式，無法修好對方的 DNS、已刪除部署或防機器人規則。

## 排查

先取資料庫裡的實際 `rss_url`，同時檢查首頁及該端點的最終轉址、HTTP status 與 Content-Type。再檢查回應內容是否真為 Feed。

```bash
# 將兩個示例替換成資料庫及頁面上已確認的網址。
curl -sSIL --max-time 15 https://blog.example.org/
curl -sSIL --max-time 15 https://blog.example.org/atom.xml
curl -sSL --max-time 15 https://blog.example.org/atom.xml \
  -o /tmp/feed-response.xml
head -c 300 /tmp/feed-response.xml
```

從首頁實際的 alternate links、RSS 按鈕或文章分類頁取得替代候選。若網站的彙整 Feed 壞掉，但一般文章分類明確提供有效 RSS，可使用那個 Feed；須說明它不一定涵蓋網站所有其他分類。

替代網址要以 scanner 相同的受限 transport 與 parser 驗證。修正前，再比對其他已收錄來源的正規化及最終 RSS 身分，避免把已搬家的舊來源改指向新站 Feed，卻留下兩個來源繼續掃描。

本次另以正式主機重查所有失敗候選，確認哪些是本機網路差異，哪些在 scanner 環境也同樣失敗。

## 根因

RSS 探索原本找到宣告的 `href` 就回傳，沒有驗證該端點是否仍可用，因而不會繼續尋找頁面上的其他有效 RSS。網站改版後，舊宣告可能殘留，而分類 Feed 或新格式已經搬到不同路徑。

部分來源限制 `HEAD`，只用該方法會把有效 Feed 誤判成失效；另外一些來源則確實沒有可用 RSS，或只回傳驗證頁。它們不是同一個故障。

## 修正

探索層依序處理：

1. 讀取頁面上的 RSS/Atom 宣告及可辨識的 Feed 連結。
2. 在既有 deadline 內驗證候選；宣告端點回 404 時繼續下一個，不立即返回。
3. 對 `HEAD 405` 改用有大小限制的 `GET`，扣除前一步已消耗的時間。
4. 頁面候選都不可用時，再嘗試有限的常見格式。
5. 回報 `no_rss`、`not_found` 或 `unreachable`，與 scanner 的 parse／HTTP 錯誤分開保存。

資料層更正已驗證的 Feed URL，記錄 `rss_error` 與 `rss_checked_at`；管理頁可檢視失敗原因。正式套用前檢查來源重複，並保留既有文章和連結。

所有 HTTP 請求仍走現行 `safeFetch`：逐跳驗證轉址、限制公開位址、固定已驗證的連線 IP，維持 TLS、回應大小與時間限制。RSS 修復不需要停用憑證驗證、繞過對方驗證頁或恢復不受限的舊式抓取 fallback。

## 驗證

- 回歸測試涵蓋壞掉的宣告 Feed、頁面上可用的替代連結，以及 `HEAD 405 → GET`。
- Feed item 的相對網址、空白與片段會正規化；空連結及非 HTTP(S) 連結不建立文章。
- 整輪 39 項測試及建置通過；三個站點的有效 RSS 已更正，正式掃描成功，失敗計數歸零，共補入 32 篇文章。
- 另外 12 個來源在本機／正式主機檢查後仍無可用 Feed，保留故障原因與資料，未假稱全部修好。
- 來源去重的處理詳見[同一篇反向連結重複：來源合併與收錄防重](/web/indieping-duplicate-source-merge/)。

## 下次先查

1. 目前端點實際回什麼 status、Content-Type 和內容？是否只是 HTML 或驗證頁？
2. 首頁宣告是否過期？頁面其他 RSS 按鈕或分類是否有有效 Feed？
3. 是 `HEAD` 不支援，還是 `GET` 也失敗？scanner 所在主機能否重現？
4. 替代 Feed 是否真能解析出 item、是否已由另一個來源使用？
