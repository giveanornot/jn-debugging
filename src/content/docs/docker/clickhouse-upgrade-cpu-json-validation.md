---
title: ClickHouse 升級驗證：CPU 指令集與 JSON 整數假差異
description: ClickHouse 隔離升級可能先遇到虛擬CPU缺指令集，再因JSON整數序列化預設差異誤判資料變動。
date: 2026-11-21
tags:
  - clickhouse
  - plausible
  - cpu
  - migration
status: fixed
system: clickhouse
severity: high
aliases:
  - ClickHouse Illegal instruction AVX2 VM
  - output_format_json_quote_64bit_integers
  - ClickHouse migration row hash mismatch
---

## 快速結論

這次為Plausible CE3.2.1測試ClickHouse24.12到26.8 LTS，遇到兩個不同層次的障礙：測試VM缺AVX2，候選映像無法執行；改用支援的測試主機後，新舊JSON整數輸出差異又讓原始輸出雜湊不相同。

修正測試環境並固定序列化設定後，才比較資料語意。這次是自行驗證的應用／DB配對，不代表Plausible官方已認證此版本組合。

## 症狀

- 候選容器以`Illegal instruction`失敗，資料庫尚未正常啟動。
- 在可執行的主機上，新舊查詢回傳的數值相同，JSON中數字是否加引號卻不同，造成輸出雜湊不一致。

## 影響範圍

虛擬機曝露的CPU flags可能不同於實體主機。這是本案候選映像與VM的實測結果，不應推論所有ClickHouse映像都需要相同指令集。

資料比較也要區分型別、值、排序與輸出格式，不能只比較未正規化的JSON字串。

## 排查

1. 確認容器失敗發生在SQL執行之前，再核對VM實際可見的CPU flags。
2. 在資源足夠且符合候選需求的主機，建立internal network與資料副本；沒有為測試調整正式VM的CPU設定。
3. 對相同查詢固定排序與JSON整數格式，重算每表語意雜湊。
4. 將歷史報表、migration runner與新事件寫入分開驗證。

## 根因

第一個問題是測試VM的CPU能力與候選binary不相容。第二個問題是輸出序列化差異，不是資料已經毀損；只有查詢固定後的結果相同，才能把這次雜湊差異歸因於格式。

## 修正

在新舊查詢中明確指定相同設定，例如：

```sql
SELECT count()
FROM example_table
SETTINGS output_format_json_quote_64bit_integers = 1
FORMAT JSONEachRow;
```

上例只示範固定格式，完整驗證仍需明列欄位、穩定排序、型別與所有資料內容；count相同不代表內容相同。

先在副本測升級、migration runner與合成event/session寫入。正式切換前停止寫入、做最新一致備份，使用新持久目錄，保留原目錄與原映像。不要讓舊版binary直接開啟新版已修改的資料目錄。

## 驗證

- 隔離與正式的新舊20表語意內容雜湊一致，32組歷史與imports統計一致。
- 隔離副本的新事件與session寫入通過。
- 正式未送合成pageview；切換後觀察到自然事件落庫，核對UTC timestamp。
- DB與應用之外，另驗公開HTTP2及其餘服務健康，沒有靠單一容器running狀態宣稱升級完成。
- 備份移到另一台主機後，核對SHA、gzip與tar成員；測試容器／network／指定volumes清理完成，未全域prune。

## 下次先查

先查候選binary能否在目標VM執行，再投入資料遷移；比較資料前先固定格式。正式開始收事件後，回復要保留並評估補回切換後的新事件，不能直接退到舊目錄而無聲遺失新資料。
