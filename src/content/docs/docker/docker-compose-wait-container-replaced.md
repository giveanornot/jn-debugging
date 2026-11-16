---
title: Docker Compose up --wait 遇到 No such container
description: 容器在 Compose 等待期間被替換時，透過服務名稱重新檢查映像與健康狀態。
date: 2026-11-16
tags:
  - docker
  - docker-compose
  - healthcheck
status: fixed
system: docker
severity: low
aliases:
  - No such container during compose up --wait
---

## 症狀

部署 RSSHub 時，`docker compose up -d --wait` 顯示服務已啟動，接著在 `Waiting` 階段回 `No such container`。回復舊映像時也出現相同訊息。

## 排查

用容器名稱查目前 ID 和映像，並對照 Docker 的 `start`、`destroy` 和 `create` 事件。這次事件紀錄顯示同名容器在等待期間被替換，舊 ID 已消失。測試沒有確認是哪個程序執行了替換。

```bash
docker inspect --format '{{.Id}} {{.Config.Image}} {{.State.Status}}' rsshub-rsshub-1
docker events --since 3m --filter container=rsshub-rsshub-1
```

## 修正與驗證

保留舊映像和 Compose 設定備份。切換映像時只重建指定服務，完成指令後按容器名稱重新查詢。每次確認它運行的是預期映像，再檢查服務健康端點。

```bash
docker compose up -d --no-deps --pull never rsshub
docker inspect --format '{{.Config.Image}} {{.State.Health.Status}}' rsshub-rsshub-1
docker exec rsshub-rsshub-1 curl -fsS http://127.0.0.1:1200/healthz
```

容器啟動需要時間。用有上限的重試等候，接著檢查公開網址、實際 RSS 內容和既有路由。如果指定映像沒上線，或服務在期限內無法通過檢查，恢復備份設定後再重建。這次用服務名稱重新檢查後，新路由與原有路由均通過，Docker healthcheck 回 `healthy`。
