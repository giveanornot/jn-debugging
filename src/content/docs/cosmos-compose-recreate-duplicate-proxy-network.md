---
title: Cosmos 代理的 Docker Compose 服務重建後出現兩個代理網路
description: 用 Docker 事件辨認 Cosmos 自動建立的代理網路，避免服務重建時把舊代理網路也接回去。
date: 2026-11-23
category: proxy
tags:
  - cosmos
  - docker
  - docker-compose
  - pictshare
status: fixed
system: cosmos-server
severity: medium
aliases:
  - Cosmos duplicate proxy network
  - Cosmos PictShare networks differ
  - Cosmos Docker Compose recreate
related:
  - cosmos-http2-startup-nextproto-race
---

## 快速結論

透過 Docker Compose 換映像時，Cosmos 會為它代理的服務重建代理網路。讓 Cosmos 接上新網路，再驗證 Compose 專案網路、資料掛載和公開入口。若同時手動接回舊的 Cosmos 網路，新容器可能同時留在兩個代理網路。

## 症狀

PictShare 換映像後公開首頁回 HTTP/2 200，容器也通過健康檢查，但部署腳本比對網路集合時出現 `AssertionError: networks differ`。有一個 Compose 專案網路，還有兩個以 `cosmos-` 開頭的網路。切回舊映像時也出現同樣狀況。

## 影響範圍

本案是由 Cosmos 0.24 代理的 Docker Compose 應用，重建對象為 PictShare。部署腳本因網路比對失敗而回復，增加一次服務切換。實例的資料掛載保留，重試後既有檔案通過雜湊比對。

## 排查

1. 記錄應用容器當下的 ID、映像、資料掛載和網路。Cosmos 接管期間容器 ID 可能再變一次，驗收前重新查詢。
2. 查重建時段的網路事件，對照舊容器、新容器和代理各自接上哪個網路。事件中的 `create` 與兩次 `connect` 可分辨 Cosmos 新建網路和腳本接回舊網路的時點。
3. 分別查代理網路成員與公開入口。HTTP 200 可驗證目前路由可用，網路成員要用 Docker 狀態另外核對。

以實際容器名稱取代範例中的 `app-1`：

```bash
docker inspect -f '{{.Id}} {{.Config.Image}} {{range $name, $net := .NetworkSettings.Networks}}{{$name}} {{end}}' app-1
docker events --since 10m --until 0s --filter type=network \
  --format '{{.Time}} {{.Action}} {{index .Actor.Attributes "name"}} {{index .Actor.Attributes "container"}}'
docker network inspect -f '{{.Name}} {{range .Containers}}{{.Name}} {{end}}' <managed-network>
```

## 根因

部署腳本補接了舊的 Cosmos 網路。Cosmos 同時為重建後的應用新增代理網路，並把自己與應用都接上新網路。舊網路也被帶進 Cosmos 重建後的容器，於是兩個代理網路同時存在。

## 修正

- 更新 Compose 的應用映像，只重建該服務。保留資料掛載、Compose 專案網路和容器重啟策略。
- 移除部署流程中針對此服務補接舊 Cosmos 網路的步驟。自動接管完成後，重新抓有效容器 ID。驗收這個案例時，確認恰有一個活動的 Cosmos 代理網路，成員為代理與應用。
- 完成公開入口及應用功能驗證後，才清理由本次失敗嘗試建立、且應用已離開的代理網路。先確認網路成員與實際路由，保留其他既有網路。

## 驗證

- 重試後，PictShare 保留 Compose 專案網路並加入一個新代理網路，成員為 Cosmos 和 PictShare。原資料與日誌掛載皆保留。
- 比對 233 個既有檔案的 SHA-256，實測上傳一張測試圖、公開讀取並刪除。
- 清理兩個暫留網路後，12 個對外入口均回 HTTP/2 200。這次驗證涵蓋該容器的換映像流程與當時的 Cosmos 設定。

## 下次先查

先用 Docker 事件確認網路是 Compose 宣告、自行連接或由 Cosmos 建立。若容器健康但部署因網路比對失敗，核對代理網路是否重複，再決定回復或調整驗收條件。
