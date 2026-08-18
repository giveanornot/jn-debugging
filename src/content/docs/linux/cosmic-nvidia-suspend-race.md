---
title: COSMIC Wayland 搭 NVIDIA 時休眠失敗或卡死
description: COSMIC 合成器尚未停止渲染時，NVIDIA suspend helper 接管 DRM，可能造成 Xid、nvidia-sleep.sh 卡死與 systemd-suspend 失敗。
date: 2026-08-19
tags:
  - arch-linux
  - cosmic
  - nvidia
  - wayland
  - suspend
status: fixed
system: desktop
severity: high
aliases:
  - COSMIC NVIDIA suspend failed
  - nvidia-sleep.sh stuck
  - NVRM Xid 158 suspend
  - systemd-suspend cosmic-comp DRM access error
---

## 快速結論

在 COSMIC Wayland 與 NVIDIA proprietary driver 的組合中，保留 VRAM 的 NVIDIA suspend helper 可能在 COSMIC 停止渲染前接管 DRM。不要先關閉 `NVreg_PreserveVideoMemoryAllocations=1`；讓 `nvidia-suspend.service` 先暫停 `cosmic-comp`，並在 `nvidia-resume.service` 完成 GPU 回復後再繼續它。

## 症狀

- 從桌面選單或 `systemctl suspend` 休眠後立刻醒來、卡住，或最後失敗。
- journal 出現 `NVRM: Xid ... 158`、`nvidia-sleep.sh` blocked，或 `systemd-suspend.service` failed。
- `cosmic-comp` 在 suspend/resume 前後反覆出現 DRM access error。

```text
Failed to put system to sleep. System resumed again: Device or resource busy
NVRM: Xid ..., pid=..., name=cosmic-comp, ...
nvidia-sleep.sh ... blocked on an rw-semaphore likely owned by task cosmic-comp
```

## 影響範圍

- 系統：Linux desktop（Arch 亦適用）
- 桌面：COSMIC Wayland
- GPU：使用 proprietary NVIDIA module，並啟用 NVIDIA 的 systemd suspend/resume services
- 影響：S3 / `deep` suspend 失敗、休眠後桌面凍結或必須強制重開機
- 資料風險：中；休眠流程卡住時，強制關機可能遺失未儲存資料

## 排查

先確認服務與 VRAM preservation 仍正常配置：

```bash
systemctl status nvidia-suspend.service nvidia-resume.service
cat /proc/driver/nvidia/params | rg PreserveVideoMemoryAllocations
systemd-inhibit --list
```

再看最近一次休眠的關鍵訊息：

```bash
journalctl -b --no-pager | rg -i -C 3 \
  'suspend|systemd-sleep|nvidia-sleep|NVRM: Xid|cosmic-comp.*DRM'
```

若能看到 NVIDIA suspend helper 與 COSMIC 的 DRM error 緊接出現，通常不是一般應用程式 inhibitor，而是 compositor 與 NVIDIA 接管 GPU 的時序競態。

## 根因

`nvidia-suspend.service` 會先執行 `nvidia-sleep.sh`，寫入 `/proc/driver/nvidia/suspend` 讓 NVIDIA 儲存 VRAM 並接管 GPU。COSMIC 當時仍可能在提交 page flip，DRM access 被撤銷後就進入錯誤重試或鎖競爭，最後阻塞 suspend 或 NVIDIA resume。

這是 COSMIC 尚未完整處理 suspend lifecycle 的上游問題，不是停掉 Discord、NetworkManager 等一般 sleep inhibitor 能解決的問題。

## 修正

保留既有的 NVIDIA suspend/resume services 與 `NVreg_PreserveVideoMemoryAllocations=1`。用 systemd drop-in 在 NVIDIA 接管前停住 compositor，並在 NVIDIA 回復完成後繼續：

`/etc/systemd/system/nvidia-suspend.service.d/10-freeze-cosmic-first.conf`

```ini
[Service]
ExecStartPre=/bin/sh -c '/usr/bin/pkill -STOP -x cosmic-comp 2>/dev/null || true'
ExecStartPre=/usr/bin/sleep 0.3
```

`/etc/systemd/system/nvidia-resume.service.d/10-resume-cosmic.conf`

```ini
[Service]
ExecStartPost=/bin/sh -c '/usr/bin/pkill -CONT -x cosmic-comp 2>/dev/null || true'
```

載入設定：

```bash
sudo systemctl daemon-reload
systemctl cat nvidia-suspend.service nvidia-resume.service
```

這是上游修正前的 workaround；系統更新後若 COSMIC 已原生處理這個 suspend event，可以移除這兩個 drop-in 再測。

## 驗證

先檢查 unit 是否正確合併 drop-in：

```bash
systemctl cat nvidia-suspend.service nvidia-resume.service
```

再執行一次實際休眠，喚醒後確認：

```bash
sudo systemctl suspend
journalctl -b -k --since '5 minutes ago' | rg 'PM: suspend (entry|exit)|NVRM: Xid|Oops'
systemctl is-failed nvidia-suspend.service nvidia-resume.service systemd-suspend.service
```

成功時會看到 `PM: suspend entry (deep)` 與 `PM: suspend exit`，三個服務不應是 failed，`cosmic-comp` 也應繼續運作。

## 下次先查

1. 先查 journal 是否同時有 `cosmic-comp` DRM error、Xid 或 `nvidia-sleep.sh` blocked。
2. 確認 `nvidia-suspend.service`、`nvidia-resume.service` 已啟用，且 `PreserveVideoMemoryAllocations: 1`。
3. 確認兩個 COSMIC stop/continue drop-in 仍被 `systemctl cat` 載入。
4. 若已更新 COSMIC，先在可回復的時段移除 workaround 重測；若問題重現就還原 drop-in。
