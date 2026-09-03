---
title: Arch paru AUR RPC EOF 與 Chaotic-AUR geo mirror timeout
description: Diagnose paru AUR RPC unexpected EOF separately from a Chaotic-AUR geo mirror timeout, then restore reliable package upgrade checks.
date: 2026-08-03
tags:
  - arch-linux
  - paru
  - aur
  - chaotic-aur
  - networkmanager
status: fixed
system: desktop
severity: medium
aliases:
  - paru unexpected EOF
  - aur rpc EOF
  - chaotic-aur mirror timeout
---

## 快速結論

`paru -Syu` 同時出現 Chaotic-AUR mirror timeout 與 AUR RPC `unexpected EOF` 時，先把它們當成兩個問題處理。

- `geo-mirror.chaotic.cx` 若轉址到不可達的區域鏡像，停用該 geo mirror，保留可驗證能下載的 CDN mirror。
- AUR RPC EOF 若是間歇性，先直接重跑；若 `nmcli` 明確警告 client 與 NetworkManager daemon 版本不一致，重啟 NetworkManager 後再測。

2026-09 補充：若 IPv6 沒有 default route，先以 `curl -4` 排除 IPv6；即使改走已驗證的 IPv4 或 VPN，特定 AUR Git clone / TLS 連線仍可能偶發 EOF。這代表連線路徑或前端的間歇性中斷，不代表某個 PKGBUILD 壞掉；對大型更新改採單包、順序重試，避免平行 clone 同時失敗。

不要常態使用 `-Syyu`。正常更新用 `paru -Syu`；雙 `y` 只在資料庫確實需要強制重抓時使用。

## 症狀

```text
error: failed retrieving file 'chaotic-aur.db' from geo-mirror.chaotic.cx : Connection timed out after 10000 milliseconds

error: error sending request for url (https://aur.archlinux.org/rpc): error trying to connect: unexpected EOF
```

- 官方 repo 資料庫可同步，唯獨 `chaotic-aur.db` timeout。
- `paru -Syu` 在 `Looking for AUR upgrades...` 中斷。
- `paru -Qua` 或重跑 `paru -Syu` 可能偶爾成功，表示 AUR EOF 未必是持續性 outage。
- `git fetch` 或 `git clone https://aur.archlinux.org/<package>.git` 也可能在 TLS handshake / `SSL_read` 時 EOF，但同一包稍後可成功。

## 影響範圍

- 系統：Arch Linux desktop，使用 paru 與 Chaotic-AUR
- 影響：套件資料庫同步或 AUR 升級解析中斷；尚未進 transaction，不會半套安裝
- 資料風險：低

## 排查

先分別測 AUR RPC、mirror 的 IPv4 連線與實際轉址目標：

```bash
curl -4 --connect-timeout 8 --max-time 20 \
  -o /dev/null -w 'HTTP %{http_code}; %{remote_ip}\n' \
  'https://aur.archlinux.org/rpc/v5/info?arg[]=paru'

curl -4 -L --connect-timeout 5 --max-time 15 \
  -o /dev/null -w '%{http_code} %{url_effective}\n' \
  'https://geo-mirror.chaotic.cx/chaotic-aur/x86_64/chaotic-aur.db'
```

若 AUR 的 IPv4 request 與 TLS handshake 可成功、但 paru 仍偶發 EOF，先確認 NetworkManager 是否提示 binary/daemon 未同步：

```bash
nmcli -g GENERAL.STATE,GENERAL.CONNECTION,IP4.GATEWAY device show wlp3s0
nmcli --version
```

`nmcli` 顯示「client 與 NetworkManager versions don't match」時，表示套件已更新但執行中的 daemon 尚未重啟。

同時確認 IPv6 是否真有可用 default route；沒有時先把測試固定為 IPv4，避免把無路由的 IPv6 當成 TLS 問題：

```bash
ip -6 route show default
curl -4 --connect-timeout 8 --max-time 20 -I https://aur.archlinux.org/
git ls-remote https://aur.archlinux.org/<package>.git HEAD
```

## 根因

這是兩條獨立路徑的故障：

1. Chaotic-AUR 的 geo mirror 會依來源網路轉址；本例選到的區域鏡像無法建立 HTTPS 連線。直接改用 CDN mirror 可完成資料庫下載。
2. AUR RPC 或 Git HTTPS 的 EOF 是 TLS 連線被提前關閉。它可能是短暫的上游、Wi-Fi path 或前端連線狀態，而非 AUR packages 壞掉；一次成功也不保證下一個平行 clone 成功。當本機另有 NetworkManager client/daemon 版本不一致或 IPv6 無 default route 時，先修正／排除該網路 stack。

不要把「重跑後成功」誤判為 geo mirror 已可用；也不要因 AUR EOF 去修改 AUR package 或手動刪資料庫。

## 修正

在 `/etc/pacman.d/chaotic-mirrorlist` 停用 geo mirror，保留 CDN mirror：

```ini
#Server = https://geo-mirror.chaotic.cx/$repo/$arch
Server = https://cdn-mirror.chaotic.cx/$repo/$arch
```

重新同步資料庫驗證鏡像設定：

```bash
sudo pacman -Syy --dbonly
```

僅在 `nmcli` 顯示版本不一致時重啟 NetworkManager。這會讓 Wi-Fi 短暫中斷：

```bash
sudo systemctl restart NetworkManager
```

恢復連線後，先用不安裝的 AUR-only 升級解析驗證：

```bash
printf 'n\n' | paru -Sua
```

確認能列出候選套件後，再執行一般更新：

```bash
paru -Syu
```

若大量平行 clone 只要其中幾個就 EOF，改成單包重試，讓已完成的包不必重跑：

```bash
for package in package-a package-b; do
  for attempt in 1 2 3 4 5; do
    paru -S --needed "$package" && break
    sleep 10
  done
done
```

## 驗證

- `pacman -Syy --dbonly` 能同步 `chaotic-aur`，無 geo mirror timeout。
- `nmcli` 顯示 Wi-Fi 為 `100 (connected)`，並不再警告 NetworkManager version mismatch。
- `printf 'n\n' | paru -Sua` 能列出 AUR 升級並到達確認提示。
- `paru -Syu` 可完成升級檢查；若只剩短暫 EOF，重跑一次再判斷 AUR 上游狀態。
- 單一 `git ls-remote` 或 `paru -S --needed <package>` 在重試後可完成；不要把一次 EOF 視為 package source 永久不可用。

## 下次先查

1. 先看錯誤是在 repo mirror 還是 AUR RPC；兩者分開處理。
2. `curl -4 -L` 追 geo mirror 的最終轉址，不只看 geo host 能否回 3xx。
3. 若 `nmcli` 警告 daemon 版本不一致，重啟 NetworkManager 並等 Wi-Fi connected。
4. 用 `paru -Sua` 驗證 AUR resolver，再跑 `paru -Syu`。
5. 大量 AUR 更新反覆只有個別 clone EOF 時，改為單包順序重試，不要清掉既有 clone 或強迫 `-Syyu`。
