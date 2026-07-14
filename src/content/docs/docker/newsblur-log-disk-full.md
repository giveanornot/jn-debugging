---
title: NewsBlur log 爆滿 root disk
description: NewsBlur verbose request log can grow until the Docker host root filesystem reaches 100%, requiring truncation and logrotate.
date: 2026-06-29
tags:
  - newsblur
  - docker
  - disk
  - logrotate
status: fixed
system: newsblur
severity: high
aliases:
  - newsblur.log 29G
  - NewsBlur disk full
  - root filesystem 100%
---

## 快速結論

NewsBlur 服務異常或 host 空間滿時，先找大檔，不要直接 `docker system prune`。這次主因是 NewsBlur verbose log 單檔長到數十 GB。

確認是可重建 application log 後，先 truncate 釋放空間，再補 user-level logrotate，避免沒有 sudo 權限時卡在系統層設定。

## 症狀

Docker host 的 `/` 滿到 100%，只剩數百 MB。多個服務開始不穩，但 Docker image 可回收空間很小。

大檔掃描找到：

```text
NewsBlur/logs/newsblur.log  29G
```

內容主要是 verbose request / SQL / Redis log。

## 影響範圍

- 服務：NewsBlur on Docker
- Host：小型 self-hosted Docker server
- 影響：host root disk 滿，可能拖累 NewsBlur 與同機其他服務
- 資料風險：中；清錯檔可能刪到正式資料，所以只處理已確認的 log

## 排查

先看 filesystem：

```bash
df -h /
```

掃大檔與 Docker usage：

```bash
du -h -d 2 /path/to/docker-services | sort -h | tail -n 30
docker system df
journalctl --disk-usage
```

確認 Docker image/cache 是否真的是主因。若 `docker system df` 可回收量很小，就不要把 `docker system prune` 當第一刀。

確認目標檔是 application log：

```bash
tail -n 50 /path/to/NewsBlur/logs/newsblur.log
ls -lh /path/to/NewsBlur/logs/newsblur.log
```

## 根因

NewsBlur verbose logging 持續寫入 request / SQL / Redis 資訊，但沒有有效 rotation。單一 log file 持續長大，最後把 root filesystem 塞滿。

這不是 Docker image 累積造成；當次 Docker 可回收空間遠小於問題 log。

## 修正

先 truncate 已確認安全的 log file：

```bash
: > /path/to/NewsBlur/logs/newsblur.log
df -h /
```

如果沒有免密 sudo 或不想改 `/etc/logrotate.d`，可以用 user-level logrotate config：

```text
/path/to/NewsBlur/logs/newsblur.log {
  size 50M
  rotate 12
  compress
  missingok
  notifempty
  copytruncate
}
```

用使用者 crontab 定期跑：

```text
7 * * * * /usr/sbin/logrotate -s /path/to/logrotate.state /path/to/logrotate-newsblur-user.conf
```

先用 verbose mode 驗證：

```bash
logrotate -v -s /path/to/logrotate.state /path/to/logrotate-newsblur-user.conf
```

## 驗證

- `df -h /` 從 100% 降回安全水位。
- `logrotate -v` 建立 state 並可處理目標 log。
- 下一小時 crontab 有執行。
- NewsBlur web/API 仍可正常回應。

## 下次先查

自架服務 disk 滿時，先分三層：

1. `df -h /`
2. `du` 找最大目錄與單檔
3. `docker system df` 判斷 Docker cache 是否真是主因

只有在確認 image/cache 是主因時才 prune。對 application log，優先 truncate + logrotate。
