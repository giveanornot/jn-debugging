---
title: NewsBlur 失連訂閱：核對新 RSS 並保留原訂閱
description: NewsBlur 的 feed exception 與 page exception 需分開檢查；先確認搬家與 RSS 內容，再備份歷史、更新原訂閱並實際重抓。
date: 2026-11-11
tags:
  - newsblur
  - rss
  - feed-discovery
status: fixed
system: newsblur
severity: medium
aliases:
  - NewsBlur broken feed address
  - NewsBlur Unsafe URL DNS
  - RSS 換網址
related:
  - docker/newsblur-feed-refresh-scheduler
  - docker/newsblur-refresh-trims-story-history
---

## 快速結論

先區分 RSS 抓取失敗與原站預覽失敗，再從作者目前的網站取得訂閱入口。HTTP 200 仍可能是關站公告，必須解析 RSS／Atom 並核對發佈者與文章。

修復前先備份訂閱、文章與已讀狀態；保留 Feed ID 不代表重抓時不會裁掉舊文，詳見[重抓觸發舊文裁切](/docker/newsblur-refresh-trims-story-history/)。

## 症狀

部分訂閱長期顯示 404、403、401 `Unsafe URL` 或 553 `Not an RSS feed`，其他訂閱仍正常更新。另一類訂閱持續有文章，卻顯示首頁預覽錯誤。

## 影響範圍

自架 NewsBlur 的第三方訂閱、來源探索、原站預覽與歷史資料。本次修復六個 RSS 來源與一個預覽入口；另有來源因 DNS、連線或未找到有效 RSS 而保留未解狀態，不刪除訂閱。

## 排查

在目前部署的 Django shell 查看目標帳號訂閱，分別列出兩種 exception：

```python
from django.db.models import Q
from apps.reader.models import UserSubscription
from apps.rss_feeds.models import Feed, MFetchHistory

feed_ids = UserSubscription.objects.filter(
    user_id=USER_ID
).values_list('feed_id', flat=True)
broken = Feed.objects.filter(pk__in=feed_ids).filter(
    Q(has_feed_exception=True) | Q(has_page_exception=True)
)
for feed in broken:
    print(feed.pk, feed.feed_address, feed.feed_link,
          feed.has_feed_exception, feed.has_page_exception)
    print(MFetchHistory.feed(feed.pk)['feed_fetch_history'][:1])
```

對失效 feed 與網站首頁分別發送 GET，跟隨轉址並檢查實際內容。優先讀首頁的 `rel="alternate"`、RSS 按鈕或訂閱說明，不只猜常見路徑。

```python
import requests
import feedparser

response = requests.get(CANDIDATE_URL, timeout=20)
response.raise_for_status()
parsed = feedparser.parse(response.content)
assert parsed.version and parsed.entries
print(response.url, parsed.feed.get('title'), parsed.feed.get('link'))
print([(entry.get('title'), entry.get('link'))
       for entry in parsed.entries[:2]])
```

本次遇到的實例模式：

- 作者搬網域或更換架站工具，舊 RSS 路徑不再存在。
- 舊 FeedBurner 回 200，但正文已是平台關站公告。
- WordPress 首頁宣告 `/feed/`，該路徑卻 404；一般 `?feed=rss2` 也被 canonical redirect 導回失效路徑。本次以 `?feed=rss2&preview=true` 取得有效、可公開讀取的 RSS，才採用此替代入口；不是所有站都適用。
- `Unsafe URL` 出現在已無法解析的來源網域；不能僅憑 401 判定為帳密問題，更不應停用 SSRF 防護。
- RSS 正常，`feed_link` 卻空白，導致 page history 回 `Feed has no original page: No feed link`。

## 根因

來源位址與目前網站不一致，或原站預覽缺少入口。這與 Celery／scheduler 全站停擺不同；若所有訂閱都不更新，先走[排程分層檢查](/docker/newsblur-feed-refresh-scheduler/)。

## 修正

只對驗證為同一發佈者的來源換址。這次在單一使用者的自架環境，用現有 ORM 更新原 Feed，沒有刪除重訂。寫入前檢查新 address/link 組合的 hash 是否已存在，因為 `Feed.save()` 遇到碰撞可能合併 Feed；多使用者或共享 Feed 環境應先確認變更影響。

記錄原 `feed_address`、`feed_link`、鎖定旗標、ETag 與訂閱資料，再寫入驗證的新位址並清空舊條件式請求欄位。若替代入口會被自動探索改回失效地址，再針對該 Feed 設定 `feed_address_locked`。

只有預覽失敗時，從 RSS channel link 或已驗證首頁補 `feed_link`，不更換正常 RSS。

完成文章與已讀備份後，執行目標 Feed 的實際抓取；本次維護程序暫停 `trim_feed()`，避免重抓新增文章時裁切舊快取。這是單次維護措施，未修改後續 worker 的留存政策。

## 驗證

- 本次七個目標的最新 feed/page fetch 均為 200，兩種 exception 均清除。
- 訂閱總數、原 Feed／UserSubscription ID、啟用狀態、自訂標題與閱讀日期保持一致。
- 額外核對原 story IDs，不能以「訂閱還在」代替歷史完整性。
- Django JSON serializer 的日期可能只有毫秒；與 ORM 的微秒值比對時統一精度，不為通過檢查而覆寫原時間。
- 無有效新來源的訂閱保持原狀，不將「未找到 RSS」宣稱成「網站已永久停止 RSS」。

## 下次先查

先讀最新 fetch history，再核對來源首頁、訂閱入口與實際 XML；確認同源、備份歷史、排除重複 Feed 後才換址。最後用 NewsBlur 本身重抓並核對資料保留情況。
