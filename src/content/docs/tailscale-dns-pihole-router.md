---
title: Tailscale 接管 DNS 後查詢未必經過 Pi-hole
description: 在 Linux 比對 Tailscale、路由器和 Pi-hole 的 DNS 回覆，確認實際上游與封鎖是否生效。
date: 2026-11-22
category: network
tags:
  - tailscale
  - pi-hole
  - dns
  - linux
status: fixed
system: tailscale
severity: low
aliases:
  - Tailscale DNS bypasses Pi-hole
  - MagicDNS Pi-hole 廣告封鎖
---

## 快速結論

Linux 的網路介面即使列出 Pi-hole，系統仍可能把查詢交給 Tailscale。當 `/etc/resolv.conf` 指向 `100.100.100.100`，用 `tailscale dns status` 查看一般網域實際可用的上游，再透過系統預設 DNS 測一次封鎖。

## 症狀

家中兩台 Pi-hole 都能回答 DNS 查詢，桌機卻出現預期外的封鎖頁。原始網域未知，因此個別頁面的來源無法確認。可重現的問題是系統的 DNS 上游包含 ISP 解析器，讓查詢有機會繞過 Pi-hole。

## 影響範圍

這次驗證的是啟用 Tailscale DNS 的 Linux 桌機，且桌機當時連著家中有線網路。若瀏覽器使用自訂的安全 DNS，需另外檢查瀏覽器的解析路徑。

## 排查

```bash
nmcli -f GENERAL.DEVICE,IP4.DNS,IP6.DNS device show
cat /etc/resolv.conf
tailscale dns status
```

`nmcli` 顯示有線介面取得的 DNS。這台機器的 `/etc/resolv.conf` 由 Tailscale 產生，列出 `100.100.100.100`。`tailscale dns status` 的 `Resolvers` 則列出路由器與 ISP DNS。

將 `router_ip`、`pihole_ip` 和 `isp_dns_ip` 設成各自的位址，再用同一個測試網域比對。若 Pi-hole 封鎖清單沒有 `doubleclick.net`，改用已知會命中的網域。

```bash
dig doubleclick.net. A +noall +comments +answer +stats
dig @"$router_ip" doubleclick.net. A +noall +comments +answer +stats
dig @"$pihole_ip" doubleclick.net. A +noall +comments +answer +stats
dig @"$isp_dns_ip" doubleclick.net. A +noall +comments +answer +stats
```

兩台 Pi-hole 直接查詢都回 `0.0.0.0` 及 `EDE: 15 (Blocked): (gravity)`。路由器與系統查詢當下也回 `0.0.0.0`，ISP DNS 卻回公開 IP。單次封鎖成功只能證明該次查詢的結果，還要比對上游清單。

## 根因

Tailscale 接管系統 DNS 時，有線介面的 DNS 清單與 Tailscale 的上游是兩份設定。這次 Tailscale 同時列出路由器與 ISP DNS，而兩者的封鎖結果不同。多個上游的查詢先後依客戶端行為而異。 [Tailscale 的 DNS 上游順序說明](https://tailscale.com/docs/reference/dns-in-tailscale#the-order-of-dns-resolvers)

## 修正

在 Tailscale 管理介面的 DNS 設定移除 ISP 解析器，保留能轉送查詢至 Pi-hole 的家用路由器作為 Global nameserver，並保留 MagicDNS。若要在家外使用這個設定，客戶端同樣要能連到路由器的 DNS 服務。另一種部署方式是使用可從 tailnet 存取的 Pi-hole 位址。 [Tailscale 的 Pi-hole 設定指南](https://tailscale.com/docs/solutions/block-ads-all-devices-anywhere-using-raspberry-pi#step-4-set-raspberry-pi-as-the-dns-server-for-your-tailnet)

## 驗證

更新送達後，`tailscale dns status` 的 `Resolvers` 只剩路由器。系統預設查詢從 `100.100.100.100` 取得 `gravity` 封鎖回覆，普通公開網域與 MagicDNS 裝置名稱也能解析。家外連線與原始封鎖頁沒有實測。

## 下次先查

在客戶端先跑 `tailscale dns status`，再用不帶 `@伺服器` 的 `dig` 查看系統 DNS 回覆。直接指定 Pi-hole 的 `dig` 則用來確認 Pi-hole 本身能否正常回答。
