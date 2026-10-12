---
title: HiNet GitHub 下載慢：用 WARP 繞路並保留 Tailscale DNS
description: 以 GitHub release 與 Cloudflare 下載對照辨識特定路徑瓶頸，設定 Linux WARP Traffic only 與 Tailscale 共存。
date: 2026-10-12
tags:
  - hinet
  - github
  - warp
  - tailscale
  - network
status: fixed
system: cloudflare-warp
severity: medium
aliases:
  - Twitter 圖片影片慢
  - Fastly 下載緩慢
  - warp tunnel_only
---

## 快速結論

GitHub 首頁正常，不代表 release 檔案下載也正常。本次在 HiNet 環境，同一個 GitHub release 下載從約 53 KB/s 提升至 WARP 下的 3.4 MB/s，約快 64 倍。這是一次對照結果，不是保證速度。

同機使用 Tailscale 時，WARP 採 `tunnel_only`（Traffic only），保留原有 DNS，再確認私有網段沒有進入 WARP。這次修正的是流量路徑；沒有證明是哪個互連、海纜或 CDN 節點故障。

## 症狀

使用者回報 X／Twitter 與 GitHub 很慢。GitHub 首頁可快速開啟，但 release 單連線下載在 15 秒內只收到約 0.8 MB，隨後逾時。

```text
curl: (28) Operation timed out after 15023 milliseconds
```

## 影響範圍

- Arch Linux 有線桌機，已有 Tailscale 與 MagicDNS。
- 已量測到 GitHub release 的吞吐量問題；X 圖片／影片為使用者回報，本輪沒有用相同媒體檔做前後測速。
- WARP Traffic only 會處理未排除的公網流量；內網與 Tailscale 必須另行驗證。

## 排查

先查介面、default route、代理環境變數與 DNS，確認測試走哪條路。不要把含憑證的代理網址貼進公開報告。

```bash
ip -brief address
ip route
cat /etc/resolv.conf
tailscale dns status
```

這次 DNS 由 Tailscale 管理；家中 gateway ping 平均 0.46 ms，5 次無掉包。這只支持當下 LAN 正常，不能排除所有本機問題。

GitHub 首頁約 0.29 秒完成，DNS 查詢也沒有顯著延遲。接著測實際檔案，並加入不同目的地對照，避免只憑首頁或單一下載判斷整條線路。

以下 `release_url` 應換成自己實際卡住的公開 release 下載網址；前後都用同一個檔案與 range。

```bash
release_url='https://github.com/espressif/crosstool-NG/releases/download/esp-14.2.0_20260121/xtensa-esp-elf-14.2.0_20260121-x86_64-w64-mingw32.zip'
curl -sS -L --range 0-9999999 --max-filesize 12000000 \
  --connect-timeout 5 --max-time 15 -o /dev/null \
  -w 'code=%{http_code} bytes=%{size_download} Bps=%{speed_download} total=%{time_total}\n' \
  "$release_url"

curl -sS --max-time 15 -o /dev/null \
  -w 'code=%{http_code} Bps=%{speed_download} total=%{time_total}\n' \
  'https://speed.cloudflare.com/__down?bytes=10000000'
```

`speed_download` 單位是 bytes/s。range 測試應檢查 HTTP 206；若伺服器忽略 range，不能把不同大小的完整下載當成同一測試。

## 根因

最小可支持的解釋是：當時直連 GitHub release 的路徑有明顯吞吐量瓶頸，而不同目的地與 WARP 路徑表現較好。

沒有進行足以定位故障點的 traceroute／封包分析，也沒有營運商確認。不能由此推定 Fastly 整體故障、HiNet 對單連線限速，或某條海纜中斷。

## 修正

本次檢閱 AUR `cloudflare-warp-bin` PKGBUILD，確認下載來自 Cloudflare 官方套件站並通過 SHA-256，再安裝 `2026.8.2100.0-1`。Arch 的 AUR 包裝與官方支援的 Linux 發行版須分開看；其他發行版依 [Cloudflare Linux 安裝文件](https://developers.cloudflare.com/warp-client/get-started/linux/)操作。

安裝後啟動服務，僅首次註冊時執行 `registration new`：

```bash
sudo systemctl enable --now warp-svc
warp-cli --accept-tos registration new
warp-cli --accept-tos mode tunnel_only
warp-cli --accept-tos tunnel ip list
```

依 [WARP 模式文件](https://developers.cloudflare.com/warp-client/warp-modes/)，Traffic only 保留作業系統 DNS，DNS only 則不改變一般下載流量的路徑。實際 CLI 名稱以 `warp-cli mode --help` 為準。

本次預設排除清單已包含 LAN 私有網段、`100.64.0.0/10` 與私有 IPv6，沒有重設 Tailscale DNS，也沒有改 hosts。

遠端操作先安排自動斷線保護，再連線：

```bash
sudo systemd-run --unit=warp-setup-rollback --on-active=180s \
  /usr/bin/warp-cli --accept-tos disconnect
warp-cli --accept-tos connect
```

`connect` 回 Success 只表示請求成功，須再等 `status` 顯示 Connected。這次保護 timer 曾觸發；重新連線後才完成驗證。保護期限要留足測試時間，timer 到期造成的斷線不能當成 WARP 自身故障。

## 驗證

```bash
warp-cli --accept-tos status
curl -sS --max-time 12 https://www.cloudflare.com/cdn-cgi/trace
cat /etc/resolv.conf
# 下行 peer-name 換成既有 Tailscale 裝置名稱
tailscale ping --c 1 --timeout 5s peer-name
```

確認 `Connected`、`Network: healthy`，trace 為 `warp=on`；本次節點為 `TPE`。DNS 仍是 Tailscale resolver，既有 peer ping 約 2 ms。

| 測試 | 直連 | WARP |
| --- | --- | --- |
| 同一 GitHub release，請求前 10 MB | 53,097 B/s，15 秒逾時 | 3,396,643 B/s，約 2.94 秒完成 |
| Cloudflare 10 MB 對照 | 6,261,564 B/s | 5,250,870 B/s |

X 首頁 HTTP 200；這不能替代圖片與影片驗收。服務已 enabled，尚未實測 reboot 後自動連線。

若保護 timer 仍在，外網、DNS 與內網都驗證完成後才取消：

```bash
sudo systemctl stop warp-setup-rollback.timer
```

若 timer 已執行並卸載，`Unit ... not loaded` 表示沒有可停止的 timer，可用 `systemctl list-timers --all` 確認。日常開關：

```bash
warp-cli --accept-tos disconnect
warp-cli --accept-tos connect
```

## 下次先查

1. 測實際卡住的檔案，加入不同目的地對照，不只測首頁。
2. 確認 `warp=on`，以同一下載重測；多測幾次排除時段波動。
3. 檢查 Tailscale DNS、peer 連線與 LAN；WARP 正常不代表內網正常。
4. 若 WARP 也慢，先關閉比較；保留結果再查路由，不直接套用本次原因。
