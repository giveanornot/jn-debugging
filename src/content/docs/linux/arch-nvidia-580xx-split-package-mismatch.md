---
title: Arch NVIDIA 580xx driver/library mismatch：split package 與未重開機
description: NVIDIA 更新後出現 driver/library mismatch 時，先分辨 AUR split packages 未對齊，或套件已對齊但仍在使用舊 kernel module。
date: 2026-08-25
tags:
  - arch-linux
  - nvidia
  - aur
  - steam
status: fixed
system: desktop
severity: medium
aliases:
  - nvidia driver library mismatch
  - lib32-nvidia mismatch
  - nvidia-580xx
  - nvidia 更新後未重開機
---

## 快速結論

`nvidia-smi` 的 `Driver/library version mismatch` 有兩種常見原因，修法不同：

1. AUR split packages 沒有同版完成單一交易：用 Paru batch install 或同批 `pacman -U` 重建整組。
2. 套件與 DKMS 都已更新，但目前 session 還在使用舊 kernel／NVIDIA module：重開機，不要重裝 Logseq、Steam 或桌面環境。

NVIDIA module 正被圖形 session 使用時不能安全熱切換。kernel 或 NVIDIA 更新完成後，重開機是套用更新的可靠方式。

## 症狀

- Steam 打不開或 updater 卡住。
- `nvidia-smi` 顯示 driver/library mismatch。
- Electron/Chromium 類 app（例如 Logseq）啟動後沒有視窗、白畫面或很快退出。
- Wayland compositor 回報 GPU buffer／texture 無法 render 或 import。
- 32-bit userspace 已升級，但 64-bit userspace / DKMS 還停在舊版。
- AUR helper 升級時卡在依賴：

```text
installing nvidia-580xx-utils (580.178.04-1) breaks dependency
'nvidia-580xx-utils=580.173.02' required by nvidia-580xx-dkms
```

## 影響範圍

- 系統：Arch Linux desktop
- 套件：NVIDIA proprietary driver AUR split packages
- 影響：Steam、Wine、Vulkan、32-bit game runtime
- 資料風險：低；但錯誤升級可能造成圖形 session 或遊戲 runtime 不穩

## 排查

先一次看套件、執行中的 kernel，以及已載入的 NVIDIA module：

```bash
pacman -Q linux nvidia-580xx-utils nvidia-580xx-dkms nvidia-580xx-settings
uname -r
cat /proc/driver/nvidia/version
nvidia-smi
```

`modinfo -F version nvidia` 只顯示磁碟上的 module 檔案版本，不能代表目前載入的版本；要用 `/proc/driver/nvidia/version` 或 `nvidia-smi` 判斷 runtime。

再檢查 split packages：

```bash
pacman -Q nvidia-580xx-utils nvidia-580xx-dkms nvidia-580xx-settings libxnvctrl-580xx
```

查 AUR package 是否已同版：

```bash
paru -Si nvidia-580xx-utils nvidia-580xx-dkms nvidia-580xx-settings libxnvctrl-580xx
```

有安裝 32-bit userspace 時也納入比對：

```bash
pacman -Q lib32-nvidia-580xx-utils
```

如果 `lib32` 已新版、主套件仍舊版，Steam/Wine 最容易先壞，因為 32-bit runtime 會踩到 userspace mismatch。

若所有 `nvidia-580xx-*` 套件與 DKMS 都是新版，但 `uname -r` 仍是舊 kernel，或 `/proc/driver/nvidia/version` 仍是前一版，代表更新後尚未重開機。此時 `nvidia-smi` 的 mismatch 是預期症狀，無須重裝套件。

## 根因

split package 的情況不是 DKMS 編譯錯，而是 split packages 被 AUR helper 分批 install。安裝中的舊 `nvidia-580xx-dkms` 仍嚴格依賴舊版 `nvidia-580xx-utils`，所以一旦 helper 先單獨提交新版 utils，dependency solver 必然拒絕交易。

另一種情況是 pacman 已替換 userspace libraries、DKMS module 與下一次開機用的 kernel，但目前記憶體中的 kernel module 不會隨交易替換。NVIDIA 32-bit/64-bit userspace 與已載入 module 版本不一致時，Steam/Wine/Vulkan 或 GPU 加速的桌面 app 會先暴露問題。

## 修正

先讓 Paru 重新建置、並將整組 package 留到同一筆交易：

```bash
paru -S --batchinstall --rebuild \
  nvidia-580xx-utils \
  nvidia-580xx-dkms \
  nvidia-580xx-settings \
  libxnvctrl-580xx
```

如有安裝 32-bit userspace，將 `lib32-nvidia-580xx-utils` 一併加入。完成後再用批次模式跑一般更新，避免其餘 AUR packages 被逐筆安裝：

```bash
paru -Syu --batchinstall
```

如果 helper 還是拆 transaction，就用已 build 的 package files 同批安裝：

```bash
sudo pacman -U \
  nvidia-580xx-utils-*.pkg.tar.zst \
  nvidia-580xx-dkms-*.pkg.tar.zst \
  nvidia-580xx-settings-*.pkg.tar.zst \
  libxnvctrl-580xx-*.pkg.tar.zst \
  lib32-nvidia-580xx-utils-*.pkg.tar.zst
```

完成交易後重開機，讓 kernel module 與 userspace 對齊。若套件版本已一致但 runtime mismatch，直接重開機即可。

### 只提醒、不自動重開機

可用 pacman hook 建立當次開機有效的標記：

`/etc/pacman.d/hooks/95-reboot-required.hook`

```ini
[Trigger]
Operation = Install
Operation = Upgrade
Type = Package
Target = linux
Target = nvidia-*-dkms
Target = nvidia-*-utils
Target = lib32-nvidia-*-utils

[Action]
Description = Marking reboot required after kernel or NVIDIA update...
When = PostTransaction
Exec = /usr/bin/touch /run/reboot-required
```

再由 user systemd 監看檔案變動並通知；`PathChanged` 避免標記持續存在時反覆跳通知，service 本身在登入時會補發一次：

```ini
# ~/.config/systemd/user/reboot-required-notify.service
[Unit]
Description=Show reboot-required notification
ConditionPathExists=/run/reboot-required

[Service]
Type=oneshot
ExecStart=/usr/bin/notify-send --app-name=System --icon=system-reboot --urgency=normal "需要重新開機" "系統已更新 kernel 或 NVIDIA 驅動；請在方便時重新開機以套用更新。"

[Install]
WantedBy=graphical-session.target
```

```ini
# ~/.config/systemd/user/reboot-required-notify.path
[Path]
PathChanged=/run/reboot-required
Unit=reboot-required-notify.service

[Install]
WantedBy=graphical-session.target
```

啟用後不會自動重開機：

```bash
systemctl --user daemon-reload
systemctl --user enable --now reboot-required-notify.service reboot-required-notify.path
```

## 驗證

確認套件同版：

```bash
pacman -Q nvidia-580xx-utils nvidia-580xx-dkms nvidia-580xx-settings libxnvctrl-580xx
```

確認 driver/library match：

```bash
nvidia-smi
dkms status
```

確認 `uname -r` 已是預期的新 kernel，`/proc/driver/nvidia/version` 與 `nvidia-smi` 不再顯示 mismatch，再測 Steam、Wine/Vulkan game、GPU app 或 `vulkaninfo`。

## 下次先查

Steam、GPU app 或 Wayland 桌面在 NVIDIA Arch 更新後怪異時：

1. 先跑 `nvidia-smi`、`uname -r`、`cat /proc/driver/nvidia/version`。
2. 套件同版但 runtime 仍舊 → 重開機。
3. 套件版本不同 → `paru -Si` 確認候選版本，再用 `paru -S --batchinstall --rebuild` 完成單一交易。
4. 重開機後看 `nvidia-smi`、`dkms status`，再判斷是否仍是 app 本身問題。
