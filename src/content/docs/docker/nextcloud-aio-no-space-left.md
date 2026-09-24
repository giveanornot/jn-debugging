---
title: Nextcloud AIO 磁碟壓力與升級卡在 Starting
description: Nextcloud AIO may remain healthy while its Docker host is nearly full; distinguish the UI state from disk pressure, reclaim only safe Docker artifacts, and cap logs before upgrading.
date: 2026-09-24
tags:
  - nextcloud
  - aio
  - docker
  - disk
status: fixed
system: nextcloud
severity: medium
aliases:
  - Nextcloud AIO Starting
  - Nextcloud no space left on device
  - curl failure writing output
  - Nextcloud disk 96%
  - Nextcloud AIO Docker image prune
  - Nextcloud journal disk full
---

## 快速結論

Nextcloud AIO 升級卡在 `Starting`，或 Docker host 根分割區逼近滿載時，先用 Docker CLI 看真實 container health，不要只相信 AIO UI 或直接主機的 `80`／`443` port。AIO 可在反向代理後方或發布到自訂 port，因此 host 端口未開不等於 Nextcloud 已停止。

升級需要下載 tarball、解壓新版本、暫存舊版本；空間不足會讓流程反覆失敗。看到 `No space left on device` 或 `curl: (23) Failure writing output to destination`，先清空間，再重跑 AIO 升級。若 containers 和 `occ status` 都正常，這是容量預警，不應為了清空間而重建 AIO。

## 症狀

- AIO UI 顯示 container 卡在 `Starting`。
- 升級流程看起來一直重試。
- log 出現：

```text
No space left on device
curl: (23) Failure writing output to destination
```

同時某些 container 其實已經 `Up` / `healthy`。

- 根分割區只剩少量空間，例如 `df -h /` 顯示 90% 以上；但 AIO containers 仍全數 `healthy`。
- 直接連主機的 `80`／`443` 失敗，但 AIO Apache 實際發布在另一個 port 或交給外部 reverse proxy。

## 影響範圍

- 服務：Nextcloud AIO
- 模組：Nextcloud container、Collabora/Office image、AIO mastercontainer
- 影響：升級卡住，Calendar / web app 可能維持舊版或短暫不可用
- 資料風險：中；不要在空間不足時手動改 DB 或刪 Nextcloud app data

## 排查

先看 AIO container 真實狀態：

```bash
docker ps -a --filter "name=nextcloud-aio"
```

看 Nextcloud 本體狀態：

```bash
docker exec -u www-data nextcloud-aio-nextcloud php occ status
```

檢查根分割區、systemd journal 與 Docker 的可回收空間：

```bash
df -h /
sudo journalctl --disk-usage
docker system df
```

只看 AIO 的實際發布 port，不猜測主機端口：

```bash
docker port nextcloud-aio-apache
docker port nextcloud-aio-mastercontainer
```

看 AIO / Nextcloud logs 是否有寫入失敗：

```bash
docker logs nextcloud-aio-mastercontainer --tail 200
docker logs nextcloud-aio-nextcloud --tail 200
```

如果 UI 顯示 `Starting`，但 Docker CLI 已顯示相關 containers healthy，可先以 `occ status` 和已設定的 Nextcloud URL 實測，不要急著重建整套 AIO。

## 根因

AIO 升級流程需要額外空間處理新舊 Nextcloud tarball 與 Docker overlay。空間不足時，下載或解壓中途失敗；UI 狀態可能延遲或停留在 `Starting`，讓問題看起來像 container 卡住。

網路下載不是主因。下載 tarball 本身可能很快，慢或失敗的是本機檔案搬移、解壓與 overlay 寫入。

即使尚未觸發升級，Docker 舊映像與未設上限的 persistent journal 也可能逐步吃掉小型 root filesystem。Containers 仍健康只代表服務暫時可用，不代表下一次升級仍有足夠工作空間。

## 修正

先釋放足夠空間。保守目標是至少 10 GB 可用，較穩是 15–20 GB；若這無法長期達成，擴大 VM root disk 比反覆清資料更可靠。

依序只清可重建資料：

```bash
# 僅刪除沒有任何 container 使用的映像；先確認 docker system df 的 RECLAIMABLE
docker image prune --all --force

# 只會移除 archived journal；先 rotate 才能立即縮小 active journal
sudo journalctl --rotate --vacuum-size=500M
```

將 journal 上限設為保守值，避免下次再次佔滿 root filesystem：

```ini title="/etc/systemd/journald.conf.d/99-disk-cap.conf"
[Journal]
SystemMaxUse=512M
SystemKeepFree=5G
```

寫入後重啟 journald：

```bash
sudo systemctl restart systemd-journald
```

如果有規律的自動更新，可用 cron 保留 14 天映像 rollback window，再清理未使用映像。依映像更新頻率與可接受的回退期調整 `until`：

```text
17 4 * * 0 /usr/bin/docker image prune --all --force --filter until=336h
```

避免直接刪：

- Nextcloud data directory
- database volume
- app config volume

空間恢復後，再讓 AIO 繼續升級或重啟相關 container。

## 驗證

- `df -h /` 顯示有足夠 free space。
- `docker ps` 中 AIO containers 都是 `Up` / `healthy`。
- `occ status` 正常。
- 依 `docker port` 或既有 reverse proxy 路徑確認 Nextcloud web 可登入。
- Calendar / app 功能完成升級後複測。

## 下次先查

Nextcloud AIO 升級卡住時：

1. `docker ps -a --filter "name=nextcloud-aio"`
2. `df -h / && sudo journalctl --disk-usage && docker system df`
3. `docker port nextcloud-aio-apache`
4. `docker exec -u www-data nextcloud-aio-nextcloud php occ status`

先判斷是 UI／proxy 路徑、容量壓力，還是真正 container crash；只有後者才從 logs 或 restart 著手。
