---
title: NewsBlur 升 Django 5：轉換舊 Session 並保留登入
description: 升級 NewsBlur Python、Django、Celery 時，需在舊 runtime 轉換伺服器端 Pickle Session，並分開驗證 SQL、登入、API與背景任務。
date: 2026-11-21
tags:
  - newsblur
  - django
  - session
  - redis
  - migration
status: fixed
system: newsblur
severity: high
aliases:
  - Django PickleSerializer removed
  - NewsBlur Python 3.13 Django 5.2
  - Redis session JSON migration
---

## 快速結論

換新Python基底不代表框架遷移完成。這次將NewsBlur web/worker遷移至Python3.13.18、Django5.2.19、Celery5.7.0，最先阻擋讀取API的是舊Session serializer。

在隔離副本中，以舊runtime讀取可信的伺服器端Session，轉成新runtime可驗證的signed JSON；保留Redis key、cookie對應與PTTL，再用原cookie驗證新服務。沒有在新runtime補回Pickle反序列化。這是本地相容分支，不代表上游支援此完整組合。

## 症狀

新runtime啟動後，首頁或讀取API因Session serializer失敗；其他相容差異還包括naive/aware時間比較、舊migration引用當前model、資源工具缺失。只跑import或首頁匿名200，不足以證明升級完成。

## 影響範圍

本案包含Python3.9/Django3.1/Celery4的既有自架NewsBlur，使用Redis伺服器端Session與多種資料庫。不同session backend、簽章設定或外掛需要另外判斷，不能直接套用本案Redis轉換器。

## 排查

1. 建立internal network、程式副本與四個DB副本，禁止外寄信及任務外發。
2. 用原runtime建立同一使用者、同一cookie的讀取基準，再切新runtime比較。
3. 將Session相容、SQL migration、OAuth、Celery及靜態資源拆成獨立驗證，避免只換映像標籤。

## 根因

[Django5.0移除了PickleSerializer](https://docs.djangoproject.com/en/5.2/releases/5.0/#features-removed-in-5-0)。直接換JSON serializer只處理新寫入格式，無法保證既有資料仍可讀；還要核對舊簽章與新簽章是否相容。

本案也明確保留舊版`USE_TZ=False`語意，避免框架預設值改變後出現時間型別錯誤。Fresh-test migration以`apps.get_model()`取得歷史model，而不是import新增過欄位的當前model。

## 修正

轉換只在舊runtime執行，來源限定可信的伺服器端資料，不接收任意外部Pickle：

1. 獨佔建立完整原始備份，不覆蓋前一次備份。
2. 辨認已是JSON的資料並略過，避免重跑時把正常Session解成空字典。
3. 讀取原key、內容與PTTL，轉換為JSON可表示的資料；不能辨認的內容保持原樣，不製造有效登入。
4. 先完整驗證所有候選，再以Redis WATCH避免覆蓋期間被更新的資料；寫入後保留原PTTL。
5. 設定新runtime使用JSONSerializer，沿用原cookie驗證登入者身分。

```python
SESSION_SERIALIZER = "django.contrib.sessions.serializers.JSONSerializer"
```

Celery部分保持JSON任務格式與原佇列／排程語意，實測舊producer到新worker；新的Beat state檔與舊runtime分開。正式服務起停沿用專案Makefile；不要任意使用一般Compose流程代替既有維護程序。

## 驗證

- 118個核心測試通過；41個原SQL表投影既有欄位後完整row SHA一致。
- 既有556 feeds、8個讀取API完整JSON一致；只排除明列的耗時與相對時間欄位，另核對預期的讀取計數變動。
- 正式20個Session保留key/cookie/PTTL；3個OAuth app保留。當時active token為0，因此沒有宣稱舊token實測通過；新code+PKCE、Bearer與refresh流程在隔離環境通過。
- 72個task、9個queue與19個排程對照相同，正式worker已有自然成功任務。
- 真Gunicorn與collectstatic通過；補齊鎖版Terser工具後，公開首頁及160個同站JS/CSS均HTTP2=200。

## 下次先查

查實際Python／Django／Celery與serializer，不只看image名稱。先驗原cookie、新舊資料與任務語意，再啟正式worker。回復時須成套考慮程式、SQL與Redis，先保留切換後的新資料；不能只退image而忽略Session或schema已變。本案未驗閒置的舊Twitter整合或付款等全部功能。
