---
title: Nextcloud AIO 升級卡在 Starting
description: Nextcloud AIO upgrade can appear stuck while containers are healthy; no space left on device during tarball extraction is the real failure mode to check first.
date: 2026-07-03
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
---

## 快速結論

Nextcloud AIO 升級卡在 `Starting` 時，先用 Docker CLI 看真實 container health，不要只相信 AIO UI。升級需要下載 tarball、解壓新版本、暫存舊版本；空間不足會讓流程反覆失敗。

看到 `No space left on device` 或 `curl: (23) Failure writing output to destination`，先清空間，再重跑 AIO 升級。

## 症狀

- AIO UI 顯示 container 卡在 `Starting`。
- 升級流程看起來一直重試。
- log 出現：

```text
No space left on device
curl: (23) Failure writing output to destination
```

同時某些 container 其實已經 `Up` / `healthy`。

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

檢查空間：

```bash
df -h
docker system df
```

看 AIO / Nextcloud logs 是否有寫入失敗：

```bash
docker logs nextcloud-aio-mastercontainer --tail 200
docker logs nextcloud-aio-nextcloud --tail 200
```

如果 UI 顯示 `Starting`，但 Docker CLI 已顯示相關 containers healthy，可先用 CLI 與網頁實測，不要急著重建整套 AIO。

## 根因

AIO 升級流程需要額外空間處理新舊 Nextcloud tarball 與 Docker overlay。空間不足時，下載或解壓中途失敗；UI 狀態可能延遲或停留在 `Starting`，讓問題看起來像 container 卡住。

網路下載不是主因。下載 tarball 本身可能很快，慢或失敗的是本機檔案搬移、解壓與 overlay 寫入。

## 修正

先釋放足夠空間。保守目標是至少 10 GB 可用，較穩是 15-20 GB。

可以優先清：

- Docker build cache
- package manager cache
- 明確可重建的 application logs

避免直接刪：

- Nextcloud data directory
- database volume
- app config volume

空間恢復後，再讓 AIO 繼續升級或重啟相關 container。

## 驗證

- `df -h` 顯示有足夠 free space。
- `docker ps` 中 AIO containers 都是 `Up` / `healthy`。
- `occ status` 正常。
- Nextcloud web 可登入。
- Calendar / app 功能完成升級後複測。

## 下次先查

Nextcloud AIO 升級卡住時：

1. `docker ps -a --filter "name=nextcloud-aio"`
2. `df -h`
3. `docker logs nextcloud-aio-mastercontainer`
4. `occ status`

先判斷是 UI 狀態延遲、空間不足、還是真正 container crash。
