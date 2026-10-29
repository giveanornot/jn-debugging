---
title: COSMIC 桌面凍結：NVIDIA 核心鎖阻塞與重開機恢復
description: COSMIC、面板與多個 GPU 程式同時卡在 NVIDIA rwlock；保存快照與紀錄後重開機恢復，保留尚未定位的觸發原因。
date: 2026-10-29
tags:
  - cosmic
  - nvidia
  - linux
  - gpu-hang
status: investigating
system: cosmic-desktop
severity: high
aliases:
  - os_acquire_rwlock_read
  - os_acquire_mutex
  - COSMIC 桌面當掉
  - Failed to map NvKmsKapiMemory
  - NVIDIA 5762513
  - Module nvidia_drm is in use
---

## 快速結論

桌面完全凍結但 shell 仍能執行時，先看程序等待點與 kernel journal。本例 COSMIC compositor、面板、Brave、Discord 及桌面 AI app 同時卡在 NVIDIA 核心鎖；經使用者同意重開機後，GPU 查詢與桌面視窗管理恢復。這是故障恢復，尚未找到可避免再次發生的根因修正。

## 症狀

- COSMIC 桌面凍結，背景指令仍能回應。
- `cosmic-comp`、`cosmic-panel` 與部分 app 呈 `D` 狀態。
- 等待點包括 `os_acquire_rwlock_read`、`os_acquire_rwlock_write`、`os_acquire_mutex`。
- 桌面快照工具的 `cos-cli info --json` 連續逾時。

```text
[nvidia-drm] Failed to ioremap_wc NvKmsKapiMemory
[nvidia-drm] Failed to map NvKmsKapiMemory
INFO: task cosmic-comp blocked for more than 122 seconds.
INFO: task cosmic-comp <reader> blocked on an rw-semaphore likely owned by task brave <writer>
```

## 影響範圍

本次環境為 Arch Linux、COSMIC `1.10.0`、Linux `7.2.11.arch1-1`、GTX 970 與已載入的 NVIDIA proprietary `580.196.07`。不是 NVIDIA open module 的案例，也沒有本次故障與休眠流程相連的證據。

故障波及使用 GPU 的桌面程序；系統尚可執行 shell，不代表顯示程序可恢復。重開機會關閉目前工作階段，未儲存內容可能遺失；視窗位置快照不包含文件內容。

## 排查

確認目前主機，再做短而有界限的檢查：

```bash
cat /etc/hostname
uptime
free -h
ps -eo pid,ppid,stat,comm,wchan:35
journalctl -k -b --since '-20 min' --no-pager \
  -g 'NVRM|nvidia|blocked for|Xid|BUG|oom' -n 100
cat /proc/driver/nvidia/version
```

2026-10-26 首次紀錄中，記憶體仍有約 18 GiB 可用，user systemd 沒有 failed unit；高 load 同時伴隨多個不可中斷等待程序，不能只當成 CPU 忙碌。核心紀錄先出現 PAT memory type 衝突與 NVIDIA 映射失敗，接著 Brave 的 Media thread 觸發 invalid opcode；數分鐘後出現多個程序等待 NVIDIA 鎖的警告。

進一步讀取堆疊：

```bash
sudo cat /proc/<blocked-gpu-process-pid>/stack
sudo cat /proc/<nv_queue-pid>/stack
```

本例 Brave GPU process 與 `nv_queue` 都在 NVIDIA `os_acquire_mutex` 路徑等待。避免反覆呼叫 GPU 診斷而新增卡住程序；若使用 `nvidia-smi`，加短 timeout，逾時仍不保證可以強制中止核心等待。

2026-10-29 同一組軟硬體再次凍結。19:14:22 先出現 PAT memory type conflict 與 `Failed to ioremap_wc NvKmsKapiMemory`，接著桌面 AI app 的 GPU channel 報 Xid 31，再出現跨程序 Xid 32／56。最早被記錄出錯的程序不能直接視為觸發根因。主執行緒看似 idle 時，compositor 的顯示執行緒仍可能在 NVIDIA 核心鎖等待；排查時須同時查看執行緒。

```bash
ps -eLo pid,tid,ppid,stat,comm,wchan:36
```

## 根因

可確認的故障層是 NVIDIA 核心同步鎖阻塞，導致 compositor 與多個 GPU client 無法繼續。journal 指出的鎖擁有者是 `likely owned`，不是已完成的鎖相依關係證明。

記憶體映射失敗與 Brave Media trap 在阻塞之前發生，但目前只有時間順序證據。沒有重現或 driver 內部追蹤，不能斷言由 Brave、某個網頁或特定操作觸發，也不能套用其他 GPU／open driver 的 issue 作為本例根因。

### 上游已知問題與本例的關係

NVIDIA 在 2025-12-22 為 Wayland 記憶體映射失敗建立內部 bug `5762513`，2026-06-24 回覆已在實驗室重現，並請使用者測試 BIOS Resizable BAR；這是特定重現條件下的結果，不能當作所有同類凍結的通用修復。[官方回覆](https://forums.developer.nvidia.com/t/bug-report-wayland-only-dmaallocmapping-gm107-va-mapping-failures-does-not-reproduce-on-x11/353598/17)

該串另有專有驅動 580、GTX 1060、COSMIC／KWin 的第一手回報，同樣記錄 NvKmsKapiMemory 映射失敗、跨程序 Xid 32／56 與媒體 renderer 崩潰。但回報者缺少內部 VA allocation 的直接錯誤，仍在詢問是否屬於同一 bug；本例也尚未確認同源。[相近舊顯卡案例](https://forums.developer.nvidia.com/t/bug-report-wayland-only-dmaallocmapping-gm107-va-mapping-failures-does-not-reproduce-on-x11/353598/22)

## 修正

此次採系統重開機恢復；沒有改動 NVIDIA 套件、核心參數或 compositor 設定。單純重啟面板或 compositor 無法被當成已證實有效的修法。

重開前先保存 kernel journal、程序等待點、還原服務紀錄與最後成功落盤的桌面快照。快照含視窗標題，應存於私人目錄，不上傳原始內容。當 compositor 已無法回應，保留舊快照，不用空結果覆寫它。

在使用者確認未儲存內容的風險後，執行：

```bash
sudo systemctl reboot
```

### 不重開機救援的實際限制

2026-10-29 嘗試保留登入階段，切換 VT 再返回桌面；返回時 greeter 的 VT release handshake 也卡住，完成交接後畫面仍未恢復，compositor 主執行緒進入 NVIDIA rwlock 等待。這次 VT 切換無效，不列為此類故障的推薦修法。

取得結束登入階段、可能遺失未儲存內容的同意後，由獨立 systemd 救援程序停止顯示管理器與圖形工作階段，終止 GPU clients，再嘗試正常卸載 NVIDIA modules。compositor／XWayland 仍卡在核心，卸載回報：

```text
modprobe: FATAL: Module nvidia_drm is in use.
```

因此沒有成功重載驅動；重新啟動顯示管理器的指令雖成功，也不代表畫面恢復。最後由使用者自行重開機。沒有執行強制模組卸載或 PCI reset。這是一次失敗的救援紀錄，不是可保證不重開機恢復的程序。

### 預防選項與尚未驗證的界線

- 停用 Chromium／Electron 整體硬體加速可作對照實驗；有上游使用者以 `--disable-gpu` 避開可重現的網頁崩潰，不能外推為本機已修復。只停用影片硬體解碼不等於停用整體 GPU 路徑。[測試回報](https://forums.developer.nvidia.com/t/bug-report-wayland-only-dmaallocmapping-gm107-va-mapping-failures-does-not-reproduce-on-x11/353598/13)
- 改用 X11 桌面可作另一組對照，尚未在本機實測。
- 本機 GTX 970 的 PCI capability 未列 Resizable BAR，不能直接套用上游 BIOS workaround。
- 本次選擇驅動、核心及程式硬體加速維持現況，正常使用觀察一週；上述預防選項都未套用，沒有新增定時檢查。

## 驗證

- 重開後 `nvidia-smi --query-gpu=name,driver_version --format=csv,noheader` 正常回應 GTX 970／`580.196.07`。
- `cos-cli info --json` 恢復回應。
- 2026-10-26 重開後三個視窗仍未歸位；另依[桌面快照還原流程](/linux/cosmic-session-checkpoint-restore/)修復，最終 11 個視窗的螢幕與工作區與快照一致，保存服務回到 `watching`。
- 新登入階段的檢查未見新的同類阻塞警告；沒有足夠長期觀察或重現證據宣稱根治。

2026-10-29 再次重開後，桌面還原服務因一個編輯器視窗未完成還原而停在 `restore-failed`，自動保存暫停；尚未修復，不能沿用先前 `watching` 的驗收結論。桌面能登入、GPU 查詢可回應、視窗配置成功還原，需分開驗證。

## 下次先查

1. shell 能否執行，實際主機是否正確。
2. `D` 狀態程序與等待點是否同樣集中在 NVIDIA。
3. 阻塞之前是否有 PAT、NvKmsKapiMemory、Media trap 或 Xid；保存完整時序，不只保留最後的 blocked task。
4. 比對載入中的 driver 版本與套件版本；本例兩者一致，沒有 driver/library mismatch 證據。
5. 若需要重開，先保留最後快照及紀錄，確認資料風險；還原後另驗實際位置，勿將登入成功等同所有視窗恢復。
