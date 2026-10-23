---
title: Codex Linux 貼上截圖卡住：切換原生 Wayland
description: COSMIC Wayland 上的 Codex 桌面版貼截圖後無回應，檢查剪貼簿與 XWayland 路徑，改用原生 Wayland 並保存啟動日誌。
date: 2026-10-23
tags:
  - codex
  - chatgpt
  - linux
  - cosmic
  - wayland
  - clipboard
status: fixed
system: codex-desktop
severity: medium
aliases:
  - Codex 貼圖片當機
  - ChatGPT Linux 貼截圖卡住
  - XWayland clipboard freeze
---

## 快速結論

本次在 Arch Linux、COSMIC Wayland 的 Codex 桌面版，貼上截圖後視窗卡住。將應用程式啟動參數改為 `--ozone-platform=wayland`，避開原先的 X11 相容路徑後，使用者回報看起來已恢復。

這是已獲使用者確認的 workaround；沒有取得卡住當下的堆疊，也未做受控 X11／Wayland A/B，尚不能證實是哪個剪貼簿或 compositor 元件出錯。

## 症狀

- 初始描述是貼圖片「當機」，追問後確認是視窗仍在但卡住，並非直接關閉。
- 圖片來自截圖，貼上動作觸發問題。
- 應用程式仍有存活程序，沒有對應的 Crash Reports dump 或系統 core dump。

## 影響範圍

- 系統：Arch Linux、COSMIC Wayland。
- Client：包含 Codex 的官方 ChatGPT Linux 桌面版，套件 `chatgpt-bin 26.1016.61520-1`。
- 原本 renderer 命令列包含 `--ozone-platform=x11`。
- 使用獨立 Electron profile；修正只改使用者層啟動 wrapper，沒有修改套件內程式或清除聊天資料。

## 排查

### 釐清卡住還是程序崩潰

```bash
pacman -Q chatgpt-bin
ps -eo pid,comm,args | rg '/chatgpt/ChatGPT|ozone-platform'
coredumpctl list --since today --no-pager
```

本次應用程式仍存活，Crash Reports 目錄沒有 dump。先前短時間內結束的啟動紀錄無法直接證明與貼圖有關，也不能把未產生 core 當作沒有故障。

### 確認桌面 session 與圖片剪貼簿

```bash
printenv XDG_SESSION_TYPE XDG_CURRENT_DESKTOP WAYLAND_DISPLAY DISPLAY
wl-paste --list-types
```

本次 session 是 Wayland、桌面為 COSMIC，剪貼簿有 `image/png`。另以 `wl-paste --type image/png` 讀取資料並檢查 PNG signature／IHDR，得到 167,220 bytes、1045 × 586；這支持圖片並不大，但不是完整圖片解碼驗證。

不要因為存在 `DISPLAY` 就判定整個桌面是 X11；需另外檢查應用程式實際使用的 backend。

### 日誌與輔助 probe 的界線

既有應用程式 stdout／stderr 指向 `/dev/null`，無法用它還原卡住瞬間。舊移植版留下的 log 也不能當成現行官方版的證據。

曾用獨立 Electron 程序讀取剪貼簿，但測試並未重現原本有焦點的貼上流程，回傳空圖片不足以判定 clipboard 故障；另有版本的 clipboard API 已不同，不能直接套用舊 probe。這些測試沒有證實根因。

## 根因

目前最小、符合觀察的解釋，是應用程式走 X11 相容路徑時，與這台 COSMIC Wayland 桌面的截圖貼上流程有相容性問題。改用原生 Wayland 後，使用者回報恢復。

底層是否為剪貼簿轉接、應用程式貼圖邏輯或其他事件等待，仍未確認。不要把本次結果泛化成所有 Linux、COSMIC 或 Electron 版本都有相同 bug。

## 修正

修改既有使用者層啟動 wrapper，先備份，再只在 Wayland session 加入 backend 參數；profile 路徑沿用既有值。以下為可攜範例，應依實際安裝路徑調整：

```sh
#!/bin/sh
log_dir="${XDG_STATE_HOME:-$HOME/.local/state}/chatgpt-official"
mkdir -p "$log_dir"
if [ -f "$log_dir/desktop.log" ] && [ "$(wc -c < "$log_dir/desktop.log")" -gt 10485760 ]; then
    mv -f "$log_dir/desktop.log" "$log_dir/desktop.previous.log"
fi
printf '\n--- Launch %s ---\n' "$(date -Is)" >> "$log_dir/desktop.log"
if [ "${XDG_SESSION_TYPE:-}" = wayland ] && [ -n "${WAYLAND_DISPLAY:-}" ]; then
    exec /usr/bin/chatgpt \
        --user-data-dir="$HOME/.config/ChatGPT-Official" \
        --ozone-platform=wayland "$@" >> "$log_dir/desktop.log" 2>&1
fi
exec /usr/bin/chatgpt \
    --user-data-dir="$HOME/.config/ChatGPT-Official" \
    "$@" >> "$log_dir/desktop.log" 2>&1
```

確認選單的 desktop entry 確實指向此 wrapper。檔案修改只影響下次啟動；儲存工作、完整退出所有同 profile 的應用程式程序，再從原選單重開，避免新命令被轉送到舊實例。

如需復原，將原 wrapper 備份複製回去，完整退出後重開。不要順便修改 Fcitx、全域環境變數或 compositor。

## 驗證

- 本機 wrapper 通過 `sh -n` 語法檢查，原設定保留備份。
- 使用者在收到「完整退出、重開後再貼截圖」的操作指示後，回報「看起來應該好了」。這是本次原始流程的使用者驗收，沒有額外錄影或自動化貼圖測試。
- 助理沒有在修改後重新確認新程序命令列，因此不可把預期使用的 backend 寫成已獨立實測。
- 若需再次驗證，完整重開後檢查 renderer／GPU 命令列與新 log，再使用同一截圖來源貼上；持續卡住時保留當下時間、程序狀態及日誌。

## 下次先查

1. 是視窗卡住、renderer 重載，還是整個程序退出？
2. 圖片是截圖、瀏覽器複製圖片，還是檔案管理員複製檔案？
3. `wl-paste --list-types` 是否有圖片格式，讀取是否能完成？
4. 桌面 session 與應用程式實際 backend 是否相符？
5. 先備份 wrapper，再測原生 Wayland；必須完整退出後重開。
6. 若仍卡住，讀取新增的 `desktop.log`；不以其他 Electron 版本的空 clipboard probe 代替原始貼上流程。
