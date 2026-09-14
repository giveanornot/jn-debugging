---
title: 雙機 ddclient 保留舊 A record 而持續更新失敗
description: Redundant ddclient instances can keep retrying deleted Cloudflare A records when one host retains a pre-wildcard configuration.
date: 2026-09-14
tags:
  - ddclient
  - cloudflare
  - docker
  - dns
  - wildcard-dns
  - high-availability
status: fixed
system: ddclient
severity: medium
aliases:
  - ddclient no A record at Cloudflare
  - redundant DDNS configuration drift
  - Cloudflare wildcard DDNS stale hostname
---

## 快速結論

兩台主機同時跑 ddclient 可以作為 DDNS 備援，但兩端的 hostname 清單必須完全一致。若 DNS 已從每個服務各自的 A record 收斂為 wildcard A record，其中一台仍嘗試更新已刪除的名稱，就會反覆出現 `no 'A' record at Cloudflare`。

先以目前有效的 wildcard 規劃建立一份最小清單，保留因 MX 或 TXT 衝突而需要的 explicit A record。備份舊設定後，將每個 ddclient instance 同步為這份清單；不必停止另一台備援機。

## 症狀

- ddclient container 持續運行，部分 record 顯示成功。
- 同一輪 log 又反覆出現 Cloudflare 找不到 A record。
- 公開網站仍可能正常，因為有效 wildcard record 仍在更新。

```text
SUCCESS: [*.example.com]> IPv4 address is already set
FAILED:  [old-service.example.com]> cannot set IPv4: no 'A' record at Cloudflare
```

## 影響範圍

- 服務：Docker Compose 中的 ddclient 與 Cloudflare DNS
- 影響：每次輪詢產生失敗日誌；WAN IP 變更時，已遷移至 wildcard 的服務仍可用，但設定漂移會掩蓋真正的 DDNS 失敗
- 資料風險：低；僅更新 DNS record，未修改應用資料
- 備援影響：兩台在同一 NAT 出口時通常寫入同一個 IP，重複更新無立即可用性問題，但應只維護一份共同的 record 清單

## 排查

先確認每台是否都在跑 container，而不是把 systemd 的 `inactive` 誤判為故障：

```bash
systemctl is-active ddclient || true
docker ps --format '{{.Names}}\t{{.Image}}\t{{.Status}}' \
  | grep -Ei 'ddclient|ddns'
```

不要輸出 API token。只列出設定中的 zone 與 hostname，並比對兩台的差異：

```bash
awk -F= '
  /^zone=/ { print }
  $0 !~ /=/ && $0 !~ /^[[:space:]]*(#|$)/ { print "hostname=" $0 }
' /path/to/ddclient.conf
```

查看最近更新結果；用精準 pattern，避免輸出完整設定或環境變數：

```bash
docker logs --since 2h ddclient-ddclient-1 2>&1 \
  | grep -Ei 'SUCCESS|FAILED|no .A. record|setting IPv4'
```

最後從公共 resolver 驗 wildcard 實際是否生效。不同層級的 wildcard 要分開測：

```bash
for host in test.example.com test.dev.example.com blog.example.net; do
  printf '%s -> ' "$host"
  dig +short A "$host" @1.1.1.1
done
```

## 根因

DNS 改成 wildcard 後，原本每個服務專用的 A record 會被刪除。ddclient 不會依 Cloudflare 現況自動收斂自己的 hostname 清單，因而持續嘗試更新不存在的 record。

高可用部署若由不同時間的設定檔建立，常見狀況是一台已改成 wildcard 清單，另一台仍留著舊的逐服務清單。兩台都能更新共同的 record，會讓問題看似間歇性正常。

## 修正

先定義唯一的有效記錄集合。此範例包含根層 wildcard、兩層子網域 wildcard，以及受 MX/TXT 影響而必須明確保留的名稱：

```ini
zone=example.com
*.example.com, *.dev.example.com, *.homelab.example.com

zone=example.net
*.example.net, blog.example.net
```

在每一台主機先保留可回復備份，再只替換 hostname 行，避免覆寫各自主機的 API credential：

```bash
conf=/path/to/ddclient.conf
cp -p "$conf" "$conf.bak-before-wildcard-sync-$(date +%Y%m%dT%H%M%S%z)"
# Edit only the hostname lines, then keep mode 0600.
chmod 600 "$conf"
```

若使用 Compose，僅重建 ddclient service，不 pull image、也不重啟其他服務：

```bash
cd /path/to/ddclient-compose
docker compose up -d --force-recreate ddclient
```

## 驗證

- 兩台的 hostname 清單相同，且只包含有效 wildcard／必要 explicit A record。
- 每台 container 都是 `running`，重啟次數沒有增加。
- 初次啟動後，每個 record 都出現 `SUCCESS`，且沒有 `FAILED` 或 `no 'A' record`。
- 公共 resolver 對各層級 representative hostname 都回應目前 WAN IP。
- 設定檔仍為 `0600`，且 log、shell history 與 runbook 中都沒有 API token。

## 下次先查

1. 先看 `docker ps`，確認實際是 container 版還是 systemd 版 ddclient。
2. 列出兩台的 hostname 行，直接比較是否設定漂移。
3. 搜 `no 'A' record at Cloudflare`，先移除已刪除 record 的舊目標。
4. 用公共 DNS 查 root wildcard、每個多層 wildcard 與必要 explicit A record。
5. 對兩台都驗證成功後，保留雙機運行；不要為了消除重複更新而關閉既定備援。
