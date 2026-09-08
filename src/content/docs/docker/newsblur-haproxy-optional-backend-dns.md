---
title: NewsBlur 升級後 HAProxy 因可選 Backend DNS 失敗重啟
description: NewsBlur 的 HAProxy 設定新增主機端可選 backend 時，未解析的 host.docker.internal 可能讓整個 proxy 無法啟動。
date: 2026-09-08
tags:
  - newsblur
  - haproxy
  - docker
  - dns
  - reverse-proxy
status: fixed
system: newsblur
severity: high
aliases:
  - host.docker.internal could not resolve address
  - HAProxy Failed to initialize servers addr
  - NewsBlur HAProxy restarting
  - optional backend DNS failure
---

## 快速結論

NewsBlur 升級帶入一個連到 `host.docker.internal` 的可選 backend。Linux Docker 環境若沒有這個名稱，HAProxy 會在啟動時因 DNS 解析失敗直接退出，讓整個站台離線。

對非必要 backend 加上 Docker DNS resolver 與 `init-addr last,libc,none`，讓它解析不到時維持 down，而非阻擋 HAProxy 啟動。

## 症狀

- `haproxy` 容器持續 `Restarting`，公開 HTTPS 入口無法連線。
- 其他 NewsBlur 容器仍可能保持 running。

```text
[ALERT] : 'server camera_monitor/camera_monitor' : could not resolve address 'host.docker.internal'.
[ALERT] : Failed to initialize server(s) addr.
```

## 影響範圍

- Service: NewsBlur 的 HAProxy reverse proxy。
- Host or environment: Linux 上的 Docker Compose；未設定 Docker Desktop 的特殊 hostname。
- User-visible impact: 所有經 HAProxy 的 NewsBlur 網頁與 API 暫時不可用。
- Data risk: 無資料損毀；問題只影響 proxy 啟動。

## 排查

先區分是後端應用故障，還是 proxy 在讀設定時就停止：

```bash
docker compose ps haproxy
docker logs --tail 40 newsblur_haproxy
grep -n -C 2 'host\.docker\.internal' docker/haproxy/haproxy.docker-compose.cfg
```

若 log 同時出現 `could not resolve address` 和 `Failed to initialize server(s) addr`，可確認是設定載入期的 DNS 問題，不是 camera backend 的健康檢查失敗。

## 根因

HAProxy 預設要在啟動時取得 `server` 指令的可用位址。升級後加入的 camera monitor 指向 `host.docker.internal`，但這個名稱不是一般 Linux Docker daemon 預設提供的 DNS 紀錄。

該 backend 在此部署並非 NewsBlur 的必要依賴，卻因缺少延後解析設定而使整個 HAProxy 無法啟動。

## 修正

讓可選 backend 沿用 Compose network 的 DNS resolver，並允許初始位址缺失：

```text
resolvers docker
    nameserver dns1 127.0.0.11:53

backend camera_monitor
    server camera_monitor host.docker.internal:8765 check inter 5000ms resolvers docker init-addr last,libc,none
```

重新載入 proxy：

```bash
docker compose restart haproxy
```

若 camera monitor 本身是必要服務，改以 Compose `extra_hosts` 或實際可解析的 host IP 讓名稱可用；不要用這個容錯設定掩蓋必要 backend 持續離線的問題。

## 驗證

```bash
docker compose ps haproxy
curl -kfsS -o /dev/null -w '%{http_code}\n' https://127.0.0.1:10443/status
curl -fsS -o /dev/null -w '%{http_code}\n' https://your-newsblur-host/status
```

- HAProxy 顯示 `running`，不再重啟。
- 本機 TLS status endpoint 與公開 status endpoint 都回 `200`。

## 下次先查

升級後若 NewsBlur 全站突然離線但資料庫、Web、Celery 都仍在 running，先看 HAProxy log 是否有新增 backend 的 DNS 解析錯誤，再檢查該 backend 是否真的是此部署必要服務。
