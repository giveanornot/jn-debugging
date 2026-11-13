---
title: Plurk 搜尋把錯誤回應當成空結果
description: Plurk search clients must record each query's HTTP and response status before treating an empty result as a valid response.
date: 2026-11-13
tags:
  - plurk
  - api
  - search
  - rate-limit
  - python
status: fixed
system: plurk-search
severity: medium
aliases:
  - Plurk search empty rate limit
  - Plurk API error mistaken for no results
---

## 快速結論

搜尋 API 的錯誤物件沒有 `plurks` 欄位時，若直接使用 `data.get("plurks", [])`，HTTP 429 或 API 錯誤就可能被呈現成零筆。逐詞記錄 HTTP 狀態、JSON 格式、API 錯誤及結果數，並讓其他詞繼續搜尋。

即使回應是 HTTP 200 且陣列為空，也只證明收到符合預期格式的空陣列；若服務靜默限流回傳相同格式，無法單憑這些欄位辨識。

## 症狀

一批多詞搜尋中，部分詞沒有結果，但輸出只有貼文陣列，無法判斷那些詞是空結果或 API 錯誤。JSON 解析失敗也可能中斷後續搜尋。

## 影響範圍

依 API 搜尋結果判斷詞效的工作流程，可能錯誤停用詞或漏報搜尋未完成。已發生的空結果若未保存 HTTP 與回應，無法事後推定當時狀態。

## 排查

以隔離模擬回應測試既有函式：HTTP 200 空陣列、HTTP 429 錯誤物件與 HTTP 200 API 錯誤物件都被當成空結果；非 JSON 則拋出解析錯誤。此測試沒有連線平台，不代表已證實先前空結果是 429。

## 根因

程式未先檢查 HTTP 狀態或 API 錯誤，缺少預期欄位時以空陣列作預設。輸出也沒有逐詞狀態，所以不同情況無法從結果檔區分。

## 修正

每詞先判斷連線、HTTP、JSON、API 錯誤與結果結構，記錄 `http_status`、狀態、API 原始筆數與時間篩選後筆數。狀態獨立保存，避免把錯誤物件或憑證寫入紀錄；一個詞失敗不阻止其他詞搜尋。原貼文輸出維持 JSON 陣列以保留相容性。

## 驗證

- 離線測試涵蓋正常空陣列、429、API 錯誤、無效 JSON／結構、連線逾時與部分查詢失敗後繼續。
- 驗證狀態檔與 stderr 未包含模擬憑證或伺服器錯誤正文，stdout 仍可解析為原格式。
- 新程式尚未在真實 Plurk 搜尋中驗證；原本無逐詞狀態的歷史結果保持未知。

## 下次先查

1. 比對該詞的 HTTP 狀態、API 回應格式及原始／篩選後筆數。
2. 明確錯誤與合法空陣列分開紀錄；不要把缺少狀態的詞判為成功。
3. 合法空陣列仍需考慮靜默限流，避免為驗證空結果而反覆觸發查詢。
