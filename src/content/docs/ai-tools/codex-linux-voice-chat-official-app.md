---
title: Codex Linux 語音不可用：從舊移植版改用官方 Voice chat
description: Linux 上看到 Dictation is not available on this device 時，先分清聽寫與完整語音對談，再核對實際 client，透過官方新版與獨立 profile 驗證 Voice chat。
date: 2026-10-21
tags:
  - codex
  - chatgpt
  - linux
  - voice
  - arch-linux
status: fixed
system: codex-desktop
severity: medium
aliases:
  - Dictation is not available on this device
  - Codex Linux Voice chat
  - Start new voice chat
  - ChatGPT Linux 語音互動
---

## 快速結論

Linux 上的 Codex 顯示 `Dictation is not available on this device`，不代表麥克風故障，也不能直接推論完整 Voice chat 不支援 Linux。本次實際使用的是舊版第三方 `codex-desktop-linux`；改用官方 `chatgpt-bin`、建立獨立 profile 後，原帳號出現完整語音入口，成功建立即時連線，使用者也確認對談正常。

本次驗證日期為 2026-10-21。官方功能仍可能受帳號、workspace 與 rollout 影響；這篇記錄的是一台 Arch Linux 桌機的成功案例，不保證所有 client、遠端任務與帳號都能使用。

## 症狀

設定的 Voice 頁面只有 Dictation 區塊，內容為：

```text
Dictation is not available on this device
```

使用者要的是像手機一樣全程語音對談，不是把錄音轉成 prompt 文字後再送出。

另一個獨立症狀是點回覆旁的朗讀按鈕沒有聲音，log 顯示本機 TTS 引擎缺少依賴。修復朗讀不等於啟用完整 Voice chat。

## 影響範圍

- 環境：Arch Linux、COSMIC Wayland、外接 USB 音訊介面。
- 原 client：第三方 `codex-desktop-linux 26.707.31428.r1301.g5fc3961d-1`。
- 修復後 client：官方 `chatgpt-bin 26.1016.51333-1`，保留原本的 Codex CLI。
- 影響：舊 client 沒有提供這次需要的完整語音操作入口。
- 邊界：本次驗證本機 Codex 任務，沒有驗證 SSH remote 任務的語音接手。

## 排查

### 先確認控制端與實際安裝的 client

若工作是在遠端 shell 執行，遠端的音訊裝置清單只反映遠端主機，不能用它判斷桌面控制端的麥克風。

在實際開啟 GUI 的電腦檢查套件與啟動程序：

```bash
pacman -Q codex-desktop-linux openai-codex
pacman -Q chatgpt-bin
pacman -Qi codex-desktop-linux
ps -eo pid,comm,args | rg 'codex-desktop|/chatgpt/ChatGPT'
```

本次套件描述明確標示第三方 soft-fork、固定上游版本、沒有自動更新。CLI 已更新，不代表桌面 client 也已更新。

### 再確認麥克風路由

```bash
wpctl status
wpctl get-volume @DEFAULT_AUDIO_SOURCE@
pactl get-default-source
pactl list sources short
```

本次 USB 音訊介面已枚舉，預設 source 是實體 Mic1，未靜音，沒有誤選 DroidCam Loopback。因此先追查 client 功能限制；這些檢查尚不能單獨證明麥克風有實際收到聲音。

### 對準畫面上的限制判斷

從舊版安裝檔的 bundle 追到設定頁：當後端回傳 `supported: false`，前端就顯示截圖中的 unsupported 提示。舊版全域聽寫的支援判斷只允許 macOS 與 Windows：

```js
return process.platform === 'darwin' || process.platform === 'win32';
```

這段只解釋該版的 Dictation 提示，不是對所有語音功能與新版 Linux client 的通用結論。不要透過改這個判斷、硬開 UI flag 就宣稱完成支援。

### 分開辨認三種功能

| 功能 | 用途 | 本次的判斷 |
| --- | --- | --- |
| Dictation | 語音轉成 prompt 文字 | 舊版設定頁受平台限制 |
| Read aloud | 把既有文字回覆念出來 | 舊移植版的本機 TTS 缺少依賴 |
| Voice chat | 即時雙向語音對談 | 官方新版出現入口並實測成功 |

[官方 Voice 文件](https://learn.chatgpt.com/docs/features/voice) 明確區分對談與聽寫，也提醒既有任務的功能可用性受版本與 rollout 影響。

## 根因

這次需要更換的是桌面 client。原本使用的舊移植版，其 Voice 設定頁只有受平台限制的聽寫區塊；它的缺失依賴錯誤則來自另一套朗讀功能。系統音訊路由沒有提供足以解釋 unsupported 提示的證據。

官方新版在同一台電腦、同一帳號與同一套音訊裝置下能建立完整即時語音連線，支持這次的修法。但不能只由這組新舊對照，進一步斷言舊版每個內部語音元件都不存在。

## 修正

### 安裝官方 Linux client

從[官方 Linux 安裝文件](https://learn.chatgpt.com/docs/linux/linux-app)確認當前支援的發行版與安裝方式，不以第三方包名或舊下載網址取代。

Arch 官方入口為：

```bash
curl --proto '=https' --tlsv1.2 -fL -o install-arch.sh \
  https://persistent.oaistatic.com/codex-app-prod/linux/install-arch.sh
# 先閱讀腳本，再執行官方安裝流程。
sudo bash install-arch.sh
```

官方腳本會設定簽署套件來源、驗證套件，並執行完整系統更新。應先看清交易內容。

本次先下載官方腳本列出的 release，以隔離 keyring 比對腳本內的完整 signing-key fingerprint 並驗證套件簽章，再解壓測試。確認功能可用後，安裝同一份已驗證的官方套件與缺少的 Vulkan 軟體渲染依賴；套件安裝 hook 設定了 OpenAI 更新來源。不要略過簽章檢查或只因下載成功就安裝。

### 新舊 client 使用不同 profile

官方版啟動時也可能使用 Codex 的設定目錄。新舊 client 並存時，以明確的 `--user-data-dir` 分開 Electron profile，避免直接共用瀏覽器資料：

```sh
#!/bin/sh
exec /usr/bin/chatgpt \
  --user-data-dir="$HOME/.config/ChatGPT-Official" \
  "$@"
```

將 wrapper 設成可執行，再讓使用者層的 desktop entry 指向它，名稱設成容易區分的「ChatGPT 官方版」。desktop entry 的 `Exec=` 使用 wrapper 的絕對路徑，不依賴 shell 展開 `~` 或 `$HOME`。

本次為 GUI 驗收另加 `--force-renderer-accessibility`，這是輔助檢查用的設定，不是啟用語音的必要條件。

獨立 Electron profile 不代表所有資料都隔離：本次仍沿用同一個 Codex CLI 登入與本機專案。保留舊版及原 autostart，沒有在功能驗證前取代既有啟動流程。

### 完成 Voice chat 首次設定

在官方版點 `Start new voice chat`，完成介紹與聲音選擇，再啟動對談。這次沒有修改系統音訊路由，也沒有安裝舊移植版的本機朗讀模型。

## 驗證

用四層證據區分「有按鈕」與「真的可用」：

1. **介面**：官方版有 `Start new voice chat`，啟動後出現麥克風、喇叭與停止對談控制。
2. **即時連線**：log 記錄建立 RTC call、套用 SDP answer，並收到 `realtime_session_started`；不是只有程序存活。
3. **收音來源**：啟動時以 `pactl list source-outputs short` 確認有錄音 stream，再對照 `pactl list sources short`，來源確實是實體 Mic1。
4. **使用者驗收**：使用者在正式安裝的新版中直接語音互動，回報正常。

測試後使用 `Stop voice chat`，並確認錄音 stream 已消失。正式啟動沒有保留臨時的除錯連接埠。

本次已確認本機對談正常；SSH remote、其他聲音與遠端主機接手仍需分別實測。

## 下次先查

1. 使用者要的是聽寫、朗讀，還是即時對談？
2. GUI 在哪台電腦？實際 client 是官方版還是移植版，版本為何？
3. 新聊天與既有任務是否都有 Voice chat 入口？
4. 預設 source 是否為實體麥克風、是否靜音？
5. 啟動後是否有即時 session、正確錄音 stream，且能實際聽到回話？
6. 若只有 remote 任務失敗，再單獨查遠端任務／host 的支援與版本，不重改已驗證的本機音訊。
