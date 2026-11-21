---
title: Codex Desktop Linux 找不到 CLI
description: Codex Desktop Linux reboot 後找不到 CLI 時，同時檢查 launcher path、runtime cache 與磁碟空間。
date: 2026-11-19
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
  - /ai-tools/codex-desktop-cli-runtime-cache/
category: codex
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

### 未完成的 runtime 安裝暫存

若磁碟壓力來自較新的安裝器，另外盤點：

```bash
df -h /
du -h -d 1 ~/.cache/codex-runtimes ~/.cache/codex-update-manager 2>/dev/null
findmnt -T ~/.cache/codex-runtimes
```

`codex-runtime-install-*` 可能是解壓失敗後留下的 staging directory，內含下載壓縮檔與 payload；名稱本身不足以證明可以刪。先逐一確認目錄、時間、目前 primary runtime 與 updater state，並檢查程序的 command line、memory maps、working directory、executable 和 open file descriptors 是否引用候選目錄。只輸出程序名稱、PID 與命中的目錄，避免將完整參數或環境變數寫進報告；檢查程序本身及其 shell ancestor 可能因搜尋文字而命中，須排除這類自我引用。

確認候選目錄不是 symlink、位於預期 cache 路徑、無現行使用者，才刪除已核對的明確目錄。保留 `codex-primary-runtime`、目前 updater candidate、rollback package，以及已安裝版本的回復包；不要對整個 runtime/cache 根目錄執行 wildcard 刪除。其他 cache 路徑的 lock/pid 也必須先確認沒有對應程序，不能在程式使用中照抄上方刪除命令。

2026-11-19 的維護案例中，根分割區使用率為 98%，updater build log 含 `No space left on device`。兩個沒有程序引用的舊安裝暫存連同 pip cache 清除後，實際可用空間增加約 3.1 GiB，使用率降為 92%。這次 GUI 原本可用，不能當成重新驗證舊的「找不到 CLI」症狀。

如果是從 SSH/headless agent 修 GUI app，要讓命令進入使用者已登入的圖形 session。X11/XFCE 類環境可用現有 terminal DBus 或帶齊 GUI env：

```bash
DISPLAY=:0 \
XAUTHORITY="$HOME/.Xauthority" \
DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/$(id -u)/bus" \
codex-desktop
```

自動啟動則放在 user autostart，等登入後的 X/Wayland session 起來再啟動。不要做成登入前 system service。

## 驗證

若只進行空間清理，前後比較同一檔案系統的可用 bytes，並確認 primary runtime 保留及原服務持續運行。清出空間不代表 updater 已恢復：上述維護案例的 updater state 仍為 `failed`，尚未重新執行 build/install；需要下一次成功更新才能驗收這條路徑。

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
