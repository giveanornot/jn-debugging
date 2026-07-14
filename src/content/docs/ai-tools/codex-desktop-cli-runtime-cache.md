---
title: Codex Desktop Linux 找不到 CLI
description: Codex Desktop Linux reboot 後找不到 CLI 時，同時檢查 launcher path、runtime cache 與磁碟空間。
date: 2026-07-12
tags:
  - codex
  - linux
  - desktop
  - electron
status: fixed
system: codex-desktop
severity: medium
aliases:
  - Unable to locate the Codex CLI binary
  - Codex CLI initialized
  - Codex runtime cache
---

## 快速結論

Codex Desktop Linux 顯示找不到 CLI 時，不要只重裝 CLI。先看 launcher 實際吃到哪個 `codex`，再看 runtime/update cache 是否因磁碟滿而解壓失敗。

固定 Desktop entry 的 CLI path、清 stale runtime/update cache、釋放磁碟空間後，再從使用者圖形 session 啟動。

## 症狀

Codex Desktop reboot 後無法正常啟動，launcher 報：

```text
Unable to locate the Codex CLI binary
No space left on device
```

或 UI 一直卡在 loading，log 看得到 app-server version、feature enablement 或 account call 異常。

## 影響範圍

- 服務：Codex Desktop Linux
- 環境：Linux desktop app / Electron launcher
- 影響：Desktop app 無法進入可用狀態，local GUI automation 也可能不可用
- 資料風險：低；主要是 launcher/cache 狀態壞掉

## 排查

先確認 CLI 本身是否存在：

```bash
command -v codex
codex --version
```

再看 Desktop launcher log：

```bash
tail -n 200 ~/.cache/codex-desktop/launcher.log
```

如果 CLI 存在但 launcher 找不到，檢查 Desktop entry 的 `Exec=` 是否繞到 wrapper、snap、舊 npm path 或不完整 PATH。

```bash
grep -n '^Exec=' ~/.local/share/applications/codex-desktop.desktop
```

同時檢查 root filesystem：

```bash
df -h /
du -h -d 1 ~/.cache/codex-desktop 2>/dev/null
```

如果 log 同時有 `No space left on device`，先處理空間；runtime 解壓失敗會讓後續錯誤看起來像 CLI 或 app-server 壞掉。

## 根因

這類故障常是兩件事疊在一起：

- Desktop entry 讓 launcher 從 GUI PATH 自行找 `codex`，結果吃到 wrapper、snap 或舊版本。
- root filesystem 接近滿載，Codex primary runtime / update cache 解壓失敗。

CLI 本體存在不代表 Desktop launcher 會使用同一個 CLI。從 headless shell 手動跑 `codex --version` 通過，也不能排除 GUI launcher path 壞掉。

## 修正

把 Desktop entry 固定到 native CLI path。概念如下，實際路徑依安裝方式調整：

```ini
Exec=env CODEX_CLI_PATH=/usr/bin/codex /usr/bin/codex-desktop
```

清掉可重建的 Codex runtime/update cache 與 stale lock/pid：

```bash
rm -rf ~/.cache/codex-desktop/runtime ~/.cache/codex-desktop/updates
rm -f ~/.cache/codex-desktop/*.lock ~/.cache/codex-desktop/*.pid
```

如果是從 SSH/headless agent 修 GUI app，要讓命令進入使用者已登入的圖形 session。X11/XFCE 類環境可用現有 terminal DBus 或帶齊 GUI env：

```bash
DISPLAY=:0 \
XAUTHORITY="$HOME/.Xauthority" \
DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/$(id -u)/bus" \
codex-desktop
```

自動啟動則放在 user autostart，等登入後的 X/Wayland session 起來再啟動。不要做成登入前 system service。

## 驗證

launcher log 應出現：

```text
Codex CLI initialized
next=connected
window ready-to-show
```

同時確認視窗真的存在：

```bash
xwininfo -root -tree | grep -i codex
```

reboot 後再驗證一次，確認 autostart 不再因 PATH 或 runtime cache 漂移而復發。

## 下次先查

看到 Codex Desktop 找不到 CLI 時，照這個順序：

1. `command -v codex` 與 `codex --version`
2. Desktop entry 的 `Exec=`
3. `~/.cache/codex-desktop/launcher.log`
4. `df -h /`
5. runtime/update cache
6. GUI session env
