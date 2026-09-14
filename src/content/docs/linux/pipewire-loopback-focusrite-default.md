---
title: PipeWire 把 DroidCam Loopback 選成預設，Focusrite 語音沒有聲音
description: DroidCam 載入 snd-aloop 後，若 Focusrite 或其他實體裝置缺席，PipeWire 的預設輸入輸出可能落到虛擬 Loopback；先確認實體卡與實際預設路由。
date: 2026-09-14
tags:
  - arch-linux
  - pipewire
  - wireplumber
  - droidcam
  - focusrite
  - audio
status: fixed
system: linux-desktop
severity: medium
aliases:
  - snd-aloop default device
  - PipeWire Loopback Analog Stereo
  - Focusrite Scarlett 2i2 no sound
  - DroidCam Loopback microphone
---

## 快速結論

DroidCam 會載入 `snd-aloop`，供手機音訊建立虛擬聲卡。當原本的 USB 音訊介面（例如 Focusrite Scarlett）未連接、耳麥也未被偵測時，桌面 session 可能把唯一可用的 Loopback 設為預設輸入與輸出。

不要直接卸載 `snd-aloop`：這會破壞 DroidCam 的音訊路徑。先接回實體介面，確認 PipeWire 的預設 sink 和 source 都已指向它；必要時再從系統音效設定或 `wpctl` 選回正確裝置。

## 症狀

- 語音聊天收不到麥克風，或收到電腦播放聲／回授。
- 播放音訊沒有從耳機、喇叭或 USB 音訊介面輸出。
- 音效設定只顯示 `Loopback Analog Stereo`，或它帶有預設標記。
- USB 音訊介面拔掉後重開桌面 session，問題開始出現。

## 影響範圍

- 系統：使用 PipeWire、WirePlumber 與會載入 `snd-aloop` 的 Linux desktop。
- 輸入：語音 app 可能讀到虛擬 loopback，不是實體麥克風。
- 輸出：音訊可能被送到沒有實體接收端的虛擬 sink。
- 資料風險：低；這是 session routing 狀態，不會損壞音檔或裝置資料。

## 排查

先看 PipeWire 實際選中的 node，而不是只看桌面面板的音量圖示：

```bash
wpctl status
pactl info | rg 'Default Sink|Default Source'
pactl list sinks short
pactl list sources short
```

若預設顯示類似下列 node，表示應用程式會走虛擬 loopback：

```text
alsa_output.platform-snd_aloop.0.analog-stereo
alsa_input.platform-snd_aloop.0.analog-stereo
```

再確認實體裝置是否真的存在。USB 音訊介面可用 `lsusb` 與 ALSA card list 判斷：

```bash
lsusb
cat /proc/asound/cards
```

HDMI sink 出現在列表不代表它可播放。螢幕可能沒有喇叭或 audio-out，也可能沒有有效的 ELD；若需要確認，檢查 HDMI ELD：

```bash
for eld in /proc/asound/card*/eld#*; do
  printf '%s: ' "${eld##*/}"
  rg 'eld_valid|monitor_present|monitor_name' "$eld"
done
```

## 根因

`snd-aloop` 是 DroidCam 有意載入的虛擬音效卡，不是本身的故障。這次同時觀察到 USB Focusrite 未枚舉、主機板類比孔沒有插入偵測，以及 Loopback 成為預設輸入／輸出；重新接回 Focusrite 並建立新 session 後，預設路由恢復為 Focusrite。

這足以確認「沒有可用的預期實體裝置時，預設路由落到 Loopback」是本次故障模式。它不單獨證明特定桌面元件的自動選擇演算法有 bug。

## 修正

1. 接回要使用的 USB 音訊介面，或插入主機板耳機／麥克風。
2. 若剛完成 kernel、音效堆疊或 GPU driver 更新，完成更新後重開機，再登入桌面 session。
3. 在系統音效設定選擇實體輸出與麥克風；也可用 `wpctl status` 顯示的動態 ID 設為預設：

```bash
wpctl set-default <physical-sink-id>
wpctl set-default <physical-source-id>
```

保留 `snd-aloop`，但不要將它指定為一般播放或語音聊天的預設裝置。

## 驗證

確認實際預設已不是 Loopback，且實體裝置已出現在 topology：

```bash
wpctl status
pactl info | rg 'Default Sink|Default Source'
```

- sink 應為預期的 USB 介面、耳機或喇叭。
- source 應為預期的實體麥克風。
- `wpctl status` 中 Loopback 可以存在，但不應帶有輸入或輸出的預設 `*`。
- 以原本出問題的語音 app 實際播放與錄音測試，確認輸出可聽、麥克風電平有反應且沒有回授。

## 下次先查

先跑 `wpctl status`。若預設是 `platform-snd_aloop`，先查 USB／耳機是否實際連接，再選回實體 sink 與 source；不要先重裝 PipeWire 或刪除 DroidCam。
