---
title: Android Quick Share 在 Linux 找不到裝置時的 P2P 與藍牙替代方案
description: When Android Quick Share cannot discover a Linux desktop, distinguish LAN-only clients from Wi-Fi P2P limits and fall back to Bluetooth OBEX transfer.
date: 2026-08-11
tags:
  - android
  - quick-share
  - bluetooth
  - linux-desktop
  - networkmanager
status: investigating
system: linux-desktop
severity: low
aliases:
  - rquickshare same Wi-Fi
  - Linux Quick Share device not found
  - Android Quick Share Bluetooth fallback
  - nearby Fast Initiation scanning failed
---

## 快速結論

Android 原生 Quick Share 對 Linux 沒有官方 client。`rquickshare` 只支援同一個 Wi-Fi LAN；若手機不在同網路，不能期待它透過 Wi-Fi Direct 自動被發現。

另一個實驗性 client `nearby` 可嘗試 BLE、Bluetooth 與 hotspot，但它需要藍牙探索與可用的 Wi-Fi P2P／hotspot 路徑。若手機仍看不到電腦，不要把一般藍牙配對誤當成 Quick Share 已配對；改用 Bluetooth OBEX 傳檔是穩定的無同網路 fallback。

## 症狀

- Android 手機的 Quick Share 目標清單沒有 Linux 電腦。
- 電腦與手機已開啟藍牙，甚至已在系統藍牙設定中配對，Quick Share 仍不出現。
- `nearby` 啟動後保留類似訊息：

```text
Fast Initiation scanning failed with error 5
```

## 影響範圍

- 系統：使用 BlueZ 與 NetworkManager 的 Linux desktop
- 對端：Android 原生 Quick Share
- 影響：無法可靠以 Quick Share 在不同 Wi-Fi 間傳檔
- 資料風險：低；失敗只會中止探索或傳輸

## 排查

先確認 `rquickshare` 的限制。它會用 mDNS 在 LAN 發現裝置，因此兩端必須在同一個網路：

```bash
ip -4 addr show
avahi-browse -art | rg '_FC9F5ED42C8A|Android'
```

`nearby` 若正在跑，先確認 BlueZ 確實有 LE advertisement，而不是只確認一般藍牙已開啟：

```bash
bluetoothctl show
systemctl --user status nearby-quickshare.service
```

重點欄位包括 `Powered: yes`、`ActiveInstances` 大於零。再查 Wi-Fi driver 是否報告 P2P mode：

```bash
iw list | sed -n '/Supported interface modes:/,/Band 1:/p'
```

如果清單沒有 `P2P-client`、`P2P-GO` 或 `P2P-device`，不要假設 Wi-Fi Direct 可以用。AP mode 不等於 Wi-Fi P2P。

## 根因

這是兩層限制疊加：

1. `rquickshare` 是 LAN-only 實作，不能在不同網路時建立原生 Quick Share 的直連。
2. Linux 的實驗性 Quick Share client 要靠 BLE 觸發探索，並依硬體／driver 選 Wi-Fi P2P 或 hotspot 作高速資料通道。BLE advertising 已存在不代表手機一定會完成協商；一般藍牙配對也不會強制 Android 把該裝置列入 Quick Share。

## 修正

若一定要使用 Quick Share，最可靠的是讓手機和電腦暫時加入同一個 LAN，例如讓電腦加入手機熱點後使用 `rquickshare`。

若不想共用 Wi-Fi，啟用 BlueZ 的 OBEX 接收服務，改從 Android 分享選單選「藍牙」。以 Blueberry agent 為例：

```bash
gsettings set org.blueberry obex-enabled true
systemctl --user start obex.service
/usr/lib/blueberry/blueberry-obex-agent.py
```

在 Android 選擇已配對的電腦並送出檔案；電腦端會要求確認，檔案通常存入 Downloads。這不是 Quick Share，但不需要同一個 Wi-Fi 或網際網路。

若需要維持原生 Quick Share 且不共用 Wi-Fi，改用已確認支援 Linux Wi-Fi P2P 的無線網卡，再重新測試實驗性 client。不能只依 Wi-Fi chipset 規格推測，必須以 `iw list` 的模式為準。

## 驗證

- 同網路時，`rquickshare` 與 Android 互相出現在 Quick Share 清單。
- 使用 `nearby` 時，確認手機能看到電腦，並測試一個小檔案可完成傳輸；若仍只看到 BLE advertisement 而沒有目標，不視為修好。
- Bluetooth fallback：Android 分享選單選藍牙後，Linux 出現接收確認，檔案寫入 Downloads。

## 下次先查

1. 先分辨需求是「原生 Quick Share」還是「不共用 Wi-Fi 傳檔」。
2. `rquickshare` 直接視為同網路方案，不花時間測 Wi-Fi Direct。
3. `nearby` 有掃描錯誤或手機看不到目標時，檢查 `ActiveInstances` 與 `iw list` 的 P2P mode。
4. 需要立即傳檔時，改走 Bluetooth OBEX 或 USB，而不是反覆重新配對。
