---
title: NewsBlur 沒有新文章時分層檢查 feed refresh
description: Self-hosted NewsBlur can appear stale because Celery workers are running old code, upstream feed routes fail, unread filters hide neutral stories, or no subscribed feeds are due in the scheduler.
date: 2026-07-15
tags:
  - newsblur
  - docker
  - rss
  - celery
status: fixed
system: newsblur
severity: medium
aliases:
  - NewsBlur no new stories
  - NewsBlur feed refresh scheduler
  - scheduled_updates due_now
  - Celery stale worker
---

## 快速結論

NewsBlur 「沒有新文章」不要只看前台 river。先分四層：Celery worker 是否載到最新 code、feed URL 本身是否還能抓、使用者訂閱的 folder / unread filter 是否真的包含那些 feed、Redis `scheduled_updates` 裡是否有 active subscribed feeds 到期。

這次同時踩到三件事：`task_celery` 沒重啟所以還在跑舊 import、部分 RSSHub YouTube routes 回 503/404、前台預設 folder 只有 neutral unread 而 positive view 看起來像空白。手動 refresh 使用者 active subscriptions 後，NewsBlur 本身排程沒有卡住。

## 症狀

自架 NewsBlur 前台長時間看不到新文章。使用者預期 default / favorite river 會自己掃出新 feed，但畫面幾乎沒有更新。

後端 log 可見 worker 端 import error，部分 upstream feed route 也回 HTTP error：

```text
ImportError: cannot import name 'absolutize_story_content_urls'
HTTP Status code: 503
HTTP Status code: 404
```

## 影響範圍

- 服務：self-hosted NewsBlur on Docker Compose
- 元件：`task_celery`、feed fetcher、Redis feed scheduler、user subscriptions
- 影響：使用者 river / folders 看起來沒有新文章；特定 feed 抓取失敗
- 資料風險：低；主要是抓取延遲與 unread state 混淆，不是 story database corruption

## 排查

先看 worker 是否正在丟系統性錯誤：

```bash
docker compose logs --tail=200 task_celery
docker compose ps task_celery
```

如果剛改過 NewsBlur code，重啟會執行 feed parsing 的 worker，而不是只重啟 web：

```bash
docker compose restart task_celery
```

確認 feed URL 本身是否還可用。對第三方 route，先用 `curl` 直接看 HTTP status；若是 RSSHub route 壞掉，但來源平台有官方 RSS，優先改成官方 RSS：

```bash
curl -I 'https://example-rsshub.invalid/youtube/channel/<id>'
curl -I 'https://www.youtube.com/feeds/videos.xml?channel_id=<id>'
```

檢查使用者看到的 folder 是否真的含有預期 feed，並確認 unread 分數不是被前台 filter 藏起來：

```python
from django.contrib.auth.models import User
from apps.reader.models import UserSubscription

u = User.objects.get(username="<user>")
qs = UserSubscription.objects.filter(user=u, active=True)
print(qs.count())
print(
    sum(s.unread_count_positive for s in qs),
    sum(s.unread_count_neutral for s in qs),
    sum(s.unread_count_negative for s in qs),
)
print(qs.filter(unread_count_neutral__gt=0).count())
print(qs.filter(unread_count_positive__gt=0).count())
```

檢查 NewsBlur scheduler 是否真的有 due feeds。NewsBlur 不是照 folder 掃；`task-feeds` 會從 Redis sorted set `scheduled_updates` 找 score 小於現在的 feed，再 queue fetch task。只有 active subscribed feeds 才會被排進 schedule。

```python
import datetime
import redis
from django.conf import settings

r = redis.Redis(connection_pool=settings.REDIS_FEED_UPDATE_POOL)
now = int(datetime.datetime.utcnow().strftime("%s"))
print("scheduled_total=", r.zcard("scheduled_updates"))
print("due_now=", len(r.zrangebyscore("scheduled_updates", 0, now)))
print("queued=", r.scard("queued_feeds"))
print("tasked=", r.zcard("tasked_feeds"))
```

必要時對單一使用者 active subscriptions 手動補掃一輪，讓 UI 先追上：

```bash
docker compose exec -T task_celery \
  python manage.py refresh_feeds -u <username> -w 8 -t 10
```

## 根因

這類問題容易被前台畫面混在一起，但實際是不同層：

- stale worker：container 沒重啟，Celery 還在用舊 Python module，新的 helper function import 不到。
- upstream feed failure：RSSHub YouTube route 失敗，NewsBlur refresh 正常執行但來源回 503/404。
- UI / unread mismatch：favorite/default folder 不一定包含剛修的 feed；如果只有 neutral unread，positive / focus view 會像沒有新文章。
- scheduler misunderstanding：NewsBlur 自動掃描是 per-feed schedule，不是「default folder 到時間整包掃」。沒有 due feed 時 `task-feeds` 正常地不會 queue 任何東西。

## 修正

重啟跑 feed parsing 的 worker，讓它載入最新 code：

```bash
docker compose restart task_celery
```

把壞掉的 RSSHub YouTube routes 改成 YouTube 官方 RSS。playlist 與 channel 的 URL 形式不同：

```text
https://www.youtube.com/feeds/videos.xml?channel_id=<channel-id>
https://www.youtube.com/feeds/videos.xml?playlist_id=<playlist-id>
```

改完後對受影響 feeds force refresh，確認沒有再噴 import error 或 route parser error。

最後，如果使用者正在等前台立刻有內容，用 `refresh_feeds -u` 對該使用者 active subscriptions 補掃，而不是調高全站 scheduler 頻率。這可以避免小型 self-hosted server 對外部站台和 YouTube 類 feed 打太兇。

## 驗證

- `task_celery` container 維持 `Up`。
- Celery log 沒有新的 `ImportError` / `Traceback`。
- RSSHub YouTube subscription count 降到 0，或已全部遷到官方 RSS。
- 公開 `/reader/feeds` 回 200。
- Redis scheduler 沒有堆積：

```text
due_now=0
queued=0
tasked=0
```

- 手動補掃後，使用者 unread totals 與 feeds-with-unread 數量上升。

## 下次先查

遇到 NewsBlur 「沒有新文章」，照這個順序查：

1. `task_celery` log 有沒有系統性 exception。
2. 受影響 feed URL 直接 `curl` 是否 200。
3. 該 folder 是否真的包含那些 feed。
4. unread positive / neutral / negative 是否被前台 filter 隱藏。
5. Redis `scheduled_updates` 是否有 active subscribed feeds due。
6. 需要立即補資料時才跑 `refresh_feeds -u <username> -w 8 -t 10`。
