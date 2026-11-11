---
title: NewsBlur 重抓成功卻只剩 10 篇：舊文裁切與補回
description: Feed.update 新增文章會觸發 trim_feed；本次長期未閱讀來源被縮至 10 篇，從隔離還原的備份只補缺漏文章並核對 BSON。
date: 2026-11-11
tags:
  - newsblur
  - mongodb
  - backup
  - data-recovery
status: fixed
system: newsblur
severity: high
aliases:
  - NewsBlur refresh deletes old stories
  - NewsBlur trimming down to 10
  - NewsBlur trim_feed history recovery
related:
  - docker/newsblur-broken-feed-address
---

## 快速結論

NewsBlur 的 `Feed.update()` 會寫入文章、更新統計，也可能裁掉歷史快取。本次部署的 `number_of_stories_to_store()` 在讀取統計為零時，把保留上限縮至 10；不能把 force refresh 當作只有新增資料的操作。

事故發生後，先停止重複補掃，從已驗證備份抽取受影響文章，只補目前缺少的文件。不要用舊備份整庫覆蓋正式資料。本次已補回裁掉的舊文，但沒有修改長期留存政策。

## 症狀

失連來源換址後重抓回 200、exception 清除，原訂閱與閱讀日期仍在，舊文章數卻從數十或數百篇變成 10 篇：

```text
Trimming down to 10 (instead of 200) stories
Found 220 stories. Trimming to 10...
```

## 影響範圍

自架 NewsBlur 的 MongoDB stories 與 Redis 故事／已讀集合。文章快取可能被刪除，來源 RSS 又不一定包含那些舊文章；SQL Feed 與 UserSubscription 備份無法替代文章備份。

## 排查

先比對受影響 Feed 更新前後的 story IDs、數量與抓取日誌，再看目前部署的程式。這次確認兩個連續步驟：

1. feed fetcher 在成功新增文章後呼叫 `feed.trim_feed()`。
2. `number_of_stories_to_store()` 檢查 Redis 的週閱讀統計，當累計為零且不是 `pre_archive` 時，執行 `cutoff = min(cutoff, 10)`。

「讀取統計為零」不等於使用者從未讀過該站；統計的涵蓋範圍與資料是否仍在都要另查。重抓成功與保留歷史是兩個獨立驗證項目。

## 根因

原先只備份了 SQL 訂閱設定，就呼叫會裁切文章的正式更新流程。保留 Feed ID 雖保住訂閱關聯，仍無法防止 NewsBlur 執行正常的快取清理。

## 修正

### 先保全資料，再做後續重抓

除了 Feed／UserSubscription，先備份目標 Mongo stories 的原始 BSON、完整 story ID 清單，以及 Redis 相關已讀集合。不要在輸出中傾印服務環境變數或連線密碼。

若維護目的要求保留全部原文章，可以只在當次 Python 程序暫停已確認的裁切方法；這段程式只在完成備份後使用：

```python
from unittest.mock import patch
from apps.rss_feeds.models import Feed

with patch.object(Feed, 'trim_feed', return_value=0):
    feed.update(force=True, single_threaded=True)
```

這不會變更其他 worker，也不是完整的已讀狀態備份方案；更新流程仍會修改資料與快取。後續自然更新是否裁切，仍依原本留存規則判斷。

### 將備份還原到獨立命名空間

本次使用已有且先前驗證過的備份。先確認 MongoDB 真正的容器內連接埠、備份相容性、可用空間與暫存資料庫名稱未被使用，再執行 dry run：

```bash
docker exec -i <mongo-container> mongorestore \
  --host=127.0.0.1 --port=<actual-port> \
  --archive --gzip --dryRun --verbose \
  --nsInclude=newsblur.stories \
  --nsFrom=newsblur.stories \
  --nsTo=incident_recovery.stories \
  --noIndexRestore < <verified-backup.archive.gz>
```

核對輸出只包含預期 collection，且目的地是臨時命名空間。確認後移除 `--dryRun` 並加上 `--stopOnError` 才執行還原；不使用 `--drop`，也不更改正式 collection。跨版本還原警告不能直接忽略，需有相容性與文件內容核對證據。

### 只補缺少的原文件

從臨時 collection 只選本次受影響的 `story_feed_id`，把抽取資料另存 BSON，再與正式 collection 的 `_id` 比對。不存在才插入，不覆寫既有文件：

```python
import bson

for doc in recovered_docs:
    assert doc['story_feed_id'] in affected_feed_ids
    if live.find_one({'_id': doc['_id']}, {'_id': 1}) is None:
        live.insert_one(doc)
        actual = live.find_one({'_id': doc['_id']})
        assert bson.BSON.encode(actual) == bson.BSON.encode(doc)
```

發生唯一索引衝突時停止該項補回並檢查 GUID／hash，不以整筆覆寫或合併迴避。補回後同步目標 Feed 的 Redis 故事索引、重新計算統計與未讀數，再核對原訂閱與閱讀日期。只在驗證及抽取資料保全後移除本次建立的臨時命名空間。

## 驗證

本次四個來源在既有備份的數量，與重抓前記錄一致；補回 546 筆缺漏文件，逐筆 BSON 核對相同，原有 548 筆舊文章全部可查。原訂閱 ID、啟用狀態、自訂標題與閱讀日期一致，沒有整庫回復或重啟正式服務。

後續維護重抓已在該程序暫停裁切，原有文章 ID 無缺漏。未修改全站留存政策，也未宣稱未來自然更新永遠保留這些快取。

## 下次先查

重抓前先確認 `Feed.update()` 的副作用與目前的留存分支，備份文章／已讀狀態並記錄原 ID 集合。成功後同時核對 HTTP、exception、原文章 ID 與閱讀狀態；只看文章數增加仍不足以證明舊文都在。
