---
title: COSMIC 自動還原視窗：30 秒快照、雙螢幕與重複開窗修正
description: 在 COSMIC 試用 cosmic-wm-manager，以平時快照支援意外關機恢復，並修正子程序存活、雙螢幕路由與分頁標題改變造成的多開。
date: 2026-10-24
tags:
  - cosmic
  - wayland
  - session-restore
  - systemd
status: investigating
system: cosmic-desktop
severity: medium
aliases:
  - COSMIC session restore
  - cosmic-wm-manager
  - cosmic desktop checkpoint
  - COSMIC 重開機視窗還原
---

## 快速結論

COSMIC `1.10.0` 的這次試用，採用第三方 [cosmic-wm-manager](https://github.com/Izume01/cosmic-ext-wm-manager) 與 [cos-cli](https://github.com/estin/cos-cli)，搭配本機修補和每 30 秒檢查的保存服務。它能重開程式並還原螢幕、工作區；不保存精確視窗大小、平鋪布局、文件內容或終端工作。

已驗證平時增減視窗會更新快照，以及模擬登入時重開缺少的測試視窗、重用既有瀏覽器視窗。**真實登出／重開機仍待驗證**，因此此頁保留 `investigating`，不能當成完整桌面狀態還原的保證。

只在關機前保存無法涵蓋突然斷電；必須平時把狀態寫到磁碟。30 秒是這次選用的起始間隔，不是效能實測後的最佳值，還原點也只到最近一次成功持久化的快照。

## 症狀

- 希望重開機後不用手動重開各程式、重排工作區。
- 原工具 `save` 產生的快照缺少雙螢幕歸屬。
- 還原指令回報成功，啟動的測試視窗卻在指令結束後消失。
- 第二螢幕的搬移指令回報成功，但實際未歸位。
- 瀏覽器分頁標題改變，被當成原視窗不存在，導致多開一個視窗。

## 影響範圍

- 環境：COSMIC Wayland `1.10.0`、雙螢幕、第三方視窗管理工具。
- 記錄範圍：程式啟動指令、視窗識別、螢幕與工作區。
- 資料限制：程式內部狀態仍靠各程式的保存與恢復功能。
- 本機快照含視窗標題，應用私人權限保存，不應上傳原始快照。

## 排查

先讀 compositor 的實際狀態，而不是只相信工具的成功訊息：

```bash
~/.cargo/bin/cos-cli info --json
```

比較每個 app 的 `app_id`、`outputs[].name`、`workspaces[].workspace`。工具使用的是 0-based CLI workspace index，使用者看到的工作區通常是 1-based。

測試順序：先保存原本桌面，再開獨立測試視窗，驗證搬移、關閉後重開、指令結束後是否仍存活，最後才試整份快照。

不要只把單一視窗移到相鄰空工作區作為驗收。COSMIC 可能整理空工作區並重新編號，移動後的數字未必維持不變；新增可辨認的測試視窗較容易驗證保存有沒有發生。

## 根因

在 upstream revision `ab4e54fec26b9c120c4956005b8a003746dffe9e` 發現以下限制：

1. `save` 不保留 monitor mapping，還原時不同螢幕上同號工作區會混淆；啟動指令也可能把原生 Discord 誤判成 Flatpak。
2. 啟動 app 使用 asyncio subprocess transport，未確保 GUI process 在 CLI 結束後獨立存活。改成一般 `Popen(start_new_session=True)` 後，關閉再重開測試通過。
3. profile 只替 global workspace 1–19 建路由，後面的工作區沒有對應。
4. `cos-cli move` 只收到 workspace group 時仍可能採預設 output，必須同時傳送 `-g` 與 `-o`。
5. 多視窗的標題匹配太嚴格；分頁標題改變後，工具可能在尚有足夠同 app 視窗時再次啟動程式。

這些是本次讀碼和執行結果，不代表其他 upstream 版本仍有相同問題。

## 修正

### 工具層修補

此頁提供對應上述 revision 的[本機修補檔](/scripts/cosmic-wm-local-fixes.patch)。先讀 patch，再對已確認的版本執行 `git apply --check`；不要對任意新版直接套用。

- 獨立啟動 GUI child process。
- 依所有實際設定的工作區建立路由。
- 搬移時同時指定螢幕與 workspace group。
- 先保留所有精確標題匹配，再用剩餘 app ID 與位置重用視窗；避免因分頁改名多開。
- 保留其他仍能精確匹配的視窗，不讓 fallback 搶走它們。

### 平時保存與登入還原

提供可攜的[保存服務腳本](/scripts/cosmic-desktop-watch.py)。它使用安裝於 `~/.local/bin/cosmic-wm`、`~/.cargo/bin/cos-cli` 的工具；Python 環境需能 import 修補後的 `cosmic_wm_manager`。

先用 `cosmic-wm save initial` 產生 `~/.config/cosmic-wm-manager/sessions/initial.yaml`，人工檢查每個 `command` 指向真正安裝的程式，尤其 Discord、編輯器專案參數及自訂 launcher。腳本會從 compositor 補上螢幕路由，不會採用任意 process arguments 來猜啟動指令。

把下載後的腳本存為工具專案內的 `desktop_watch.py`，在其 Python venv 下執行一次：

```bash
.venv/bin/python desktop_watch.py --capture-once
```

接著由 user systemd service 啟動同一個腳本。以下 `ExecStart` 路徑需換成實際安裝位置：

```ini
[Unit]
Description=COSMIC desktop restore and checkpoints
PartOf=graphical-session.target
After=graphical-session.target

[Service]
Type=simple
ExecStart=/absolute/tool/.venv/bin/python /absolute/tool/desktop_watch.py
Environment=PYTHONUNBUFFERED=1
UMask=0077
Restart=no
TimeoutStopSec=10
KillMode=process

[Install]
WantedBy=graphical-session.target
```

此試用用 `KillMode=process` 避免停止保存服務時連帶殺掉已重開的 GUI app；代價是子程序不受整個 service cgroup 的統一停止管理。長期整合可再把 app 啟動交給獨立 user scope，不能任意換回預設 KillMode 而不重測。

登入透過 XDG autostart 執行以下 launcher，先匯入當次 session 環境再啟動服務；不要只掛 `default.target`，以免登入前就啟動，或沿用舊 Wayland socket：

```sh
#!/bin/sh
systemctl --user import-environment WAYLAND_DISPLAY DISPLAY XDG_CURRENT_DESKTOP XDG_RUNTIME_DIR
exec systemctl --user start cosmic-desktop-watch.service
```

XDG autostart `.desktop` 應設定 `OnlyShowIn=COSMIC;`、`Terminal=false`，`Exec` 使用這個 launcher 的絕對路徑。儲存 service 後先執行 `systemctl --user daemon-reload`，再執行 launcher 測試。

### 保存保護

- 每 30 秒檢查，有變才更新 `sessions/auto-latest.yaml`。
- 保留前 10 份有變動的快照於 `history/`。
- 暫存檔寫入、fsync、atomic replace，再 fsync 所在目錄。
- 空桌面、正在關機、預期螢幕缺席時保留舊快照。
- 登入先等螢幕就緒，還原並核對歸位後才開始保存。
- 還原不完整就停止服務，避免把半套桌面覆蓋原快照。
- 同一 compositor session 的服務重啟，不會重複還原。

這些措施不能保證突然斷電時零損失，也沒有保存程式記憶體；它只提供最近一次成功保存的配置。

## 驗證

本次結果：

- 27 項測試通過，包含多螢幕路由、分頁標題變動、不重複啟動、子程序存活、無變動不寫入、保留 10 份歷史、寫入中斷保留舊檔及不完整還原的保護。
- 30 秒服務確實保存新增的測試終端機。
- 停止服務、關閉測試終端機、清除本次測試的 runtime restore marker，再用真實登入 launcher 啟動服務：缺少終端機成功重開，原本兩個瀏覽器視窗沒有增加。
- 原本 11 個實際工作視窗的螢幕與工作區核對一致；測試視窗已清理，最新快照只含實際工作視窗。
- 真實重開機、意外斷電，以及所有實際 app 從完全未啟動到還原的流程，仍待驗證。

查看狀態：

```bash
systemctl --user status cosmic-desktop-watch.service
journalctl --user -u cosmic-desktop-watch.service -n 60 --no-pager
cat ~/.config/cosmic-wm-manager/auto-status.json
```

`watching` 才表示已開始保存；`restore-failed` 表示保護機制保留了舊快照，須先處理缺窗或路由問題。

## 下次先查

1. 原始 compositor JSON 是否有正確 app ID、螢幕與工作區。
2. 保存的 launcher 是否正確，是否只因標題改變而多開。
3. 還原期間是否暫停保存；最新快照是否仍完整。
4. 實際登入後檢查 service、狀態檔與視窗，再決定是否繼續使用。

停用時先 `systemctl --user stop cosmic-desktop-watch.service`，再把對應 autostart `.desktop` 搬到備份位置；快照保留，方便人工恢復。官方完整 Session Restore 的規劃可另參考 [COSMIC roadmap](https://blog.system76.com/blog/post/cosmic-epoch-2-and-3-roadmap)。
