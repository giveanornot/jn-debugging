---
title: COSMIC 自動還原視窗：30 秒快照、雙螢幕與重複開窗修正
description: 在 COSMIC 試用 cosmic-wm-manager，以平時快照支援意外關機恢復，並修正雙螢幕路由、重複開窗與冷啟動逾時。
date: 2026-10-26
tags:
  - cosmic
  - wayland
  - session-restore
  - systemd
status: fixed
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

平時增減視窗、模擬登入與真實重開機均已驗證。第一次真實重開時，11 個視窗成功重用、重開及歸位，但 LibreOffice Calc 冷啟動約 34 秒，超過原本 30 秒的視窗等待上限，讓服務以 `restore-failed` 停止。將還原等待上限提高到 90 秒、更新不含已關閉 Calc 的快照後，服務恢復 `watching`，下一輪 checkpoint 也持續成功。

只在關機前保存無法涵蓋突然斷電；必須平時把狀態寫到磁碟。30 秒是這次選用的起始間隔，不是效能實測後的最佳值，還原點也只到最近一次成功持久化的快照。

2026-10-26 再次重開後，Discord、Vesktop 與一個 KiCad 視窗沒有歸位。以最新 compositor 狀態逐一搬移後，11 個視窗全部與快照一致；保存服務已增加還原後位置複查與補移。此版已通過同一登入階段的整份還原，尚待下一次自然冷開機驗證。

## 症狀

- 希望重開機後不用手動重開各程式、重排工作區。
- 原工具 `save` 產生的快照缺少雙螢幕歸屬。
- 還原指令回報成功，啟動的測試視窗卻在指令結束後消失。
- 第二螢幕的搬移指令回報成功，但實際未歸位。
- 瀏覽器分頁標題改變，被當成原視窗不存在，導致多開一個視窗。
- 真實重開後，多數視窗已歸位，但狀態檔顯示 `restore-failed`，缺少的只有冷啟動較慢的 LibreOffice Calc。

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
6. 登入服務只給應用程式 30 秒產生視窗。LibreOffice Calc 在真實重開後約 34 秒才出現；啟動程序本身正常，但還原器已先逾時，保護機制因此停止後續保存。

這些是本次讀碼和執行結果，不代表其他 upstream 版本仍有相同問題。

## 修正

### 工具層修補

此頁提供對應上述 revision 的[本機修補檔](/scripts/cosmic-wm-local-fixes.patch)。先讀 patch，再對已確認的版本執行 `git apply --check`；不要對任意新版直接套用。

- 獨立啟動 GUI child process。
- 依所有實際設定的工作區建立路由。
- 搬移時同時指定螢幕與 workspace group。
- 先保留所有精確標題匹配，再用剩餘 app ID 與位置重用視窗；避免因分頁改名多開。
- 保留其他仍能精確匹配的視窗，不讓 fallback 搶走它們。
- 登入還原的視窗等待上限改為 90 秒；外層仍保留 180 秒總時限，避免真的卡住時無限等待。

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

### 啟動後位置複查（2026-10-26）

本次部分視窗的移動指令已送出，最後位置卻不符快照；ChatGPT 曾等待工作區逾時，之後實際位置正確。不能只根據早期成功或失敗訊息判定整份還原結果。

`cos-cli` 的視窗 index 是當次枚舉位置；啟動／splash 視窗消失會改變後續索引。這是讀碼可確認的風險，但本次未逐筆追蹤每次 handle，不能斷言三個錯位視窗都由它造成，也未證實是 app 自行改位置。

保存腳本的 `reconcile_placements()` 在原還原流程結束後，比較 `(app_id, output, workspace)` 與預期數量：

- 保留已在正確位置的視窗，只把多出在其他位置的同 app 視窗移到缺少的位置。
- 每移一個視窗就重新讀取 JSON，取得新視窗、螢幕與工作區 index，再確認實際結果。
- 複查只搬移、不啟動程式；同一 app 同時缺多個不同位置時不猜測配對。
- 缺窗、歧義或無法搬移仍停止保存並保留快照。複查至多 30 秒；無可安全搬移的候選則提早失敗。

先停止保存服務再手動修位，避免意外記錄半套布局；確認 `KillMode=process` 後再停止，否則預設 cgroup 行為可能連帶關閉被服務啟動的程式。

### 保存保護

- 每 30 秒檢查，有變才更新 `sessions/auto-latest.yaml`。
- 保留前 10 份有變動的快照於 `history/`。
- 暫存檔寫入、fsync、atomic replace，再 fsync 所在目錄。
- 空桌面、正在關機、預期螢幕缺席時保留舊快照。
- 登入先等螢幕就緒，還原並核對歸位後才開始保存。
- 還原不完整就停止服務，避免把半套桌面覆蓋原快照。
- 同一 compositor session 的服務重啟，不會重複還原。
- 對冷啟動 app 的視窗等待時間須高於實測最慢啟動時間；本例以 34 秒實測值改為 90 秒，不要沿用過短的 30 秒預設值。

這些措施不能保證突然斷電時零損失，也沒有保存程式記憶體；它只提供最近一次成功保存的配置。

## 驗證

本次結果：

- 29 項測試通過（10/26 增加逐次搬移後枚舉索引變動的回歸測試），包含多螢幕路由、分頁標題變動、不重複啟動、子程序存活、慢速冷啟動等待參數、無變動不寫入、保留 10 份歷史、寫入中斷保留舊檔及不完整還原的保護。
- 30 秒服務確實保存新增的測試終端機。
- 停止服務、關閉測試終端機、清除本次測試的 runtime restore marker，再用真實登入 launcher 啟動服務：缺少終端機成功重開，原本兩個瀏覽器視窗沒有增加。
- 原本 11 個實際工作視窗的螢幕與工作區核對一致；測試視窗已清理，最新快照只含實際工作視窗。
- 真實重開後，除了逾時的 Calc 外，其餘 11 個視窗均被找到並歸到預期螢幕／工作區；沒有因瀏覽器標題變動多開視窗。
- Calc 手動冷啟動約 34 秒後確實產生 `libreoffice-calc` 視窗，排除 launcher 無效；提高等待上限後，原快照的 12 個視窗全部匹配，Calc 位於預期的第二螢幕工作區。
- 關閉 Calc 後重新擷取 11 視窗快照，服務恢復 `active/running` 與 `watching`；下一輪 30 秒 checkpoint 顯示 `changed: false`、`window_count: 11`，Calc 未殘留在視窗或快照。
- 尚未以真正意外斷電測試；它仍只能恢復最近一次成功落盤的視窗配置。

2026-10-26：手動修復 Discord、Vesktop 與 KiCad 後，以完整原快照重新執行還原，11 個視窗位置全部一致，服務回到 `watching`，後續 checkpoint 為 `changed: false`、`window_count: 11`。這次同一登入階段的重跑未新增視窗；新增複查邏輯的冷開機驗證仍待自然重開時進行，不將單元測試當成冷啟動驗收。

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
4. 若只缺單一 app，量測從啟動到 compositor 出現視窗的時間，再對照 `--timeout`，不要直接判定 launcher 失敗。
5. 實際登入後檢查 service、狀態檔與視窗，再決定是否繼續使用。

停用時先 `systemctl --user stop cosmic-desktop-watch.service`，再把對應 autostart `.desktop` 搬到備份位置；快照保留，方便人工恢復。官方完整 Session Restore 的規劃可另參考 [COSMIC roadmap](https://blog.system76.com/blog/post/cosmic-epoch-2-and-3-roadmap)。
