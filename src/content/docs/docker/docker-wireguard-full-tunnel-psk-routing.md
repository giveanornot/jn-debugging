---
title: Docker WireGuard 全隧道連線後失去網路或管理連線
description: Diagnose a Docker-hosted WireGuard full tunnel that handshakes but loses Internet or management access, including dropped PSK and default-route checks.
date: 2026-09-03
tags:
  - wireguard
  - docker
  - networkmanager
  - vpn
status: fixed
system: linux
severity: high
aliases:
  - wireguard handshake no response
  - wg0 no internet after connect
  - NetworkManager WireGuard PresharedKey
---

## 快速結論

Docker 裡的 WireGuard server 收到封包但不回應，先比對雙方 public key 與 PresharedKey。NetworkManager 若用不完整的 peer 字串覆寫設定，可能悄悄移除 PSK，結果看似 UDP／port-forward 壞掉，實際是兩端無法驗證 handshake。

若 handshake 成功但開啟 `AllowedIPs = 0.0.0.0/0` 後 Internet 或遠端管理工具失聯，問題通常是 default route 已切到 `wg0`，但 server 沒有做 NAT／forward，或管理連線沒有被保留路由。先排程自動關閉 tunnel，再測試出口與 DNS。

## 症狀

```text
Failed to create WireGuard interface: Operation not supported

TLS connect error: unexpected EOF while reading

VPN connected, but Internet and the desktop management client time out
```

- UDP port-forward 已建立，但 client 的 `latest handshake` 一直是 `never`。
- server tcpdump 看得到 handshake initiation，卻沒有 response。
- `wg0` 顯示已連線後，原本透過 Wi-Fi 的遠端管理工具或 Internet request 卡住。

## 影響範圍

- 系統：Linux client + NetworkManager、Docker Compose WireGuard server
- 影響：全隧道 VPN 無法使用，或 desktop agent / SSH 因 default route 被替換而暫時失聯
- 資料風險：低；錯誤路由可能中斷管理，不會損壞資料

## 排查

先確認 server container 有在監聽，並讓 router 對應到 host 的 container port：

```bash
docker compose ps
docker exec wireguard wg show
ss -lunp | grep 51820
```

從 client 確認 route 與 peer 狀態：

```bash
nmcli connection show wg0
wg show wg0
ip route get 1.1.1.1
```

若 server 收到 initiation 卻沒有 response，在 host 與 container 兩側各抓一次 UDP。這能分辨 Wi-Fi／router forwarding 與 peer authentication：

```bash
sudo tcpdump -ni any udp port 51820
docker exec wireguard tcpdump -ni any udp port 51820
```

確認 client 匯入設定後仍保有 PSK。不要顯示 key 本身；只檢查欄位存在：

```bash
nmcli --show-secrets -g wireguard.peers connection show wg0 \
  | grep -q 'preshared-key=' && echo 'PSK present'
```

## 根因

這類問題可分三層：

1. **kernel / interface**：更新 kernel 後尚未 reboot，WireGuard module 不存在時，NetworkManager 會在建立 `wg0` 時失敗。
2. **peer authentication**：以 `nmcli connection modify ... wireguard.peers` 寫入只有 endpoint 與 AllowedIPs 的 peer 字串，會取代完整 peer 定義並移除 PresharedKey。server 因此丟棄 initiation。
3. **full-tunnel routing**：`0.0.0.0/0` 讓 client default route 指向 `wg0`。若 server 缺 NAT／IP forwarding，或管理連線沒有保留路由，Internet 與遠端 agent 會失聯。

UDP 使用公開的 443 或其他允許 port，與 container 內仍聽 51820 並不衝突：router 只需將公開 port 轉送到正確 host port。

## 修正

先完成 kernel reboot／module 驗證，再從原始完整 WireGuard 設定重新匯入 NetworkManager，避免手動覆寫掉 PSK：

```bash
nmcli connection delete wg0
nmcli connection import type wireguard file /secure/path/wg0.conf
nmcli connection modify wg0 connection.autoconnect no
```

server 必須啟用 forwarding 與 NAT；官方 LinuxServer WireGuard image 的 server mode 會處理 container 內規則，但仍要確認 Docker capability、port mapping 與 router forwarding 都指向同一個 UDP port。

全隧道首次測試前，先安排 client 自動斷線，避免失去唯一管理路徑：

```bash
systemd-run --user --on-active=30s --unit=wireguard-safety-down \
  nmcli connection down wg0
nmcli connection up wg0
curl -4 https://api.ipify.org
```

確認出口與 DNS 正常後，取消 timer 或讓它自然執行。

## 驗證

- `wg show` 在 client 和 server 都有近期 handshake，transfer counters 會增加。
- server capture 看到 initiation 與 response，而不是只有單向 UDP。
- `curl -4 https://api.ipify.org` 顯示 VPN server 的公開出口。
- `ip route get 1.1.1.1` 經 `wg0`；DNS lookup 與 HTTPS request 可完成。
- 自動 down timer 可以確實斷開 `wg0`，恢復原本 Wi-Fi 路由。

## 下次先查

1. kernel 是否真的有 WireGuard module，再看 NetworkManager。
2. server 是否收到 UDP；收到但不回應時優先檢查 key／PSK，不要先換 port。
3. 匯入或修改 NM peer 後只驗 PSK 欄位存在，不輸出祕密。
4. 全隧道先排自動 down，再驗 handshake、route、DNS 與出口 IP。
